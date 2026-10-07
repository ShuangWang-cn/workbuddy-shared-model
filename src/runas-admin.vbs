' WBBridgeConfig - launch itself with administrator rights.
' Why: reading the WorkBuddy key needs WorkBuddy.exe to fork a restricted-token
' child process, which requires SeCreateTokenPrivilege (standard users lack it).
' Non-ASCII byte count in this file must stay 0 (cmd cannot parse UTF-8 .bat).
Set ws = CreateObject("Wscript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
Set f = fso.GetFile(fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName) & "WBBridgeConfig.exe"))
ws.ShellExecute f.Path, "", "", "runas", 1
Set f = Nothing
Set fso = Nothing
Set ws = Nothing
