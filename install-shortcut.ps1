$ErrorActionPreference = 'Stop'
$shortcutDesktop = [Environment]::GetFolderPath('Desktop')
$shortcutShell = New-Object -ComObject WScript.Shell
$shortcutPath = Join-Path $shortcutDesktop 'AI Music Video Timeline.lnk'
$shortcut = $shortcutShell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$shortcut.Arguments = '"' + (Join-Path $PSScriptRoot 'Launch Director.vbs') + '"'
$shortcut.WorkingDirectory = $PSScriptRoot
$shortcut.IconLocation = (Join-Path $PSScriptRoot 'web\director.ico') + ',0'
$shortcut.Description = 'Plan songs, timed lyrics, scenes and complete music-video packages.'
$shortcut.Save()
Write-Output $shortcutPath
