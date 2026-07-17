param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $PythonArgs
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Read-MaskedSecret {
    param(
        [string] $Title,
        [string] $Prompt
    )

    $form = New-Object System.Windows.Forms.Form
    $form.Text = $Title
    $form.Size = New-Object System.Drawing.Size(620, 180)
    $form.StartPosition = 'CenterScreen'
    $form.TopMost = $true
    $form.FormBorderStyle = 'FixedDialog'
    $form.MaximizeBox = $false
    $form.MinimizeBox = $false

    $label = New-Object System.Windows.Forms.Label
    $label.Text = $Prompt
    $label.AutoSize = $true
    $label.Location = New-Object System.Drawing.Point(20, 20)
    $null = $form.Controls.Add($label)

    $inputBox = New-Object System.Windows.Forms.TextBox
    $inputBox.Location = New-Object System.Drawing.Point(20, 50)
    $inputBox.Size = New-Object System.Drawing.Size(565, 28)
    $inputBox.UseSystemPasswordChar = $true
    $null = $form.Controls.Add($inputBox)

    $okButton = New-Object System.Windows.Forms.Button
    $okButton.Text = 'OK'
    $okButton.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $okButton.Location = New-Object System.Drawing.Point(420, 92)
    $null = $form.Controls.Add($okButton)
    $form.AcceptButton = $okButton

    $cancelButton = New-Object System.Windows.Forms.Button
    $cancelButton.Text = 'Cancel'
    $cancelButton.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
    $cancelButton.Location = New-Object System.Drawing.Point(510, 92)
    $null = $form.Controls.Add($cancelButton)
    $form.CancelButton = $cancelButton

    $form.Add_Shown({ $inputBox.Focus() })
    $result = $form.ShowDialog()
    $value = $inputBox.Text.Trim()
    $inputBox.Clear()
    $form.Dispose()

    if ($result -ne [System.Windows.Forms.DialogResult]::OK -or [string]::IsNullOrWhiteSpace($value)) {
        return $null
    }
    return $value
}

$pingCodeToken = Read-MaskedSecret `
    -Title 'Step 1/2 - Hanntonb API Key' `
    -Prompt 'Paste the company Hanntonb API Key (memory only), then click OK:'
if ([string]::IsNullOrWhiteSpace($pingCodeToken)) {
    exit 1
}

$supabaseToken = Read-MaskedSecret `
    -Title 'Step 2/2 - Liene QA Sync Authorization' `
    -Prompt 'Click Copy Local Sync Authorization in Liene QA, paste it here, then click OK:'
if ([string]::IsNullOrWhiteSpace($supabaseToken)) {
    exit 1
}

if (($supabaseToken -split '\.').Count -ne 3) {
    [System.Windows.Forms.MessageBox]::Show(
        'The Liene QA sync authorization is incomplete. Copy it again from the platform.',
        'Invalid sync authorization',
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
    exit 1
}

try {
    $env:PINGCODE_TOKEN = $pingCodeToken
    $env:SUPABASE_ACCESS_TOKEN = $supabaseToken
    $pingCodeToken = $null
    $supabaseToken = $null
    & python (Join-Path $PSScriptRoot 'sync_testhub_local.py') @PythonArgs
    exit $LASTEXITCODE
}
finally {
    Remove-Item Env:PINGCODE_TOKEN -ErrorAction SilentlyContinue
    Remove-Item Env:SUPABASE_ACCESS_TOKEN -ErrorAction SilentlyContinue
    $pingCodeToken = $null
    $supabaseToken = $null
}
