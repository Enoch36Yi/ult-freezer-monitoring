# Read-only contract checks against the same public API used by the devices.
# No test readings are inserted and no database configuration is changed.
[CmdletBinding()]
param([string]$ReportPath)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$config = Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'firmware/include/config.h')
function Get-FirmwareSetting([string]$Name) {
    $value = [regex]::Match($config, ('#define\s+' + [regex]::Escape($Name) + '\s+"([^"]+)"')).Groups[1].Value
    if (-not $value) { throw "Missing firmware setting: $Name" }
    return $value
}
$baseUrl = (Get-FirmwareSetting 'SUPABASE_URL').TrimEnd('/')
$key = Get-FirmwareSetting 'SUPABASE_ANON_KEY'
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

$envFile = Join-Path $projectRoot 'web/.env.local'
if (Test-Path -LiteralPath $envFile) {
    $envText = Get-Content -Raw -LiteralPath $envFile
    $webUrl = [regex]::Match($envText, '(?m)^NEXT_PUBLIC_SUPABASE_URL\s*=\s*["'']?([^"''\r\n]+)').Groups[1].Value.Trim().TrimEnd('/')
    Add-Check 'dashboard_project' ($webUrl -eq $baseUrl) 'Dashboard and firmware must target the same project.'
} else {
    Add-Check 'dashboard_project' $false 'web/.env.local is missing.'
}

$now = [DateTimeOffset]::UtcNow
$fleet = [System.Collections.Generic.List[object]]::new()
try {
    $headers['Prefer'] = 'count=exact'
    $response = Read-Api '/rest/v1/readings?select=id,freezer_id,sensor_tier,temp_c,rssi,reset_reason,recorded_at,received_at&limit=1'
    Add-Check 'readings_contract' $true ('Public read succeeded; Content-Range: ' + ($response.Headers['Content-Range'] -join ', '))
} catch { Add-Check 'readings_contract' $false (Get-ApiFailure $_) }
$headers.Remove('Prefer')

for ($id = 1; $id -le 21; $id++) {
    $interval = if ($id -le 6) { 60 } else { 900 }
    try {
        $response = Read-Api ('/rest/v1/readings?select=id,temp_c,recorded_at,received_at&freezer_id=eq.' + $id + '&sensor_tier=eq.esp32_ds18b20&order=recorded_at.desc&limit=1')
        $rows = @(ConvertFrom-JsonArray $response.Content)
        $latest = if ($rows.Count -gt 0) { $rows[0] } else { $null }
        $state = 'no_data'
        if ($null -ne $latest) {
            $age = ($now - [DateTimeOffset]::Parse($latest.recorded_at)).TotalSeconds
            $state = if ($age -lt -60) { 'future_timestamp' } elseif ($age -le 3 * $interval) { 'recent' } elseif ($age -le 12 * $interval) { 'stale' } else { 'offline' }
        }
        $fleet.Add([pscustomobject]@{ freezer_id = $id; interval_seconds = $interval; state = $state; latest = $latest })
    } catch {
        Add-Check "freezer_${id}_read" $false (Get-ApiFailure $_)
        $fleet.Add([pscustomobject]@{ freezer_id = $id; interval_seconds = $interval; state = 'query_failed'; latest = $null })
    }
}

# GET invokes a STABLE, read-only RPC. Explicitly test every dashboard tier.
$start = [uri]::EscapeDataString($now.AddDays(-30).ToString('o'))
$end = [uri]::EscapeDataString($now.ToString('o'))
foreach ($tier in @('esp32_ds18b20', 'imonnit', 'traxx')) {
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

$report = [pscustomobject]@{
    checked_at_utc = $now.ToString('o')
    project_host = ([uri]$baseUrl).Host
    mode = 'read_only'
    checks = @($checks.ToArray())
    fleet = @($fleet.ToArray())
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
