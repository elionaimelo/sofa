!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Registering Sofa as an Xbox full screen experience home app..."
  nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\packaging\home-app.ps1" -InstallDir "$INSTDIR"'
  Pop $0
  StrCmp $0 "0" +2
    DetailPrint "Home app registration failed (code $0). Sofa still works as a desktop app."
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\packaging\home-app.ps1" -Uninstall'
  Pop $0
!macroend
