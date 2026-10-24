#Requires -Version 7
# Builds the checkout this script lives in and restarts the Even Keel service or its autostart, once a pushed commit of main is green.
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

# The waiting for the chains, the step order and the rollback are the update process's, the same one the page's
# "Update" button starts (src/updates/run.ts, docs/service.md): compile it from this commit, then run it in rebuild mode.
Push-Location $root
try {
    $head = (git rev-parse HEAD).Trim()
    if (-not $head.StartsWith($Commit) -and -not $Commit.StartsWith($head)) {
        Write-Host "The checkout is on $head, not on ${Commit}: nothing is built"
        return
    }
    # The service, or else the autostart at sign-in that `even-keel install` writes to the Run key (its host's exe comes first).
    $control = @('--service', $Name)
    $what = $Name
    if (-not (Get-Service -Name $Name -ErrorAction SilentlyContinue)) {
        $run = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name EvenKeel -ErrorAction SilentlyContinue).EvenKeel
        if ($run -match '^"([^"]+)"') {
            $control = @('--autostart', $Matches[1])
            $what = 'the autostart'
        }
    }
    Invoke-Native npx tsc -p tsconfig.json
    Invoke-Native node dist/src/updates/run.js rebuild --root $root --state $State @control --wait $WaitSeconds
    Write-Host "Built $Commit and restarted $what"
} finally {
    Pop-Location
}
