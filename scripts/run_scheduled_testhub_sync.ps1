$ErrorActionPreference = 'Continue'
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDirectory = Split-Path -Parent $scriptDirectory
$logDirectory = Join-Path $projectDirectory 'logs'
$logPath = Join-Path $logDirectory 'testhub-sync.log'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

Add-Content -LiteralPath $logPath -Value ("`r`n[{0}] Scheduled progress sync started" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')) -Encoding UTF8
& python (Join-Path $scriptDirectory 'sync_testhub_local.py') --stored-credentials --progress-only *>> $logPath
$exitCode = $LASTEXITCODE
Add-Content -LiteralPath $logPath -Value ("[{0}] Scheduled progress sync finished with exit code {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $exitCode) -Encoding UTF8

if ((Get-Item -LiteralPath $logPath).Length -gt 2097152) {
    $tail = Get-Content -LiteralPath $logPath -Tail 2000
    Set-Content -LiteralPath $logPath -Value $tail -Encoding UTF8
}
exit $exitCode
