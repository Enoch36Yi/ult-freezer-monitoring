# Capture existing ESP32-S3 USB serial output. Requires an explicitly observed COM port.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^COM[0-9]+$')][string]$Port,
    [Parameter(Mandatory)][string]$OutputPath,
    [ValidateRange(1, 3600)][int]$DurationSeconds = 130
)

$ErrorActionPreference = 'Stop'
$device = Get-CimInstance Win32_PnPEntity | Where-Object {
    $_.Name -match "\($([regex]::Escape($Port))\)" -and
    $_.DeviceID -match 'VID_303A&PID_1001'
} | Select-Object -First 1
if (-not $device) { throw "$Port is not an observed Espressif USB serial device." }

$target = [System.IO.Path]::GetFullPath($OutputPath)
if (Test-Path -LiteralPath $target) { throw "Output already exists: $target" }
$serial = [System.IO.Ports.SerialPort]::new($Port, 115200)
$serial.DtrEnable = $true
$serial.RtsEnable = $false
$serial.ReadTimeout = 500
$writer = $null
try {
    $serial.Open()
    $stream = [System.IO.File]::Open($target, [System.IO.FileMode]::CreateNew)
    $writer = [System.IO.StreamWriter]::new($stream, [System.Text.UTF8Encoding]::new($false))
    $writer.WriteLine("# capture-start-utc $([DateTime]::UtcNow.ToString('o')) port $Port")
    $until = [DateTime]::UtcNow.AddSeconds($DurationSeconds)
    while ([DateTime]::UtcNow -lt $until) {
        $chunk = $serial.ReadExisting()
        if ($chunk) { $writer.Write($chunk); $writer.Flush() }
        Start-Sleep -Milliseconds 100
    }
    $writer.WriteLine("`n# capture-end-utc $([DateTime]::UtcNow.ToString('o'))")
} finally {
    if ($serial.IsOpen) { $serial.Close() }
    $serial.Dispose()
    if ($writer) { $writer.Dispose() }
}
Write-Output "Saved read-only serial capture to $target"
