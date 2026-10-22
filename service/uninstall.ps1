#Requires -RunAsAdministrator
#Requires -Version 7
# Background Claude sessions started by the service keep running: they belong to the claude daemon, not to Even Keel.
param([string]$Name = 'EvenKeel')
$ErrorActionPreference = 'Stop'

$service = Get-Service -Name $Name -ErrorAction SilentlyContinue
if (-not $service) {
    Write-Host "Service $Name is not installed."
    return
}
# "<host exe>" "<root>" "<node>" ["<data folder>"], as install.ps1 registers it: the host of an npm install is in its data folder.
$registered = [regex]::Matches((Get-CimInstance Win32_Service -Filter "Name='$Name'").PathName, '"([^"]*)"') | ForEach-Object { $_.Groups[1].Value }
$hostDir = if ($registered.Count -ge 1) { Split-Path $registered[0] -Parent } else { Join-Path $PSScriptRoot 'bin' }
$logs = if ($registered.Count -ge 4) { Join-Path $registered[3] 'logs' } else { Join-Path (Split-Path $PSScriptRoot -Parent) 'logs' }
if ($service.Status -ne 'Stopped') { Stop-Service -Name $Name }
Remove-Service -Name $Name
Remove-Item -Recurse -Force $hostDir -ErrorAction SilentlyContinue
Write-Host "Service $Name removed. Logs are kept in $logs."
