param([string] $ProtocolUrl = '')

$taskName = 'Liene QA TestHub Progress Sync'
& schtasks.exe /Run /TN $taskName | Out-Null
$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show(
        'TestHub scheduled sync is not configured. Run scripts/Configure TestHub automatic sync first.',
        'Liene QA TestHub Sync',
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Warning
    ) | Out-Null
    exit $exitCode
}
