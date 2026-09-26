#Requires -RunAsAdministrator
#Requires -Version 7
# Background Claude sessions started by the service keep running: they belong to the claude daemon, not to Baton.
param([string]$Name = 'Baton')
$ErrorActionPreference = 'Stop'

$service = Get-Service -Name $Name -ErrorAction SilentlyContinue
if (-not $service) {
    Write-Host "Service $Name is not installed."
    return
}
if ($service.Status -ne 'Stopped') { Stop-Service -Name $Name }
Remove-Service -Name $Name
Remove-Item -Recurse -Force (Join-Path $PSScriptRoot 'bin') -ErrorAction SilentlyContinue
Write-Host "Service $Name removed. Logs are kept in $(Split-Path $PSScriptRoot -Parent)\logs."
