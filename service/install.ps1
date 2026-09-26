#Requires -RunAsAdministrator
#Requires -Version 7
# Builds the service host and registers the Baton service under a user account.
# The account password is never asked here: set it on the service's Log On tab in services.msc,
# which also grants the account the "Log on as a service" right.
param(
    [string]$Account = "$env:USERDOMAIN\$env:USERNAME",
    [string]$Name = 'Baton'
)
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$node = (Get-Command node.exe).Source
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$bin = Join-Path $PSScriptRoot 'bin'
$exe = Join-Path $bin 'BatonService.exe'

function Invoke-Sc {
    & sc.exe @args | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "sc.exe $($args -join ' ') failed with code $LASTEXITCODE" }
}

$existing = Get-Service -Name $Name -ErrorAction SilentlyContinue
if ($existing -and $existing.Status -ne 'Stopped') {
    Stop-Service -Name $Name
}

New-Item -ItemType Directory -Force $bin | Out-Null
& $csc -nologo -target:exe "-out:$exe" -reference:System.ServiceProcess.dll (Join-Path $PSScriptRoot 'BatonService.cs')
if ($LASTEXITCODE -ne 0) { throw "csc failed with code $LASTEXITCODE" }

$command = "`"$exe`" `"$root`" `"$node`""
if ($existing) {
    Set-Service -Name $Name -BinaryPathName $command
    Start-Service -Name $Name
    Write-Host "Service $Name updated and started. Log: $root\logs\baton.log"
    return
}

New-Service -Name $Name -BinaryPathName $command -DisplayName 'Baton' -StartupType Manual `
    -Description 'Runs Claude Code sessions for Huly issues one after another.' | Out-Null
try {
    Invoke-Sc config $Name obj= $Account
    Invoke-Sc config $Name start= delayed-auto
    Invoke-Sc failure $Name reset= 86400 actions= restart/10000/restart/10000/restart/60000
} catch {
    & sc.exe delete $Name | Out-Null
    throw
}

Write-Host "Service $Name is registered to run as $Account."
Write-Host "Finish in services.msc: $Name -> Properties -> Log On -> enter the password of $Account -> OK, then Start."
Write-Host "Log: $root\logs\baton.log"
Start-Process services.msc
