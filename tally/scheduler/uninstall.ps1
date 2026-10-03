#Requires -RunAsAdministrator
#Requires -Version 7
# Removes the Tally collector task. The database and its data stay.
param(
    [string]$Name = 'Tally collector'
)
$ErrorActionPreference = 'Stop'

if (Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $Name
    Unregister-ScheduledTask -TaskName $Name -Confirm:$false
    Write-Host "Task '$Name' removed."
} else {
    Write-Host "Task '$Name' is not registered."
}
