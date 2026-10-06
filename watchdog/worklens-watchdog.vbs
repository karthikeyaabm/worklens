' WorkLens Watchdog Silent Launcher
' Executes worklens-watchdog.ps1 in hidden mode without popping a console window

Set objShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")

strScriptDir = objFSO.GetParentFolderName(WScript.ScriptFullName)
strPsScript = objFSO.BuildPath(strScriptDir, "worklens-watchdog.ps1")

strCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & strPsScript & """"

' Run completely hidden (window style 0, do not wait)
objShell.Run strCommand, 0, False
