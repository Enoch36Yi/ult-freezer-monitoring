# One-command bench-day preparation for Prototype 22. RUN THIS YOURSELF in a
# normal PowerShell window (it asks for the Wi-Fi name/password interactively,
# so the secret never enters a chat, a log, or this OneDrive-synced folder).
#
# What it does:
#   1. Stages firmware source into a private folder OUTSIDE OneDrive.
#   2. Writes the network you type into the STAGED copy of prototype22_wifi.h.
#   3. Builds the shared prototype-22 image there (no upload, no erase).
#   4. Prints image paths + SHA-256 and lists the Espressif serial ports it sees.
#
# What it never does: upload/flash, erase, touch Supabase or Vercel, or print
# the password. Flashing needs a fresh direct "elephant" to Claude/Codex.
#
# -KeepCurrentHeader skips the prompt and builds with the network already in
# firmware/include/prototype22_wifi.h (a pipeline test, or the same network).
[CmdletBinding()]
param([switch]$KeepCurrentHeader)

$ErrorActionPreference = 'Stop'

# --- 1. Stage outside OneDrive ------------------------------------------------
$stageOutput = & (Join-Path $PSScriptRoot 'stage-prototype-firmware.ps1')
$line = $stageOutput | Where-Object { $_ -like 'Firmware source staged outside OneDrive:*' } | Select-Object -First 1
if (-not $line) { throw 'Staging did not report a directory.' }
$staged = ($line -replace '^Firmware source staged outside OneDrive:\s*', '').Trim()
if ($staged -match '(?i)[\\/]OneDrive[^\\/]*[\\/]') { throw "Staged path is inside OneDrive: $staged" }
if (-not (Test-Path -LiteralPath (Join-Path $staged 'platformio.ini'))) { throw "Staging looks incomplete: $staged" }
Write-Output "Staged: $staged"

# --- 2. Wi-Fi for tomorrow's network (staged copy only) -----------------------
if ($KeepCurrentHeader) {
    Write-Output 'Keeping the network already in prototype22_wifi.h (not shown).'
} else {
$ssid = Read-Host 'Wi-Fi network name (SSID, must be 2.4 GHz, plain WPA2 password)'
$secure = Read-Host 'Wi-Fi password' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }

if ([string]::IsNullOrEmpty($ssid) -or $ssid.Length -gt 32) { throw 'SSID must be 1-32 characters.' }
if ($password.Length -lt 8 -or $password.Length -gt 63) { throw 'WPA2 password must be 8-63 characters (open networks are not supported by this header).' }
foreach ($value in @($ssid, $password)) {
    if ($value -match '["\\\r\n]') { throw 'Quotes, backslashes, and line breaks are not supported in the compiled header. Use a network without them.' }
}

$header = "#pragma once`r`n`r`n#define PROTOTYPE22_WIFI_SSID `"$ssid`"`r`n#define PROTOTYPE22_WIFI_PASSWORD `"$password`"`r`n"
[System.IO.File]::WriteAllText((Join-Path $staged 'include\prototype22_wifi.h'), $header, [System.Text.UTF8Encoding]::new($false))
$password = $null
Write-Output 'Wrote network into the staged header (value not shown).'
}

# --- 3. Build (no upload) -----------------------------------------------------
$environments = @('prototype-22')
Push-Location -LiteralPath $staged
try {
    foreach ($environment in $environments) {
        Write-Output "Building $environment ..."
        # Windows PowerShell 5.1 turns any native stderr line (e.g. a Python
        # warning) into a terminating error under 'Stop'; judge by exit code.
        $ErrorActionPreference = 'Continue'
        & python -m platformio run -e $environment 2>&1 | ForEach-Object { "$_" }
        $ErrorActionPreference = 'Stop'
        if ($LASTEXITCODE -ne 0) { throw "Build of $environment failed (exit $LASTEXITCODE). Nothing was uploaded." }
    }
} finally {
    Pop-Location
}

$latin1 = [System.Text.Encoding]::GetEncoding(28591)
foreach ($environment in $environments) {
    $image = Join-Path $staged ".pio\build\$environment\firmware.bin"
    $text = $latin1.GetString([System.IO.File]::ReadAllBytes($image))
    # Sanity: prototype identity present and fleet endpoint path absent as a
    # whole string.
    foreach ($marker in @('/rest/v1/prototype_readings', '/prototype22-queue.jsonl', 'ult-prototype-22')) {
        if (-not $text.Contains($marker)) { throw "$environment image lacks $marker; do not flash it." }
    }
    $hash = (Get-FileHash -LiteralPath $image -Algorithm SHA256).Hash
    $size = (Get-Item -LiteralPath $image).Length
    Write-Output ("{0}: {1} bytes, SHA-256 {2} (identity markers ok)" -f $environment, $size, $hash)
}

# --- 4. What is plugged in? ---------------------------------------------------
Write-Output ''
Write-Output 'Serial ports now (Espressif = VID_303A&PID_1001):'
Get-CimInstance Win32_PnPEntity | Where-Object { $_.Name -match '\(COM\d+\)' } |
    ForEach-Object {
        $tag = if ($_.DeviceID -match 'VID_303A&PID_1001') { '  <-- Espressif' } else { '' }
        "  {0}{1}" -f $_.Name, $tag
    }

Write-Output ''
Write-Output "Staged build folder: $staged"
Write-Output 'Built only. Nothing flashed. Tell Claude the COM port + which image, then give your direct "elephant" when ready.'
Write-Output 'The staged folder and its .bin files contain the Wi-Fi password: do not share them.'
