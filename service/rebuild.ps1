#Requires -Version 7
# Builds the checkout this script lives in and restarts the Even Keel service, once a pushed commit of main is green.
# Called by the CI's last step over SSH: the key's authorized_keys entry forces this script, and the commit comes
# in SSH_ORIGINAL_COMMAND. By hand: pwsh service/rebuild.ps1 -Commit <sha>.
param(
    [string]$Commit = $env:SSH_ORIGINAL_COMMAND,
    [string]$Name = 'EvenKeel',
    [string]$State = "http://127.0.0.1:$(if ($env:EVEN_KEEL_PORT) { $env:EVEN_KEEL_PORT } else { 4747 })/api/state",
    [int]$WaitSeconds = 300
)
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$Commit = "$Commit".Trim()
if ($Commit -notmatch '^[0-9a-f]{7,40}$') { throw "Expected a commit hash, got '$Commit'" }

function Invoke-Native {
    $command, $rest = $args
    & $command @rest
    if ($LASTEXITCODE -ne 0) { throw "$($args -join ' ') failed with code $LASTEXITCODE" }
}

# A restart between a task's Done and the next launch pauses that chain, so wait until no unpaused chain is in a launch,
# a handover or a closing. A chain waiting for the CI of main is settled: that CI is the run calling this script, so
# waiting for it would only stall both until WaitSeconds; the wait is in the state file and survives the restart.
# A chain that never settles is not waited for past WaitSeconds.
function Wait-ChainsSettled {
    $deadline = (Get-Date).AddSeconds($WaitSeconds)
    while ((Get-Date) -lt $deadline) {
        try { $chains = (Invoke-RestMethod $State -TimeoutSec 10).chain.active } catch { return }
        $busy = @($chains | Where-Object {
                $ci = $null -eq $_.current -and $_.ciWait -and -not $_.ciWait.local
                -not $_.paused -and -not $ci -and ($null -eq $_.current -or -not $_.current.sessionId -or $_.current.starting -or $_.closing)
            })
        if ($busy.Count -eq 0) { return }
        Write-Host "waiting for $(($busy | ForEach-Object project) -join ', ') to settle"
        Start-Sleep -Seconds 5
    }
    Write-Host "chains did not settle in $WaitSeconds s, restarting anyway"
}

Push-Location $root
try {
    $head = (git rev-parse HEAD).Trim()
    if (-not $head.StartsWith($Commit) -and -not $Commit.StartsWith($head)) {
        Write-Host "The checkout is on $head, not on ${Commit}: nothing is built"
        return
    }
    $installed = Join-Path $root 'node_modules/.package-lock.json'
    $depsChanged = -not (Test-Path $installed) -or (Get-Item 'package-lock.json').LastWriteTime -gt (Get-Item $installed).LastWriteTime
    if ($depsChanged) {
        # The running service holds native binaries of node_modules (esbuild under tsx), so install with it stopped.
        Wait-ChainsSettled
        Stop-Service -Name $Name
        try {
            Invoke-Native npm install --no-audit --no-fund
            Invoke-Native npm run build
        } finally { Start-Service -Name $Name }
    } else {
        Invoke-Native npm run build
        Wait-ChainsSettled
        Restart-Service -Name $Name
    }
    Write-Host "Built $Commit and restarted $Name"
} finally {
    Pop-Location
}
