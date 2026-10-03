# Read-only bench-day readiness check. Prints OK / WARN / FAIL per item.
# Never builds, uploads, resets a board, or writes to Supabase. Never prints
# the Wi-Fi SSID or password.
#   powershell -ExecutionPolicy Bypass -File scripts\bench-preflight.ps1
[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'
$projectRoot = Split-Path -Parent $PSScriptRoot
$failed = $false
function Say([string]$Level, [string]$Text) {
    if ($Level -eq 'FAIL') { $script:failed = $true }
    Write-Output ('[{0,-4}] {1}' -f $Level, $Text)
}

# Toolchain
$pio = (& python -m platformio --version 2>$null | Select-Object -Last 1)
if ($LASTEXITCODE -eq 0 -and $pio) { Say 'OK' "Python + $pio" } else { Say 'FAIL' 'python -m platformio not runnable' }
$esptool = Join-Path $env:USERPROFILE '.platformio\packages\tool-esptoolpy\esptool.py'
if (Test-Path -LiteralPath $esptool) { Say 'OK' "esptool at $esptool" } else { Say 'WARN' 'esptool.py not found (needed only for the MAC check)' }
if (Get-Command node -ErrorAction SilentlyContinue) { Say 'OK' 'Node.js present (prototype-check.mjs usable)' }
else { Say 'OK' 'Node.js absent; use scripts\prototype-check.ps1 instead' }

# Staged build
$stageRoot = Join-Path $env:USERPROFILE 'FreezersFirmwareBuilds'
$stage = Get-ChildItem -LiteralPath $stageRoot -Directory -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1
if (-not $stage) {
    Say 'FAIL' "No staged build in $stageRoot; run scripts\prepare-bench-day.ps1"
} else {
    Say 'OK' "Latest staged build: $($stage.FullName) ($($stage.LastWriteTime))"
    foreach ($environment in @('prototype-22')) {
        $image = Join-Path $stage.FullName ".pio\build\$environment\firmware.bin"
        if (Test-Path -LiteralPath $image) {
            Say 'OK' ("{0}: SHA-256 {1}" -f $environment, (Get-FileHash -LiteralPath $image -Algorithm SHA256).Hash)
        } else { Say 'WARN' "$environment image not built in that folder" }
    }
    # Compare headers by hash only, so the network values never print.
    $stagedHeader = Join-Path $stage.FullName 'include\prototype22_wifi.h'
    $syncedHeader = Join-Path $projectRoot 'firmware\include\prototype22_wifi.h'
    if ((Test-Path -LiteralPath $stagedHeader) -and (Test-Path -LiteralPath $syncedHeader)) {
        $same = (Get-FileHash -LiteralPath $stagedHeader).Hash -eq (Get-FileHash -LiteralPath $syncedHeader).Hash
        if ($same) { Say 'WARN' 'Staged Wi-Fi header is identical to the old one: built for the OLD network. Re-run prepare-bench-day.ps1 if the bench network differs.' }
        else { Say 'OK' 'Staged Wi-Fi header differs from the old one (new network configured)' }
    }
}

# Cloud side (read-only)
$envFile = Join-Path $projectRoot 'web\.env.local'
$envText = if (Test-Path -LiteralPath $envFile) { Get-Content -Raw -LiteralPath $envFile } else { '' }
$baseUrl = [regex]::Match($envText, '(?m)^NEXT_PUBLIC_SUPABASE_URL\s*=\s*["'']?([^"''\r\n]+)').Groups[1].Value.Trim().TrimEnd('/')
$key = [regex]::Match($envText, '(?m)^NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY\s*=\s*["'']?([^"''\r\n]+)').Groups[1].Value.Trim()
if (-not $key) { $key = [regex]::Match($envText, '(?m)^NEXT_PUBLIC_SUPABASE_ANON_KEY\s*=\s*["'']?([^"''\r\n]+)').Groups[1].Value.Trim() }
if (-not $baseUrl -or -not $key) { Say 'FAIL' 'web/.env.local is missing Supabase dashboard settings' }
try {
    $response = Invoke-WebRequest -Uri "$baseUrl/rest/v1/prototype_readings?select=id&limit=1" -UseBasicParsing -TimeoutSec 20 `
        -Headers @{ apikey = $key; Authorization = "Bearer $key"; Prefer = 'count=exact' }
    $total = ($response.Headers['Content-Range'] -split '/')[-1]
    Say 'OK' "Supabase prototype_readings reachable; rows so far: $total"
} catch { Say 'FAIL' "Supabase not reachable from here: $($_.Exception.Message)" }
foreach ($path in @('', '/prototype/22')) {
    try {
        $page = Invoke-WebRequest -Uri "https://ult-freezres.vercel.app$path" -UseBasicParsing -TimeoutSec 20
        Say 'OK' "Dashboard $(if ($path) { $path } else { '/' }) HTTP $($page.StatusCode)"
    } catch { Say 'FAIL' "Dashboard $path unreachable: $($_.Exception.Message)" }
}

# Board
$boards = @(Get-CimInstance Win32_PnPEntity | Where-Object { $_.DeviceID -match 'VID_303A&PID_1001' -and $_.Name -match '\(COM\d+\)' })
if ($boards.Count -eq 1) { Say 'OK' "Espressif board on $([regex]::Match($boards[0].Name, 'COM\d+').Value)" }
elseif ($boards.Count -gt 1) { Say 'WARN' "Several Espressif boards: $(($boards | ForEach-Object { $_.Name }) -join '; '). Unplug all but one." }
else { Say 'WARN' 'No Espressif board plugged in (fine before the wiring is done; use a data cable)' }

Write-Output ''
if ($failed) { Write-Output 'Not ready: fix FAIL items.'; exit 1 }
Write-Output 'Ready on the software side. Flashing still needs your direct "elephant".'
