Option Explicit
Dim sh, fso, root, exe
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
exe = fso.BuildPath(root, "node_modules\electron\dist\electron.exe")
If Not fso.FileExists(exe) Then
  MsgBox "Please run npm ci in this folder first.", 48, "MOSS Usage Widget"
  WScript.Quit 1
End If
sh.Run Chr(34) & exe & Chr(34) & " " & Chr(34) & root & Chr(34), 0, False
