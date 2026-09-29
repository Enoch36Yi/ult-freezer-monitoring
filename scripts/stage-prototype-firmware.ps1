# Copies only firmware source to a new private local directory outside OneDrive.
# It does not build, upload, erase, or delete anything.
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$firmwareRoot = Join-Path $projectRoot 'firmware'
# Not %LOCALAPPDATA%: a Microsoft Store Python virtualizes that path, so
# PlatformIO launched from it cannot see folders created there (observed
# 2026-09-29: "Path ... does not exist"). The profile root is outside OneDrive.
$localRoot = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'FreezersFirmwareBuilds'))
if ($localRoot -match '(?i)[\\/]OneDrive[^\\/]*([\\/]|$)') {
    throw 'The local build directory resolves inside OneDrive.'
}

$name = 'prototype-22-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$target = Join-Path $localRoot $name
if (Test-Path -LiteralPath $target) { throw "Stage directory already exists: $target" }
New-Item -ItemType Directory -Path $target -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $firmwareRoot 'platformio.ini') -Destination $target
foreach ($folder in @('src', 'include', 'test')) {
    Copy-Item -LiteralPath (Join-Path $firmwareRoot $folder) -Destination $target -Recurse
}

Write-Output "Firmware source staged outside OneDrive: $target"
Write-Output 'This private folder contains the prototype Wi-Fi credential. Do not share it or its compiled images.'
Write-Output 'No build or flash was performed.'
