# Read-only Prototype 22 end-to-end check for machines without Node.js.
# Same logic as prototype-check.mjs: given a serial capture, it requires a
# "[reading] posted" payload and a stored row with the same recorded_at and
# temperature. Buffered or failed posts never count. Only GET requests.
[CmdletBinding()]
param(
    [string]$SerialLog,
    [string]$ReportPath
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$expectedHost = 'dfxxamgnrimwoumknuxa.supabase.co'
$siteUrl = 'https://ult-freezres.vercel.app'

function Read-Serial([string]$Text) {
    $result = [ordered]@{ sensorFound = $false; sensorMissing = $false; diagnosticRuns = 0; posted = @() }
    $pending = $null
    foreach ($line in ($Text -split "\r?\n")) {
        if ($line.Contains('[sensor] DS18B20 found')) { $result.sensorFound = $true }
        if ($line.Contains('[sensor] no DS18B20')) { $result.sensorMissing = $true }
        if ($line.Contains('[1wire-diag] VERDICT:')) { $result.diagnosticRuns++ }
        $match = [regex]::Match($line, '\[reading\] (\{.*\})')
        if ($match.Success) {
            try { $pending = $match.Groups[1].Value | ConvertFrom-Json } catch { $pending = $null }
        } elseif ($line.Contains('[reading] posted')) {
            if ($pending) { $result.posted += , $pending }
            $pending = $null
        } elseif ($line.Contains('[queue] buffered') -or $line.Contains('[http] POST failed')) {
            $pending = $null
        }
    }
    return $result
}

$envFile = Join-Path $projectRoot 'web/.env.local'
if (-not (Test-Path -LiteralPath $envFile)) { throw 'web/.env.local is missing.' }
$envText = Get-Content -Raw -LiteralPath $envFile
$baseUrl = [regex]::Match($envText, '(?m)^NEXT_PUBLIC_SUPABASE_URL\s*=\s*["'']?([^"''\r\n]+)').Groups[1].Value.Trim().TrimEnd('/')
$key = [regex]::Match($envText, '(?m)^NEXT_PUBLIC_SUPABASE_ANON_KEY\s*=\s*["'']?([^"''\r\n]+)').Groups[1].Value.Trim()
if (-not $baseUrl -or -not $key -or ([uri]$baseUrl).Host -ne $expectedHost) { throw 'Dashboard config is missing or points to the wrong Supabase project.' }
$headers = @{ apikey = $key; Authorization = "Bearer $key" }

$serial = $null
if ($SerialLog) { $serial = Read-Serial (Get-Content -Raw -LiteralPath $SerialLog) }
$latest = if ($serial -and $serial.posted.Count) { $serial.posted[-1] } else { $null }

$query = "$baseUrl/rest/v1/prototype_readings?select=id,prototype_id,sensor_tier,temp_c,recorded_at,received_at&prototype_id=eq.22&sensor_tier=eq.esp32_ds18b20"
if ($latest -and $latest.recorded_at) {
    $query += '&recorded_at=eq.' + [uri]::EscapeDataString([string]$latest.recorded_at)
} else {
    $query += '&order=recorded_at.desc&limit=1'
}
$response = Invoke-WebRequest -Uri $query -Headers $headers -TimeoutSec 20 -UseBasicParsing
$rows = @(($response.Content | ConvertFrom-Json) | ForEach-Object { $_ })

function Test-Page([string]$Url) {
    try {
        $page = Invoke-WebRequest -Uri $Url -TimeoutSec 20 -UseBasicParsing
        if ($page.Content.Contains('Prototype 22')) { return 'reachable' }
        return 'missing label'
    } catch { return "unreachable: $($_.Exception.Message)" }
}

if ($serial) {
    if (-not $latest) {
        $observation = [ordered]@{ state = 'no_posted_serial_reading' }
    } elseif ($latest.prototype_id -ne 22 -or $latest.sensor_tier -ne 'esp32_ds18b20' -or -not $latest.recorded_at) {
        $observation = [ordered]@{ state = 'posted_serial_reading_lacks_match_fields' }
    } else {
        $when = [DateTimeOffset]::Parse([string]$latest.recorded_at)
        $row = $rows | Where-Object {
            $_.prototype_id -eq 22 -and $_.sensor_tier -eq 'esp32_ds18b20' -and
            [DateTimeOffset]::Parse([string]$_.recorded_at) -eq $when -and
            [math]::Abs([double]$_.temp_c - [double]$latest.temp_c) -lt 0.0001
        } | Select-Object -First 1
        $observation = if ($row) {
            [ordered]@{ state = 'matched'; rowId = $row.id; recordedAt = $row.recorded_at; tempC = [double]$row.temp_c; receivedAt = $row.received_at }
        } else {
            [ordered]@{ state = 'posted_not_found_in_rows'; recordedAt = $latest.recorded_at }
        }
    }
} else {
    $observation = [ordered]@{ state = $(if ($rows.Count) { 'row_present_without_serial_provenance' } else { 'no_readings_yet' }) }
}

$report = [ordered]@{
    checkedAtUtc = [DateTime]::UtcNow.ToString('o')
    projectHost  = $expectedHost
    mode         = 'read_only'
    site         = [ordered]@{
        home   = Test-Page $siteUrl
        detail = Test-Page "$siteUrl/prototype/22"
        note   = 'HTTP checks verify routes only; compare the client-rendered temperature in a browser.'
    }
    serial       = $(if ($serial) { [ordered]@{ sensorFound = $serial.sensorFound; sensorMissing = $serial.sensorMissing; diagnosticRuns = $serial.diagnosticRuns; postedReadings = $serial.posted.Count } } else { $null })
    observation  = $observation
}
$json = $report | ConvertTo-Json -Depth 6
if ($ReportPath) {
    if (Test-Path -LiteralPath $ReportPath) { throw 'Report path already exists; use a new filename.' }
    [System.IO.File]::WriteAllText([System.IO.Path]::GetFullPath($ReportPath), $json + "`n", [System.Text.UTF8Encoding]::new($false))
}
Write-Output $json
if ($report.site.home -ne 'reachable' -or $report.site.detail -ne 'reachable') { exit 1 }
