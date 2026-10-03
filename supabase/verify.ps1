# Read-only contract checks against the same public read API used by the dashboard.
# No test readings are inserted and no database configuration is changed.
[CmdletBinding()]
param([string]$ReportPath)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $projectRoot 'web/.env.local'
if (-not (Test-Path -LiteralPath $envFile)) { throw 'web/.env.local is missing.' }
$envText = Get-Content -Raw -LiteralPath $envFile
function Get-EnvSetting([string]$Name) {
    $value = [regex]::Match($envText, ('(?m)^' + [regex]::Escape($Name) + '\s*=\s*["'']?([^"''\r\n]+)')).Groups[1].Value.Trim()
    if (-not $value) { throw "Missing dashboard setting: $Name" }
    return $value
}
function Get-FirstEnvSetting([string[]]$Names) {
    foreach ($name in $Names) {
        $value = [regex]::Match($envText, ('(?m)^' + [regex]::Escape($name) + '\s*=\s*["'']?([^"''\r\n]+)')).Groups[1].Value.Trim()
        if ($value) { return $value }
    }
    throw ('Missing dashboard setting: ' + ($Names -join ' or '))
}
$baseUrl = (Get-EnvSetting 'NEXT_PUBLIC_SUPABASE_URL').TrimEnd('/')
$key = Get-FirstEnvSetting @('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY')
$headers = @{ apikey = $key; Authorization = "Bearer $key" }
$checks = [System.Collections.Generic.List[object]]::new()
function Add-Check([string]$Name, [bool]$Passed, [string]$Detail) {
    $checks.Add([pscustomobject]@{ name = $Name; passed = $Passed; detail = $Detail })
}
function Read-Api([string]$Path) {
    # -UseBasicParsing: without it Windows PowerShell 5.1 throws a null
    # reference on machines lacking the IE engine (seen on this laptop 2026-09-29).
    Invoke-WebRequest -Uri ($baseUrl + $Path) -Headers $headers -TimeoutSec 20 -UseBasicParsing
}
# Windows PowerShell 5.1 emits a JSON array as ONE object, so @() around an
# empty "[]" yields one bogus element. Re-enumerate to get real items.
function ConvertFrom-JsonArray([string]$Json) {
    return @(($Json | ConvertFrom-Json) | ForEach-Object { $_ })
}
function Get-ApiFailure($Failure) {
    if ($Failure.ErrorDetails.Message) { return [string]$Failure.ErrorDetails.Message }
    return [string]$Failure.Exception.Message
}

$webUrl = $baseUrl
Add-Check 'dashboard_project' $true 'Dashboard and verification use the same local Supabase project settings.'

$now = [DateTimeOffset]::UtcNow
$fleet = [System.Collections.Generic.List[object]]::new()
try {
    $headers['Prefer'] = 'count=exact'
    $response = Read-Api '/rest/v1/readings?select=id,freezer_id,sensor_tier,temp_c,rssi,reset_reason,firmware_version,payload_version,recorded_at,received_at&limit=1'
    Add-Check 'readings_contract' $true ('Public read succeeded; Content-Range: ' + ($response.Headers['Content-Range'] -join ', '))
} catch { Add-Check 'readings_contract' $false (Get-ApiFailure $_) }
$headers.Remove('Prefer')

try {
    $response = Read-Api '/rest/v1/rpc/readings_latest?p_sensor_tier=esp32_pt1000_max31865'
    $latestRows = @(ConvertFrom-JsonArray $response.Content)
    $seen = @{}
    foreach ($row in $latestRows) {
        if ($seen.ContainsKey([string]$row.freezer_id)) { throw "Duplicate latest row for freezer $($row.freezer_id)" }
        $seen[[string]$row.freezer_id] = $true
        foreach ($field in @('freezer_id', 'temp_c', 'recorded_at', 'received_at')) {
            if ($field -notin $row.PSObject.Properties.Name) { throw "Missing latest RPC field: $field" }
        }
    }
    Add-Check 'latest_readings_rpc' $true ("Batched latest RPC returned $($latestRows.Count) freezer rows.")
} catch { Add-Check 'latest_readings_rpc' $false (Get-ApiFailure $_) }

for ($id = 1; $id -le 21; $id++) {
    $interval = if ($id -le 6) { 60 } else { 900 }
    try {
        $response = Read-Api ('/rest/v1/readings?select=id,temp_c,firmware_version,payload_version,recorded_at,received_at&freezer_id=eq.' + $id + '&sensor_tier=eq.esp32_pt1000_max31865&order=received_at.desc&limit=1')
        $rows = @(ConvertFrom-JsonArray $response.Content)
        $latest = if ($rows.Count -gt 0) { $rows[0] } else { $null }
        $state = 'no_data'
        if ($null -ne $latest) {
            # received_at is the server clock and answers "did this node
            # reach the ingestion service recently?" recorded_at remains the
            # measurement timestamp and can legitimately lag after queue replay.
            $age = ($now - [DateTimeOffset]::Parse($latest.received_at)).TotalSeconds
            $state = if ($age -lt -60) { 'future_timestamp' } elseif ($age -le 3 * $interval) { 'recent' } elseif ($age -le 12 * $interval) { 'stale' } else { 'offline' }
        }
        $fleet.Add([pscustomobject]@{ freezer_id = $id; interval_seconds = $interval; state = $state; latest = $latest })
    } catch {
        Add-Check "freezer_${id}_read" $false (Get-ApiFailure $_)
        $fleet.Add([pscustomobject]@{ freezer_id = $id; interval_seconds = $interval; state = 'query_failed'; latest = $null })
    }
}

$prototypeLatest = $null
try {
    $response = Read-Api '/rest/v1/prototype_readings?select=id,prototype_id,sensor_tier,temp_c,firmware_version,payload_version,recorded_at,received_at&prototype_id=eq.22&sensor_tier=eq.esp32_pt1000_max31865&order=received_at.desc&limit=1'
    $rows = @(ConvertFrom-JsonArray $response.Content)
    $prototypeLatest = if ($rows.Count -gt 0) { $rows[0] } else { $null }
    $state = 'no_data'
    if ($null -ne $prototypeLatest) {
        $age = ($now - [DateTimeOffset]::Parse($prototypeLatest.received_at)).TotalSeconds
        $state = if ($age -lt -60) { 'future_timestamp' } elseif ($age -le 180) { 'recent' } elseif ($age -le 720) { 'stale' } else { 'offline' }
    }
    Add-Check 'prototype_22_read' $true ("Prototype 22 public read succeeded; state=$state.")
} catch {
    Add-Check 'prototype_22_read' $false (Get-ApiFailure $_)
}

# GET invokes a STABLE, read-only RPC. Explicitly test every dashboard tier.
$start = [uri]::EscapeDataString($now.AddDays(-30).ToString('o'))
$end = [uri]::EscapeDataString($now.ToString('o'))
foreach ($tier in @('esp32_pt1000_max31865', 'esp32_ds18b20', 'imonnit', 'traxx')) {
    try {
        $response = Read-Api ("/rest/v1/rpc/readings_bucketed?p_freezer_id=1&p_start=$start&p_end=$end&p_bucket_seconds=900&p_sensor_tier=$tier")
        $buckets = @(ConvertFrom-JsonArray $response.Content)
        $required = @('bucket_time', 'avg_temp_c', 'min_temp_c', 'max_temp_c', 'reading_count')
        foreach ($bucket in $buckets) {
            foreach ($field in $required) {
                if ($field -notin $bucket.PSObject.Properties.Name) { throw "Missing RPC output field: $field" }
            }
        }
        Add-Check "history_$tier" $true ("Tier-specific history returned $($buckets.Count) buckets; empty data is permitted.")
    } catch { Add-Check "history_$tier" $false (Get-ApiFailure $_) }
}

try {
    $response = Read-Api ("/rest/v1/rpc/prototype_readings_bucketed?p_prototype_id=22&p_start=$start&p_end=$end&p_bucket_seconds=900&p_sensor_tier=esp32_pt1000_max31865")
    $buckets = @(ConvertFrom-JsonArray $response.Content)
    $required = @('bucket_time', 'avg_temp_c', 'min_temp_c', 'max_temp_c', 'reading_count')
    foreach ($bucket in $buckets) {
        foreach ($field in $required) {
            if ($field -notin $bucket.PSObject.Properties.Name) { throw "Missing Prototype 22 RPC output field: $field" }
        }
    }
    Add-Check 'history_prototype_22' $true ("Prototype 22 history returned $($buckets.Count) buckets; empty data is permitted.")
} catch { Add-Check 'history_prototype_22' $false (Get-ApiFailure $_) }

$report = [pscustomobject]@{
    checked_at_utc = $now.ToString('o')
    project_host = ([uri]$baseUrl).Host
    mode = 'read_only'
    checks = @($checks.ToArray())
    fleet = @($fleet.ToArray())
    prototype_22 = $prototypeLatest
    limitations = @(
        'Public reads cannot prove RLS policy definitions, write permissions, indexes, migration history, or backups.'
        'No synthetic research rows are inserted. Physical sensor detection and device-to-database delivery require a real measurement.'
        'Recent timestamps alone do not establish provenance, calibration, or genuine study data.'
    )
}
if ($ReportPath) {
    if (Test-Path -LiteralPath $ReportPath) { throw 'Report path already exists; use a new filename to preserve audit history.' }
    $report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $ReportPath -Encoding utf8
}
$checks | Format-Table name, passed, detail -Wrap
$fleet | Select-Object freezer_id, interval_seconds, state | Format-Table
if (@($checks | Where-Object { -not $_.passed }).Count -gt 0) { exit 1 }
