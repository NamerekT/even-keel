#Requires -RunAsAdministrator
#Requires -Version 7
# Registers the Tally collector as a Task Scheduler task that runs every few minutes as the current user.
# S4U logon: the task runs whether the user is logged on or not, without a window and without a stored password.
param(
    [string]$Name = 'Tally collector',
    [int]$Minutes = 5
)
$ErrorActionPreference = 'Stop'

$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$node = (Get-Command node.exe).Source
$logs = Join-Path $root 'logs'
New-Item -ItemType Directory -Force $logs | Out-Null

$command = "`"$node`" --import tsx tally\src\main.ts >> logs\tally.log 2>&1"
$action = New-ScheduledTaskAction -Execute "$env:WINDIR\System32\cmd.exe" -Argument "/d /c `"$command`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $Minutes)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1)

Register-ScheduledTask -TaskName $Name -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
    -Description 'Loads Claude Code transcripts into the Tally database.' -Force | Out-Null

Write-Host "Task '$Name' runs every $Minutes min as $env:USERDOMAIN\$env:USERNAME. Log: $logs\tally.log"
Write-Host "Run it now: Start-ScheduledTask -TaskName '$Name'"
