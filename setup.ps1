$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Test-Path -LiteralPath '.venv\Scripts\python.exe')) {
    if (Get-Command py -ErrorAction SilentlyContinue) {
        & py -3.12 -m venv .venv
    } elseif (Get-Command python -ErrorAction SilentlyContinue) {
        & python -m venv .venv
    } else {
        throw 'Install Python 3.12 from python.org (include Python in PATH), then run Setup.cmd again.'
    }
    if ($LASTEXITCODE -ne 0) { throw 'Python 3.12 is required. Install it and run Setup.cmd again.' }
}
& '.\.venv\Scripts\python.exe' -m pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Check the connection, then run Setup.cmd again.' }
& '.\.venv\Scripts\python.exe' make_icon.py
& (Join-Path $PSScriptRoot 'install-shortcut.ps1')
Write-Host 'Ready. Open AI Music Video Timeline from your desktop.'
