# Single-command local QA. Never uploads firmware, deploys, or writes to
# Supabase. Usage and configuration: docs/LOCAL_QA_RUNNER.md.
#
# Exit codes: 0 every requested required stage passed (a full run also needs
# every required stage); 1 a stage failed or the run could not start;
# 2 nothing failed but a required stage was blocked or not run.
[CmdletBinding()]
param(
    [ValidateSet('full', 'firmware-only')] [string]$Suite = 'full',
    [string[]]$Stages,
    [switch]$FirmwareOnly,
    [string]$OutputDir,
    [string]$ConfigFile,
    [string]$PythonExecutable,
    [string]$NodeExecutable,
    [string]$GitExecutable,
    [string]$CompilerBin,
    [string]$CadPython,
    [string]$PgliteModule,
    [string]$BenchProject,
    [switch]$ListStages
)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'qa-runner.psm1') -Force
$root = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
if (Test-QaOneDrivePath $root) {
    throw 'Builds are disabled inside OneDrive. Copy the project outside the synced folder before running check-local.ps1.'
}

# --- Configuration: parameter > QA config file > PATH discovery --------------

$configPath = if ($ConfigFile) { $ConfigFile } elseif ($env:FREEZER_QA_CONFIG) { $env:FREEZER_QA_CONFIG } else { $null }
$config = @{}
if ($configPath) {
    if (-not (Test-Path -LiteralPath $configPath)) { throw "QA config not found: $configPath" }
    $parsed = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
    foreach ($property in $parsed.PSObject.Properties) { $config[$property.Name] = [string]$property.Value }
}

function Select-Setting([string]$Explicit, [string]$Key) {
    if ($Explicit) { return @{ value = $Explicit; source = 'parameter' } }
    if ($config.ContainsKey($Key) -and $config[$Key]) { return @{ value = $config[$Key]; source = "config:$Key" } }
    return $null
}

function Resolve-Tool([string]$Explicit, [string]$Key, [string]$Command) {
    $setting = Select-Setting $Explicit $Key
    if ($setting) {
        $found = Get-Command -Name $setting.value -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($found) { return @{ path = $found.Source; source = $setting.source; error = $null } }
        return @{ path = $null; source = $setting.source; error = "configured $Key was not found: $($setting.value)" }
    }
    $found = Get-Command -Name $Command -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { return @{ path = $found.Source; source = 'PATH'; error = $null } }
    return @{ path = $null; source = 'not found'; error = "$Command was not found on PATH; configure '$Key' (see docs/LOCAL_QA_RUNNER.md)" }
}

$node = Resolve-Tool $NodeExecutable 'node' 'node'
$git = Resolve-Tool $GitExecutable 'git' 'git'
$python = Resolve-Tool $PythonExecutable 'python' 'python'
$cadPythonTool = Resolve-Tool $CadPython 'cadPython' 'python'
$compilerSetting = Select-Setting $CompilerBin 'compilerBin'
$pgliteSetting = Select-Setting $PgliteModule 'pgliteModule'
if (-not $pgliteSetting -and $env:FREEZER_PGLITE_MODULE) { $pgliteSetting = @{ value = $env:FREEZER_PGLITE_MODULE; source = 'env:FREEZER_PGLITE_MODULE' } }
$benchSetting = Select-Setting $BenchProject 'benchProject'

$pathEntries = @()
if ($compilerSetting) { $pathEntries += $compilerSetting.value }
foreach ($tool in @($git, $node)) { if ($tool.path) { $pathEntries += (Split-Path -Parent $tool.path) } }
$childPath = (@($pathEntries) + @($env:PATH)) -join ';'
$baseEnv = @{ PATH = $childPath; NEXT_TELEMETRY_DISABLED = '1' }

# --- Stage selection -------------------------------------------------------

$firmwareOnlyStages = @('firmware-native-tests', 'firmware-build-fleet', 'firmware-build-prototype', 'firmware-image-isolation')
$allStageNames = @('firmware-native-tests', 'firmware-build-fleet', 'firmware-build-prototype', 'firmware-image-isolation',
    'firmware-bench-build', 'web-tests', 'web-typecheck', 'web-build', 'automation-tests', 'restore-rehearsal-report',
    'cad-tests', 'cad-export-verification', 'release-manifest', 'preservation-check')

$fw = Join-Path $root 'firmware'
$web = Join-Path $root 'web'
$cad = Join-Path $root 'cad_enclosure'
$cadRevision = Join-Path $cad 'revision_pt1000_2026-10-17'
$fleetImage = Join-Path $fw '.pio/build/esp32-s3/firmware.bin'
$prototypeImage = Join-Path $fw '.pio/build/prototype-22/firmware.bin'

function Get-ProtectedHashes {
    # CAD models and dated outputs must be byte-identical after any QA run.
    $map = [ordered]@{}
    foreach ($file in Get-ChildItem -LiteralPath $cad -Recurse -File -Force | Where-Object { $_.FullName -notmatch '[\\/]__pycache__[\\/]' } | Sort-Object FullName) {
        $map[$file.FullName.Substring($root.Length + 1)] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
    }
    return $map
}

function Get-Artifact([string]$Path) {
    $item = Get-Item -LiteralPath $Path
    return [ordered]@{ path = $Path; bytes = $item.Length; sha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
}

function Test-StageDependency($Context, [string[]]$Names) {
    foreach ($name in $Names) {
        $status = Get-QaStageStatus $Context $name
        if ($status -ne 'passed') { return "depends on $name ($status)" }
    }
    return $null
}

$requirePlatformIo = {
    if (-not $python.path) { return $python.error }
    if (-not $script:platformIoVersion) { return "PlatformIO is not importable by $($python.path)" }
    return $null
}
$requireNativeCompiler = {
    $reason = & $requirePlatformIo
    if ($reason) { return $reason }
    if ($compilerSetting) {
        if (-not (Test-Path -LiteralPath $compilerSetting.value)) { return "configured compilerBin was not found: $($compilerSetting.value)" }
        if (-not (Get-ChildItem -LiteralPath $compilerSetting.value -Filter 'gcc*' -ErrorAction SilentlyContinue)) { return "no gcc in compilerBin $($compilerSetting.value)" }
        return $null
    }
    if (-not (Get-Command gcc -ErrorAction SilentlyContinue)) { return "no native gcc on PATH; configure 'compilerBin'" }
    return $null
}
$requirePublicFirmwareConfig = {
    $reason = & $requirePlatformIo
    if ($reason) { return $reason }
    if (Test-Path -LiteralPath (Join-Path $fw 'include/device_security.h')) {
        return 'private firmware/include/device_security.h is present; QA builds must use synthetic public configuration only'
    }
    return $null
}
$requireNode = { if (-not $node.path) { return $node.error }; return $null }
$requireWebModules = {
    if (-not $node.path) { return $node.error }
    foreach ($relative in 'node_modules/typescript/bin/tsc', 'node_modules/next/dist/bin/next') {
        if (-not (Test-Path -LiteralPath (Join-Path $web $relative))) { return "web/$relative is missing; install web dependencies outside OneDrive first" }
    }
    return $null
}
$requirePglite = {
    if (-not $node.path) { return $node.error }
    if (-not $pgliteSetting) { return "PGlite module is not configured; set 'pgliteModule' or FREEZER_PGLITE_MODULE" }
    if (-not (Test-Path -LiteralPath $pgliteSetting.value)) { return "configured PGlite module was not found: $($pgliteSetting.value)" }
    return $null
}
$requireCad = {
    if (-not $cadPythonTool.path) { return $cadPythonTool.error }
    if (-not $script:cadVersion) { return "CadQuery/trimesh are not importable by $($cadPythonTool.path)" }
    return $null
}

$stageList = @(
    (New-QaStage -Name 'firmware-native-tests' -Description 'Firmware host tests (production queue/identity/transport code against fixtures)' -Prerequisite $requireNativeCompiler -Run {
        param($Context, $Log)
        $p = Invoke-QaProcess -FilePath $python.path -ArgumentList @('-m', 'platformio', 'test', '-e', 'native') -WorkingDirectory $fw -LogPath $Log -Environment $baseEnv
        $outcome = Get-QaOutcome $p (Get-QaPlatformIoTestCounts $p.Output) -ExpectCounts
        if ($outcome.Status -eq 'blocked' -and (Test-QaApplicationControlBlock $p.Output)) {
            # One logged retry: the policy can refuse a new binary transiently.
            Add-QaLog $Log "### Application Control refused a test executable; retrying the suite once`r`n"
            $p = Invoke-QaProcess -FilePath $python.path -ArgumentList @('-m', 'platformio', 'test', '-e', 'native') -WorkingDirectory $fw -LogPath $Log -Environment $baseEnv
            $outcome = Get-QaOutcome $p (Get-QaPlatformIoTestCounts $p.Output) -ExpectCounts
            if ($outcome.Status -eq 'passed') { $outcome.Reason = 'passed on the logged retry after a WinError 4551 Application Control refusal' }
        }
        $outcome
    }),
    (New-QaStage -Name 'firmware-build-fleet' -Description 'Compile-only 21-freezer fleet image' -Prerequisite $requirePublicFirmwareConfig -Run {
        param($Context, $Log)
        $p = Invoke-QaProcess -FilePath $python.path -ArgumentList @('-m', 'platformio', 'run', '-e', 'esp32-s3') -WorkingDirectory $fw -LogPath $Log -Environment $baseEnv
        $outcome = Get-QaOutcome $p
        if ($outcome.Status -eq 'passed') {
            if (-not (Test-Path -LiteralPath $fleetImage)) { return @{ Status = 'failed'; Reason = 'build reported success but firmware.bin is missing'; ExitCode = 0; Counts = $null } }
            $outcome.Artifacts = @(Get-Artifact $fleetImage)
        }
        $outcome
    }),
    (New-QaStage -Name 'firmware-build-prototype' -Description 'Compile-only Prototype 22 image with synthetic Wi-Fi fixture' -Prerequisite {
        $reason = & $requirePublicFirmwareConfig
        if ($reason) { return $reason }
        $header = Join-Path $fw 'include/prototype22_wifi.h'
        if (-not (Test-Path -LiteralPath $header)) { return 'firmware/include/prototype22_wifi.h is missing; copy the COMPILE_ONLY example for QA builds' }
        if ((Get-Content -Raw -LiteralPath $header) -notmatch 'COMPILE_ONLY') { return 'prototype22_wifi.h is not the synthetic COMPILE_ONLY fixture; refusing to build with private Wi-Fi settings' }
        return $null
    } -Run {
        param($Context, $Log)
        $p = Invoke-QaProcess -FilePath $python.path -ArgumentList @('-m', 'platformio', 'run', '-e', 'prototype-22') -WorkingDirectory $fw -LogPath $Log -Environment $baseEnv
        $outcome = Get-QaOutcome $p
        if ($outcome.Status -eq 'passed') {
            if (-not (Test-Path -LiteralPath $prototypeImage)) { return @{ Status = 'failed'; Reason = 'build reported success but firmware.bin is missing'; ExitCode = 0; Counts = $null } }
            $outcome.Artifacts = @(Get-Artifact $prototypeImage)
        }
        $outcome
    }),
    (New-QaStage -Name 'firmware-image-isolation' -Description 'Prototype-only markers present in the prototype image and absent from the fleet image' -Prerequisite {
        param($Context)
        Test-StageDependency $Context @('firmware-build-fleet', 'firmware-build-prototype')
    } -Run {
        param($Context, $Log)
        # GetEncoding(28591) is Latin-1; Encoding.Latin1 is absent in Windows PowerShell 5.1.
        $latin1 = [System.Text.Encoding]::GetEncoding(28591)
        $fleetText = $latin1.GetString([System.IO.File]::ReadAllBytes($fleetImage))
        $prototypeText = $latin1.GetString([System.IO.File]::ReadAllBytes($prototypeImage))
        $failures = @()
        foreach ($marker in @('prototype_id', '/prototype22-queue.jsonl', 'prototype-22')) {
            $inPrototype = $prototypeText.Contains($marker)
            $inFleet = $fleetText.Contains($marker)
            Add-QaLog $Log "marker '$marker': prototype=$inPrototype fleet=$inFleet`r`n"
            if (-not $inPrototype -or $inFleet) { $failures += $marker }
        }
        if ($failures.Count) { return @{ Status = 'failed'; Reason = "isolation failed for $($failures -join ', ')"; ExitCode = $null; Counts = $null } }
        @{ Status = 'passed'; Reason = $null; ExitCode = $null; Counts = $null }
    }),
    (New-QaStage -Name 'firmware-bench-build' -Description 'Configured standalone sensor-only bench build, compiled from a copy' -Required ([bool]$benchSetting) `
        -OptionalSkipReason "optional: no bench project configured ('benchProject')" -Prerequisite {
        $reason = & $requirePlatformIo
        if ($reason) { return $reason }
        if (-not (Test-Path -LiteralPath (Join-Path $benchSetting.value 'platformio.ini'))) { return "bench project not found: $($benchSetting.value)" }
        return $null
    } -Run {
        param($Context, $Log)
        $source = (Resolve-Path -LiteralPath $benchSetting.value).Path
        $copy = Join-Path $Context.OutputDir 'work/firmware_pt1000_bench'
        # Reuse cached library sources but never a previous build output.
        foreach ($file in Get-ChildItem -LiteralPath $source -Recurse -File -Force | Where-Object { $_.FullName -notmatch '[\\/]\.pio[\\/]build[\\/]' }) {
            $target = Join-Path $copy $file.FullName.Substring($source.Length + 1)
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
            Copy-Item -LiteralPath $file.FullName -Destination $target
        }
        $p = Invoke-QaProcess -FilePath $python.path -ArgumentList @('-m', 'platformio', 'run', '-e', 'esp32-s3') -WorkingDirectory $copy -LogPath $Log -Environment $baseEnv
        $outcome = Get-QaOutcome $p
        $image = Join-Path $copy '.pio/build/esp32-s3/firmware.bin'
        if ($outcome.Status -eq 'passed') {
            if (-not (Test-Path -LiteralPath $image)) { return @{ Status = 'failed'; Reason = 'bench build reported success but firmware.bin is missing'; ExitCode = 0; Counts = $null } }
            $sources = foreach ($file in Get-ChildItem -LiteralPath $source -Recurse -File | Where-Object { $_.FullName -notmatch '[\\/]\.pio[\\/]' } | Sort-Object FullName) {
                [ordered]@{ path = $file.FullName.Substring($source.Length + 1); sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
            }
            $outcome.Artifacts = @((Get-Artifact $image), [ordered]@{ bench_source_files = @($sources) })
        }
        $outcome
    }),
    (New-QaStage -Name 'web-tests' -Description 'Dashboard/API tests (npm test script, run with the configured node)' -Prerequisite $requireWebModules -Run {
        param($Context, $Log)
        $script = (Get-Content -Raw -LiteralPath (Join-Path $web 'package.json') | ConvertFrom-Json).scripts.test
        if ($script -notmatch '^node\s+') { return @{ Status = 'failed'; Reason = "unsupported web test script: $script"; ExitCode = $null; Counts = $null } }
        $arguments = @(($script -replace '^node\s+', '') -split '\s+' | Where-Object { $_ })
        $p = Invoke-QaProcess -FilePath $node.path -ArgumentList $arguments -WorkingDirectory $web -LogPath $Log -Environment $baseEnv
        Get-QaOutcome $p (Get-QaNodeTestCounts $p.Output) -ExpectCounts
    }),
    (New-QaStage -Name 'web-typecheck' -Description 'TypeScript --noEmit' -Prerequisite $requireWebModules -Run {
        param($Context, $Log)
        $p = Invoke-QaProcess -FilePath $node.path -ArgumentList @('node_modules/typescript/bin/tsc', '--noEmit') -WorkingDirectory $web -LogPath $Log -Environment $baseEnv
        Get-QaOutcome $p
    }),
    (New-QaStage -Name 'web-build' -Description 'Next.js production build with synthetic public configuration' -Prerequisite {
        $reason = & $requireWebModules
        if ($reason) { return $reason }
        $envFiles = @(Get-ChildItem -LiteralPath $web -Force -Filter '.env*' | Where-Object { $_.Name -ne '.env.example' })
        if ($envFiles.Count) { return "web contains $(@($envFiles | ForEach-Object Name) -join ', '); QA builds use synthetic public configuration only" }
        return $null
    } -Run {
        param($Context, $Log)
        $buildEnv = $baseEnv.Clone()
        $buildEnv['NEXT_PUBLIC_SUPABASE_URL'] = 'https://synthetic-qa-fixture.invalid'
        $buildEnv['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'] = 'synthetic-qa-public-fixture-not-a-credential'
        $p = Invoke-QaProcess -FilePath $node.path -ArgumentList @('node_modules/next/dist/bin/next', 'build') -WorkingDirectory $web -LogPath $Log -Environment $buildEnv
        Get-QaOutcome $p
    }),
    (New-QaStage -Name 'automation-tests' -Description 'Automation, export/import, audit, pilot-report, runner and PostgreSQL tests' -Prerequisite {
        $reason = & $requirePglite
        if ($reason) { return $reason }
        if (-not $git.path) { return $git.error }
        return $null
    } -Run {
        param($Context, $Log)
        $testEnv = $baseEnv.Clone()
        $testEnv['FREEZER_PGLITE_MODULE'] = $pgliteSetting.value
        $p = Invoke-QaProcess -FilePath $node.path -ArgumentList @('--test', 'scripts/*.test.mjs') -WorkingDirectory $root -LogPath $Log -Environment $testEnv
        Get-QaOutcome $p (Get-QaNodeTestCounts $p.Output) -ExpectCounts
    }),
    (New-QaStage -Name 'restore-rehearsal-report' -Description 'Synthetic export/import recovery rehearsal report in isolated PGlite' -Prerequisite $requirePglite -Run {
        param($Context, $Log)
        $out = Join-Path $Context.OutputDir 'restore-rehearsal'
        $p = Invoke-QaProcess -FilePath $node.path -ArgumentList @('scripts/restore-rehearsal.mjs', '--output-dir', $out, '--pglite-module', $pgliteSetting.value) -WorkingDirectory $root -LogPath $Log -Environment $baseEnv
        $outcome = Get-QaOutcome $p
        if ($outcome.Status -eq 'passed') { $outcome.Artifacts = @(Get-Artifact (Join-Path $out 'restore-rehearsal.json')) }
        $outcome
    }),
    (New-QaStage -Name 'cad-tests' -Description 'CAD solid/mesh regressions (chosen geometry only; F02 acceptance stays open)' -Prerequisite $requireCad -Run {
        param($Context, $Log)
        $cadEnv = $baseEnv.Clone()
        $cadEnv['PYTHONDONTWRITEBYTECODE'] = '1'
        $p = Invoke-QaProcess -FilePath $cadPythonTool.path -ArgumentList @('-m', 'unittest', 'discover', '-s', '.', '-p', 'test*.py', '-v') -WorkingDirectory $cad -LogPath $Log -Environment $cadEnv
        Get-QaOutcome $p (Get-QaUnittestCounts $p.Output) -ExpectCounts
    }),
    (New-QaStage -Name 'cad-export-verification' -Description 'Re-verify dated STEP/STL exports on a copy and match recorded results' -Prerequisite $requireCad -Run {
        param($Context, $Log)
        $copy = Join-Path $Context.OutputDir 'work/cad-revision-check'
        New-Item -ItemType Directory -Force -Path $copy | Out-Null
        Get-ChildItem -LiteralPath $cadRevision -File | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $copy }
        $cadEnv = $baseEnv.Clone()
        $cadEnv['PYTHONDONTWRITEBYTECODE'] = '1'
        $p = Invoke-QaProcess -FilePath $cadPythonTool.path -ArgumentList @((Join-Path $cad 'verify_enclosure_exports.py'), $copy) -WorkingDirectory $Context.OutputDir -LogPath $Log -Environment $cadEnv
        $outcome = Get-QaOutcome $p
        if ($outcome.Status -ne 'passed') { return $outcome }
        $mismatches = @()
        foreach ($name in 'mesh_verification.json', 'sha256.json') {
            $recorded = (Get-FileHash -LiteralPath (Join-Path $cadRevision $name) -Algorithm SHA256).Hash
            $regenerated = (Get-FileHash -LiteralPath (Join-Path $copy $name) -Algorithm SHA256).Hash
            Add-QaLog $Log "$name recorded=$recorded regenerated=$regenerated`r`n"
            if ($recorded -ne $regenerated) { $mismatches += $name }
        }
        if ($mismatches.Count) { return @{ Status = 'failed'; Reason = "regenerated $($mismatches -join ', ') differ from the dated record"; ExitCode = 0; Counts = $null } }
        $outcome
    }),
    (New-QaStage -Name 'release-manifest' -Description 'Existing release-manifest tool: source fingerprint and image hashes' -Prerequisite {
        param($Context)
        if (-not $node.path) { return $node.error }
        if (-not $git.path) { return $git.error }
        Test-StageDependency $Context @('firmware-build-fleet', 'firmware-build-prototype')
    } -Run {
        param($Context, $Log)
        $images = @($fleetImage, $prototypeImage)
        $bench = Join-Path $Context.OutputDir 'work/firmware_pt1000_bench/.pio/build/esp32-s3/firmware.bin'
        if ((Get-QaStageStatus $Context 'firmware-bench-build') -eq 'passed') { $images += $bench }
        $manifestPath = Join-Path $Context.OutputDir 'release-manifest.json'
        $p = Invoke-QaProcess -FilePath $node.path -ArgumentList (@('scripts/create-release-manifest.mjs', '--output', $manifestPath) + $images) -WorkingDirectory $root -LogPath $Log -Environment $baseEnv
        $outcome = Get-QaOutcome $p
        if ($outcome.Status -ne 'passed') { return $outcome }
        $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
        if (-not $manifest.git_commit -or -not $manifest.source_sha256) {
            return @{ Status = 'failed'; Reason = 'manifest lacks git commit/source fingerprint (git unavailable to the tool?)'; ExitCode = 0; Counts = $null }
        }
        $script:releaseManifest = $manifest
        $outcome.Artifacts = @(Get-Artifact $manifestPath)
        $outcome
    }),
    (New-QaStage -Name 'preservation-check' -Description 'CAD models and dated outputs byte-identical before and after this run' -Run {
        param($Context, $Log)
        $after = Get-ProtectedHashes
        $changed = @()
        foreach ($key in @($script:protectedBefore.Keys) + @($after.Keys) | Sort-Object -Unique) {
            if ($script:protectedBefore[$key] -ne $after[$key]) { $changed += $key }
        }
        Add-QaLog $Log "checked $($after.Count) files under cad_enclosure; changed: $($changed.Count)`r`n"
        foreach ($item in $changed) { Add-QaLog $Log "changed: $item`r`n" }
        if ($changed.Count) { return @{ Status = 'failed'; Reason = "$($changed.Count) protected CAD file(s) changed"; ExitCode = $null; Counts = $null } }
        @{ Status = 'passed'; Reason = $null; ExitCode = $null; Counts = [ordered]@{ total = $after.Count; passed = $after.Count; failed = 0; skipped = 0 } }
    })
)

if ($ListStages) {
    $stageList | ForEach-Object { '{0,-26} required={1,-5} {2}' -f $_.Name, $_.Required, $_.Description }
    exit 0
}

if ($Stages) {
    $selected = @($Stages | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    $unknown = @($selected | Where-Object { $_ -notin $allStageNames })
    if ($unknown.Count) { throw "Unknown stage(s): $($unknown -join ', '). Use -ListStages." }
    $suiteName = 'custom'
    $fullRun = $false
} elseif ($FirmwareOnly -or $Suite -eq 'firmware-only') {
    $selected = $firmwareOnlyStages
    $suiteName = 'firmware-only'
    $fullRun = $false
} else {
    $selected = @($allStageNames | Where-Object { $_ -ne 'firmware-bench-build' -or $benchSetting })
    $suiteName = 'full'
    $fullRun = $true
}

if (-not $OutputDir) {
    $OutputDir = Join-Path (Split-Path -Parent $root) ('qa-runs\{0}-{1}' -f (Split-Path -Leaf $root), (Get-Date -Format 'yyyyMMdd-HHmmss'))
}
$context = New-QaContext -OutputDir $OutputDir -Selected $selected -Suite $suiteName -FullRun $fullRun

# --- Versions and checkout state (recorded even when a stage is blocked) -----

$versionLog = Join-Path $context.LogDir 'tool-versions.log'
function Get-ToolVersion([string]$Path, [string[]]$Arguments, [hashtable]$Environment = $baseEnv) {
    if (-not $Path) { return $null }
    $result = Invoke-QaProcess -FilePath $Path -ArgumentList $Arguments -WorkingDirectory $root -LogPath $versionLog -Environment $Environment -TimeoutSeconds 120
    if ($result.ExitCode -ne 0) { return $null }
    return (($result.Output -split "`r?`n") | Where-Object { $_.Trim() } | Select-Object -First 1).Trim()
}
$script:platformIoVersion = Get-ToolVersion $python.path @('-m', 'platformio', '--version')
$script:cadVersion = Get-ToolVersion $cadPythonTool.path @('-c', 'import cadquery, trimesh, OCP; print("cadquery", cadquery.__version__, "trimesh", trimesh.__version__, "OCP", OCP.__version__)')
$gccVersion = Get-ToolVersion $env:ComSpec @('/d', '/c', 'gcc --version')
$pgliteVersion = $null
if ($pgliteSetting -and (Test-Path -LiteralPath $pgliteSetting.value)) {
    try { $pgliteVersion = (Get-Content -Raw -LiteralPath (Join-Path (Split-Path -Parent (Split-Path -Parent $pgliteSetting.value)) 'package.json') | ConvertFrom-Json).version } catch { }
}
$tools = [ordered]@{
    node = @{ path = $node.path; source = $node.source; version = (Get-ToolVersion $node.path @('--version')) }
    git = @{ path = $git.path; source = $git.source; version = (Get-ToolVersion $git.path @('--version')) }
    python = @{ path = $python.path; source = $python.source; version = (Get-ToolVersion $python.path @('--version')) }
    platformio = @{ path = $python.path; source = $python.source; version = $script:platformIoVersion }
    native_compiler = @{ path = $(if ($compilerSetting) { $compilerSetting.value } else { 'PATH' }); source = $(if ($compilerSetting) { $compilerSetting.source } else { 'PATH' }); version = $gccVersion }
    cad_python = @{ path = $cadPythonTool.path; source = $cadPythonTool.source; version = $script:cadVersion }
    pglite = @{ path = $(if ($pgliteSetting) { $pgliteSetting.value } else { $null }); source = $(if ($pgliteSetting) { $pgliteSetting.source } else { 'not configured' }); version = $pgliteVersion }
}
$checkout = [ordered]@{ path = $root; git_commit = $null; git_dirty = $null; changed_paths = $null }
if ($git.path) {
    $head = Invoke-QaProcess -FilePath $git.path -ArgumentList @('rev-parse', 'HEAD') -WorkingDirectory $root -LogPath $versionLog -Environment $baseEnv -TimeoutSeconds 60
    $status = Invoke-QaProcess -FilePath $git.path -ArgumentList @('status', '--porcelain=v1') -WorkingDirectory $root -LogPath $versionLog -Environment $baseEnv -TimeoutSeconds 60
    if ($head.ExitCode -eq 0) { $checkout.git_commit = $head.Output.Trim() }
    if ($status.ExitCode -eq 0) {
        $lines = @(($status.Output -split "`r?`n") | Where-Object { $_.Trim() })
        $checkout.git_dirty = $lines.Count -gt 0
        $checkout.changed_paths = $lines.Count
    }
}
$script:protectedBefore = Get-ProtectedHashes

$results = Invoke-QaRun -Stages $stageList -Context $context -Tools $tools -Checkout $checkout -Limitations @(
    'Local checks only: no flashing, deployment, Supabase/production access, HTTP-server/browser smoke test or hardware operation.',
    'Firmware images are compile-only builds with synthetic public configuration; never flash them.',
    'CAD stages verify the chosen digital geometry and dated exports only; F02 orientation and F01 physical-fit acceptance remain open.',
    'The restore rehearsal uses labeled synthetic fixtures in in-process PGlite; it is not a production backup or restore.'
)
if ($script:releaseManifest) {
    $results['release'] = [ordered]@{ git_commit = $script:releaseManifest.git_commit; git_dirty = $script:releaseManifest.git_dirty
        source_sha256 = $script:releaseManifest.source_sha256; firmware_defaults = $script:releaseManifest.firmware_defaults
        artifacts = $script:releaseManifest.artifacts }
    [System.IO.File]::WriteAllText((Join-Path $context.OutputDir 'results.json'), ($results | ConvertTo-Json -Depth 10), (New-Object System.Text.UTF8Encoding $false))
}

Write-Output ("QA {0}: {1} passed, {2} failed, {3} blocked, {4} skipped. Results: {5}" -f $results.overall.status.ToUpperInvariant(),
    $results.summary.passed, $results.summary.failed, $results.summary.blocked, $results.summary.skipped, (Join-Path $context.OutputDir 'results.md'))
foreach ($stage in $results.stages | Where-Object { $_.status -in 'failed', 'blocked' }) {
    Write-Output ("  {0}: {1} - {2}" -f $stage.name, $stage.status, $stage.reason)
}
Write-Output 'Local checks only; not a flash, deployment or live sensor verification.'
exit $results.overall.exit_code
