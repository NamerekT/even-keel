#Requires -RunAsAdministrator
#Requires -Version 7
# Builds the service host and registers the Even Keel service under a user account.
# The account password is never asked here: set it on the service's Log On tab in services.msc,
# which also grants the account the "Log on as a service" right.
param(
    [string]$Account = "$env:USERDOMAIN\$env:USERNAME",
    [string]$Name = 'EvenKeel'
)
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$node = (Get-Command node.exe).Source
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$bin = Join-Path $PSScriptRoot 'bin'
$exe = Join-Path $bin 'EvenKeelService.exe'

function Invoke-Sc {
    & sc.exe @args | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "sc.exe $($args -join ' ') failed with code $LASTEXITCODE" }
}

# Lets the account start, stop and query the service without elevation, so its own sessions can restart it.
function Grant-Control {
    $sid = ([Security.Principal.NTAccount]$Account).Translate([Security.Principal.SecurityIdentifier]).Value
    $sddl = (& sc.exe sdshow $Name | Where-Object { $_ }) -join ''
    if ($sddl -match [regex]::Escape(";;;$sid)")) { return }
    $ace = "(A;;CCLCSWRPWPDTLOCRRC;;;$sid)"
    $sddl = if ($sddl -match 'S:') { $sddl -replace 'S:', "${ace}S:" } else { $sddl + $ace }
    Invoke-Sc sdset $Name $sddl
}

# A running service holds native binaries of node_modules (esbuild under tsx): npm fails on them with EPERM.
$existing = Get-Service -Name $Name -ErrorAction SilentlyContinue
if ($existing -and $existing.Status -ne 'Stopped') {
    Stop-Service -Name $Name
}

Push-Location $root
try {
    npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm install failed with code $LASTEXITCODE" }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed with code $LASTEXITCODE" }
} finally {
    Pop-Location
}

New-Item -ItemType Directory -Force $bin | Out-Null
& $csc -nologo -target:exe "-out:$exe" -reference:System.ServiceProcess.dll (Join-Path $PSScriptRoot 'EvenKeelService.cs')
if ($LASTEXITCODE -ne 0) { throw "csc failed with code $LASTEXITCODE" }

$command = "`"$exe`" `"$root`" `"$node`""
if ($existing) {
    Invoke-Sc config $Name binPath= $command
    Grant-Control
    Start-Service -Name $Name
    Write-Host "Service $Name updated and started. Log: $root\logs\even-keel.log"
    return
}

New-Service -Name $Name -BinaryPathName $command -DisplayName 'Even Keel' -StartupType Manual `
    -Description 'Runs Claude Code sessions for Huly issues one after another.' | Out-Null
try {
    Invoke-Sc config $Name obj= $Account
    Invoke-Sc config $Name start= delayed-auto
    Invoke-Sc failure $Name reset= 86400 actions= restart/10000/restart/10000/restart/60000
    Grant-Control
} catch {
    & sc.exe delete $Name | Out-Null
    throw
}

Write-Host "Service $Name is registered to run as $Account."
Write-Host "Finish in services.msc: $Name -> Properties -> Log On -> enter the password of $Account -> OK, then Start."
Write-Host "Log: $root\logs\even-keel.log"
Start-Process services.msc
