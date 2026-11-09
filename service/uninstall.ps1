#Requires -RunAsAdministrator
#Requires -Version 7
# Background Claude sessions started by the service keep running: they belong to the claude daemon, not to Even Keel.
param([string]$Name = 'EvenKeel')
$ErrorActionPreference = 'Stop'

$service = Get-Service -Name $Name -ErrorAction SilentlyContinue
if (-not $service) {
    Write-Host "Service $Name is not installed."
    $cleanup = Join-Path (Split-Path $PSScriptRoot -Parent) 'dist/src/account/settingsUninstall.js'
    if (Test-Path -LiteralPath $cleanup) {
        & node $cleanup
        if ($LASTEXITCODE -ne 0) { throw 'Could not remove the account settings hooks.' }
    }
    return
}
# "<host exe>" "<root>" "<node>" ["<data folder>"], as install.ps1 registers it: the host of an npm install is in its data folder.
$registered = [regex]::Matches((Get-CimInstance Win32_Service -Filter "Name='$Name'").PathName, '"([^"]*)"') | ForEach-Object { $_.Groups[1].Value }
$hostDir = if ($registered.Count -ge 1) { Split-Path $registered[0] -Parent } else { Join-Path $PSScriptRoot 'bin' }
$logs = if ($registered.Count -ge 4) { Join-Path $registered[3] 'logs' } else { Join-Path (Split-Path $PSScriptRoot -Parent) 'logs' }
if ($service.Status -ne 'Stopped') { Stop-Service -Name $Name }
Remove-Service -Name $Name
$root = if ($registered.Count -ge 2) { $registered[1] } else { Split-Path $PSScriptRoot -Parent }
$nodeBin = if ($registered.Count -ge 3) { $registered[2] } else { 'node' }
$cleanup = Join-Path $root 'dist/src/account/settingsUninstall.js'
if (Test-Path -LiteralPath $cleanup) {
    $previousData = $env:EVEN_KEEL_DATA
    try {
        if ($registered.Count -ge 4) { $env:EVEN_KEEL_DATA = $registered[3] }
        & $nodeBin $cleanup
        if ($LASTEXITCODE -ne 0) { throw 'Could not remove the account settings hooks.' }
    } finally { $env:EVEN_KEEL_DATA = $previousData }
}
Remove-Item -Recurse -Force $hostDir -ErrorAction SilentlyContinue
Write-Host "Service $Name removed. Logs are kept in $logs."
