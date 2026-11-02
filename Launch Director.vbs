Option Explicit
Dim shell, fs, folder, python, command
Set shell = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
folder = fs.GetParentFolderName(WScript.ScriptFullName)
python = folder & "\.venv\Scripts\pythonw.exe"
If Not fs.FileExists(python) Then
  MsgBox "Run Setup.cmd in the application folder first.", 64, "AI Music Video Timeline"
  WScript.Quit
End If
shell.CurrentDirectory = folder
command = Chr(34) & python & Chr(34) & " " & Chr(34) & folder & "\server.py" & Chr(34) & " --open"
shell.Run command, 0, False
