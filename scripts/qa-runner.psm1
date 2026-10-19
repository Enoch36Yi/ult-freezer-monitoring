# Local QA runner engine used by scripts/check-local.ps1.
#
# Each stage runs as a child process with its own log. A stage is exactly one
# of: passed, failed (ran and did not meet its check), blocked (a prerequisite
# or upstream stage is missing) or skipped (not requested, or optional and not
# configured). A run reports success only when every requested required stage
# passed; a full run additionally requires every required stage. Nothing here
# uploads firmware, deploys, or contacts Supabase.
Set-StrictMode -Version 2.0

# A Windows PowerShell child can inherit a bundled PowerShell 7 module path.
# Load the current host's standard Utility module explicitly so Get-FileHash
# and JSON/report commands resolve correctly in both the engine and its caller.
# This affects this process only; no machine module path or policy is changed.
Import-Module ([System.IO.Path]::Combine($PSHOME, 'Modules', 'Microsoft.PowerShell.Utility', 'Microsoft.PowerShell.Utility.psd1')) -Global -ErrorAction Stop

# Server-side credentials must never reach QA child processes.
$script:ScrubbedVariables = @(
    'INGEST_DEVICE_SECRETS_JSON', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY',
    'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD',
    'VERCEL_TOKEN', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'
)
$script:Utf8 = New-Object System.Text.UTF8Encoding $false

function Test-QaOneDrivePath([string]$Path) {
    $full = [System.IO.Path]::GetFullPath($Path).TrimEnd('\', '/') + '\'
    return $full -match '(?i)[\\/]OneDrive[^\\/]*[\\/]'
}

# Windows command-line quoting compatible with the MSVC runtime parser.
function ConvertTo-QaArgument([string]$Value) {
    if ($Value -ne '' -and $Value -notmatch '[\s"]') { return $Value }
    $escaped = [regex]::Replace($Value, '(\\*)"', '$1$1\"')
    $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
    return '"' + $escaped + '"'
}

function Add-QaLog([string]$LogPath, [string]$Text) {
    [System.IO.File]::AppendAllText($LogPath, $Text, $script:Utf8)
}

function Invoke-QaProcess {
    param(
        [Parameter(Mandatory)] [string]$FilePath,
        [string[]]$ArgumentList = @(),
        [Parameter(Mandatory)] [string]$WorkingDirectory,
        [Parameter(Mandatory)] [string]$LogPath,
        [hashtable]$Environment = @{},
        [int]$TimeoutSeconds = 3600
    )
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $FilePath
    $psi.Arguments = (@($ArgumentList | ForEach-Object { ConvertTo-QaArgument $_ }) -join ' ')
    $psi.WorkingDirectory = $WorkingDirectory
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $psi.StandardOutputEncoding = $script:Utf8
    $psi.StandardErrorEncoding = $script:Utf8
    foreach ($name in $script:ScrubbedVariables) {
        if ($psi.EnvironmentVariables.ContainsKey($name)) { $psi.EnvironmentVariables.Remove($name) }
    }
    $psi.EnvironmentVariables['PYTHONIOENCODING'] = 'utf-8'
    foreach ($key in $Environment.Keys) { $psi.EnvironmentVariables[$key] = [string]$Environment[$key] }

    Add-QaLog $LogPath ("### {0} {1} {2}`r`n### cwd: {3}`r`n" -f (Get-Date).ToUniversalTime().ToString('o'), $FilePath, $psi.Arguments, $WorkingDirectory)
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $psi
    try {
        [void]$process.Start()
    } catch {
        $message = "could not start ${FilePath}: $($_.Exception.Message)"
        Add-QaLog $LogPath "### $message`r`n"
        return @{ ExitCode = $null; TimedOut = $false; Error = $message; Output = '' }
    }
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    $finished = $process.WaitForExit($TimeoutSeconds * 1000)
    if (-not $finished) {
        try { $process.Kill() } catch { }
    }
    $process.WaitForExit()
    $exitCode = if ($finished) { $process.ExitCode } else { $null }
    $output = $stdout.Result + $stderr.Result
    Add-QaLog $LogPath ($stdout.Result + "`r`n### stderr`r`n" + $stderr.Result +
        ("`r`n### exit code: {0}{1}`r`n`r`n" -f $exitCode, $(if ($finished) { '' } else { " (killed after $TimeoutSeconds s)" })))
    return @{ ExitCode = $exitCode; TimedOut = (-not $finished); Error = $null; Output = $output }
}

# --- Test-count parsers. A test stage that cannot prove its counts fails. ----

function Get-QaNodeTestCounts([string]$Output) {
    $counts = @{}
    # The node reporter prefixes summary lines with U+2139, which .NET treats
    # as a letter, so allow any single leading token rather than \W.
    foreach ($match in [regex]::Matches($Output, '(?m)^[ \t]*(?:\S+[ \t]+)?(tests|pass|fail|cancelled|skipped|todo) (\d+)[ \t]*\r?$')) {
        $counts[$match.Groups[1].Value] = [int]$match.Groups[2].Value
    }
    if (-not $counts.ContainsKey('tests')) { return $null }
    return [ordered]@{ total = $counts['tests']; passed = $counts['pass']; failed = ($counts['fail'] + $counts['cancelled']);
        skipped = ($counts['skipped'] + $counts['todo']) }
}

function Get-QaPlatformIoTestCounts([string]$Output) {
    $summary = [regex]::Match($Output, '(\d+) test cases: ([^\r\n]*?) in \d')
    if (-not $summary.Success) { return $null }
    # A suite that errors before running contributes no cases to the summary
    # line, so count those suites separately from the case totals.
    $errored = [regex]::Matches($Output, '(?m)^\S+\s+(\S+)\s+ERRORED\s').Count
    $counts = [ordered]@{ total = [int]$summary.Groups[1].Value; passed = 0; failed = 0; skipped = 0; errored_suites = $errored }
    foreach ($part in [regex]::Matches($summary.Groups[2].Value, '(\d+) (succeeded|failed|errored|skipped|ignored)')) {
        $n = [int]$part.Groups[1].Value
        switch ($part.Groups[2].Value) {
            'succeeded' { $counts.passed += $n }
            { $_ -in 'failed', 'errored' } { $counts.failed += $n }
            default { $counts.skipped += $n }
        }
    }
    return $counts
}

function Get-QaUnittestCounts([string]$Output) {
    $ran = [regex]::Match($Output, '(?m)^Ran (\d+) tests? in ')
    if (-not $ran.Success) { return $null }
    $total = [int]$ran.Groups[1].Value
    $failed = 0; $skipped = 0
    foreach ($match in [regex]::Matches($Output, '(failures|errors|skipped|expected failures|unexpected successes)=(\d+)')) {
        if ($match.Groups[1].Value -eq 'skipped') { $skipped += [int]$match.Groups[2].Value }
        else { $failed += [int]$match.Groups[2].Value }
    }
    return [ordered]@{ total = $total; passed = ($total - $failed - $skipped); failed = $failed; skipped = $skipped }
}

# Windows Application Control (Smart App Control/WDAC) can refuse to execute a
# freshly built host-test binary. That is an environment block, not a result.
function Test-QaApplicationControlBlock([string]$Output) {
    return $Output -match 'WinError 4551|Application Control policy has blocked'
}

# Turns a process result (and optional parsed counts) into a stage outcome.
function Get-QaOutcome($Process, $Counts = $null, [switch]$ExpectCounts) {
    if ($Process.Error) { return @{ Status = 'failed'; Reason = $Process.Error; ExitCode = $null; Counts = $Counts } }
    if ($Process.TimedOut) { return @{ Status = 'failed'; Reason = 'timed out'; ExitCode = $null; Counts = $Counts } }
    if ($Process.ExitCode -ne 0) {
        $testFailures = $Counts -and $Counts.failed -gt 0
        if (-not $testFailures -and (Test-QaApplicationControlBlock $Process.Output)) {
            return @{ Status = 'blocked'; ExitCode = $Process.ExitCode; Counts = $Counts
                Reason = 'Windows Application Control (WinError 4551) refused to run a built test executable; environment policy block, not a test result' }
        }
        $suffix = if ($Counts -and $Counts.Contains('errored_suites') -and $Counts.errored_suites -gt 0) { "; $($Counts.errored_suites) test suite(s) errored" } else { '' }
        return @{ Status = 'failed'; Reason = "exit code $($Process.ExitCode)$suffix"; ExitCode = $Process.ExitCode; Counts = $Counts }
    }
    if ($ExpectCounts) {
        if ($null -eq $Counts) { return @{ Status = 'failed'; Reason = 'exit code 0 but no test summary was found'; ExitCode = 0; Counts = $null } }
        if ($Counts.total -le 0) { return @{ Status = 'failed'; Reason = 'no tests executed'; ExitCode = 0; Counts = $Counts } }
        if ($Counts.failed -gt 0) { return @{ Status = 'failed'; Reason = "$($Counts.failed) test(s) failed"; ExitCode = 0; Counts = $Counts } }
        if ($Counts.Contains('errored_suites') -and $Counts.errored_suites -gt 0) {
            return @{ Status = 'failed'; Reason = "$($Counts.errored_suites) test suite(s) errored"; ExitCode = 0; Counts = $Counts }
        }
        if ($Counts.skipped -gt 0) {
            return @{ Status = 'failed'; Reason = "incomplete: $($Counts.skipped) test(s) skipped in a required check"; ExitCode = 0; Counts = $Counts }
        }
    }
    return @{ Status = 'passed'; Reason = $null; ExitCode = $Process.ExitCode; Counts = $Counts }
}

function New-QaStage {
    param(
        [Parameter(Mandatory)] [string]$Name,
        [Parameter(Mandatory)] [string]$Description,
        [bool]$Required = $true,
        [scriptblock]$Prerequisite = $null,
        [Parameter(Mandatory)] [scriptblock]$Run,
        [string]$OptionalSkipReason = $null
    )
    return [pscustomobject]@{ Name = $Name; Description = $Description; Required = $Required;
        Prerequisite = $Prerequisite; Run = $Run; OptionalSkipReason = $OptionalSkipReason }
}

function Get-QaStageStatus($Context, [string]$Name) {
    if ($Context.Results.Contains($Name)) { return $Context.Results[$Name].status }
    return 'not-run'
}

function Invoke-QaStage($Stage, $Context) {
    $log = Join-Path $Context.LogDir ($Stage.Name + '.log')
    $record = [ordered]@{
        name = $Stage.Name; description = $Stage.Description; required = $Stage.Required
        status = $null; reason = $null; exit_code = $null; started_at_utc = $null; duration_seconds = 0
        log = $null; log_sha256 = $null; counts = $null; artifacts = @()
    }
    if (-not $Context.Selected.Contains($Stage.Name)) {
        $record.status = 'skipped'
        $record.reason = if ($Stage.OptionalSkipReason) { $Stage.OptionalSkipReason } else { 'not requested in this run' }
        $Context.Results[$Stage.Name] = $record
        return $record
    }
    $started = Get-Date
    $record.started_at_utc = $started.ToUniversalTime().ToString('o')
    try {
        $reason = if ($Stage.Prerequisite) { & $Stage.Prerequisite $Context } else { $null }
        if ($reason) {
            $record.status = 'blocked'
            $record.reason = [string]$reason
            Add-QaLog $log "### blocked: $reason`r`n"
        } else {
            $outcome = & $Stage.Run $Context $log
            $record.status = $outcome.Status
            $record.reason = $outcome.Reason
            $record.exit_code = $outcome.ExitCode
            $record.counts = $outcome.Counts
            if ($outcome.ContainsKey('Artifacts') -and $outcome.Artifacts) { $record.artifacts = @($outcome.Artifacts) }
        }
    } catch {
        $record.status = 'failed'
        $record.reason = "runner error: $($_.Exception.Message)"
        Add-QaLog $log "### runner error: $($_.Exception.Message)`r`n"
    }
    if ($record.status -notin 'passed', 'failed', 'blocked') {
        $record.reason = "stage returned invalid status '$($record.status)'"
        $record.status = 'failed'
    }
    $record.duration_seconds = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)
    if (Test-Path -LiteralPath $log) {
        $record.log = 'logs/' + (Split-Path -Leaf $log)
        $record.log_sha256 = (Get-FileHash -LiteralPath $log -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    $Context.Results[$Stage.Name] = $record
    return $record
}

function Get-QaOverall($Context, $Records) {
    $requested = @($Records | Where-Object { $Context.Selected.Contains($_.name) })
    $requiredRequested = @($requested | Where-Object { $_.required })
    $requiredMissing = @($Records | Where-Object { $_.required -and -not $Context.Selected.Contains($_.name) })
    $notPassed = @($requiredRequested | Where-Object { $_.status -ne 'passed' } | ForEach-Object { $_.name })
    if (@($requiredRequested | Where-Object { $_.status -eq 'failed' }).Count -gt 0) {
        $status = 'failed'; $code = 1
    } elseif ($notPassed.Count -gt 0) {
        $status = 'blocked'; $code = 2
    } elseif ($Context.FullRun -and $requiredMissing.Count -gt 0) {
        # Defensive: a full run can never omit a required stage.
        $status = 'blocked'; $code = 2
        $notPassed = @($requiredMissing | ForEach-Object { $_.name })
    } elseif ($requiredRequested.Count -eq 0) {
        $status = 'blocked'; $code = 2
    } elseif ($Context.FullRun) {
        $status = 'passed'; $code = 0
    } else {
        $status = 'partial-passed'; $code = 0
    }
    return [ordered]@{ status = $status; exit_code = $code; required_not_passed = $notPassed;
        required_not_requested = @($requiredMissing | ForEach-Object { $_.name }) }
}

function ConvertTo-QaMarkdown($Results) {
    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add("# Local QA run $($Results.run_id)")
    $lines.Add('')
    $lines.Add("Overall: **$($Results.overall.status.ToUpperInvariant())** (exit code $($Results.overall.exit_code)); suite ``$($Results.suite)``.")
    $lines.Add("Started $($Results.started_at_utc); finished $($Results.finished_at_utc).")
    if ($Results.checkout -and $Results.checkout.git_commit) {
        $lines.Add("Checkout commit ``$($Results.checkout.git_commit)``; dirty: $($Results.checkout.git_dirty) ($($Results.checkout.changed_paths) changed paths).")
    }
    if (@($Results.overall.required_not_passed).Count) { $lines.Add("Required checks not passed: $(@($Results.overall.required_not_passed) -join ', ').") }
    if (@($Results.overall.required_not_requested).Count) { $lines.Add("Required checks not requested (partial run): $(@($Results.overall.required_not_requested) -join ', ').") }
    $lines.Add('')
    $lines.Add('| Stage | Required | Status | Tests (pass/fail/skip) | Duration s | Reason |')
    $lines.Add('| --- | --- | --- | --- | --- | --- |')
    foreach ($stage in $Results.stages) {
        $tests = if ($stage.counts) { "$($stage.counts.passed)/$($stage.counts.failed)/$($stage.counts.skipped)" } else { '' }
        $lines.Add("| $($stage.name) | $($stage.required) | $($stage.status) | $tests | $($stage.duration_seconds) | $($stage.reason) |")
    }
    $lines.Add('')
    $lines.Add('## Tools')
    $lines.Add('')
    foreach ($tool in $Results.tools.GetEnumerator()) {
        $lines.Add("- $($tool.Key): $($tool.Value.version) ($($tool.Value.source))")
    }
    $lines.Add('')
    $lines.Add('## Limitations')
    $lines.Add('')
    foreach ($item in $Results.limitations) { $lines.Add("- $item") }
    return ($lines -join "`r`n") + "`r`n"
}

function Invoke-QaRun {
    param(
        [Parameter(Mandatory)] [object[]]$Stages,
        [Parameter(Mandatory)] $Context,
        [hashtable]$Tools = @{},
        $Checkout = $null,
        [string[]]$Limitations = @()
    )
    $records = foreach ($stage in $Stages) { Invoke-QaStage $stage $Context }
    $overall = Get-QaOverall $Context $records
    $summary = [ordered]@{}
    foreach ($status in 'passed', 'failed', 'blocked', 'skipped') {
        $summary[$status] = @($records | Where-Object { $_.status -eq $status }).Count
    }
    $results = [ordered]@{
        runner_version = 2
        run_id = $Context.RunId
        suite = $Context.Suite
        full_run = [bool]$Context.FullRun
        requested_stages = @($Context.Selected)
        started_at_utc = $Context.StartedAtUtc
        finished_at_utc = (Get-Date).ToUniversalTime().ToString('o')
        checkout = $Checkout
        tools = $Tools
        stages = @($records)
        summary = $summary
        overall = $overall
        limitations = $Limitations
    }
    [System.IO.File]::WriteAllText((Join-Path $Context.OutputDir 'results.json'), ($results | ConvertTo-Json -Depth 10), $script:Utf8)
    [System.IO.File]::WriteAllText((Join-Path $Context.OutputDir 'results.md'), (ConvertTo-QaMarkdown $results), $script:Utf8)
    return $results
}

function New-QaContext {
    param(
        [Parameter(Mandatory)] [string]$OutputDir,
        [Parameter(Mandatory)] [string[]]$Selected,
        [string]$Suite = 'custom',
        [bool]$FullRun = $false,
        [hashtable]$Settings = @{}
    )
    if (Test-QaOneDrivePath $OutputDir) { throw "QA output must stay outside OneDrive: $OutputDir" }
    if ((Test-Path -LiteralPath $OutputDir) -and @(Get-ChildItem -LiteralPath $OutputDir -Force).Count -gt 0) {
        throw "QA output directory already contains files; choose a new directory: $OutputDir"
    }
    $logDir = Join-Path $OutputDir 'logs'
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    $set = New-Object 'System.Collections.Generic.HashSet[string]'
    foreach ($name in $Selected) { [void]$set.Add($name) }
    return [pscustomobject]@{
        RunId = (Split-Path -Leaf $OutputDir)
        OutputDir = (Resolve-Path -LiteralPath $OutputDir).Path
        LogDir = (Resolve-Path -LiteralPath $logDir).Path
        Selected = $set
        Suite = $Suite
        FullRun = $FullRun
        StartedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
        Results = [ordered]@{}
        Settings = $Settings
    }
}

Export-ModuleMember -Function Test-QaOneDrivePath, ConvertTo-QaArgument, Add-QaLog, Invoke-QaProcess,
    Get-QaNodeTestCounts, Get-QaPlatformIoTestCounts, Get-QaUnittestCounts, Test-QaApplicationControlBlock,
    Get-QaOutcome, New-QaStage,
    Get-QaStageStatus, Invoke-QaStage, Get-QaOverall, Invoke-QaRun, New-QaContext
