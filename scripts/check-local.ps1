# Local-only readiness checks. This script never uploads firmware or writes to Supabase.
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$resolvedRoot = [System.IO.Path]::GetFullPath($root)
if ($resolvedRoot -match '(?i)[\\/]OneDrive[^\\/]*[\\/]') {
    throw 'Builds are disabled inside OneDrive. Copy the project outside the synced folder before running check-local.ps1.'
}

function Run-Checked([string]$Directory, [string]$Program, [string[]]$Arguments) {
    Push-Location -LiteralPath (Join-Path $root $Directory)
    try {
        & $Program @Arguments
        if ($LASTEXITCODE -ne 0) { throw "$Program $($Arguments -join ' ') failed with exit code $LASTEXITCODE" }
    } finally {
        Pop-Location
    }
}

Run-Checked 'firmware' 'pio' @('test', '-e', 'native')
foreach ($environment in @('esp32-s3', 'prototype-22')) {
    Run-Checked 'firmware' 'pio' @('run', '-e', $environment)
}
$fleetImage = Join-Path $root 'firmware/.pio/build/esp32-s3/firmware.bin'
$image = Join-Path $root 'firmware/.pio/build/prototype-22/firmware.bin'
# GetEncoding(28591) is Latin-1; the Encoding.Latin1 property is absent in Windows PowerShell 5.1.
$latin1 = [System.Text.Encoding]::GetEncoding(28591)
$fleetText = $latin1.GetString([System.IO.File]::ReadAllBytes($fleetImage))
$prototypeText = $latin1.GetString([System.IO.File]::ReadAllBytes($image))
foreach ($marker in @('/rest/v1/prototype_readings', '/prototype22-queue.jsonl', 'ult-prototype-22')) {
    if (-not $prototypeText.Contains($marker) -or $fleetText.Contains($marker)) {
        throw "Prototype image isolation check failed for $marker"
    }
}
Run-Checked 'web' 'npm.cmd' @('test')
Run-Checked 'web' 'npx.cmd' @('tsc', '--noEmit')
Run-Checked 'web' 'npm.cmd' @('run', 'build')
Run-Checked '.' 'node' @('--test', 'scripts/prototype-check.test.mjs')

$hash = (Get-FileHash -LiteralPath $image -Algorithm SHA256).Hash
Write-Output "Local checks passed. Prototype 22 image SHA-256: $hash"
Write-Output 'This is a local build, not a flash or a live sensor verification.'
