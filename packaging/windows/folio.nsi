; Folio installer for Windows (NSIS). Build with:
;   makensis -DVERSION=1.2.3 -DSTAGE=path\to\staged\files -DOUTFILE=Folio-Setup-1.2.3.exe folio.nsi
Unicode true
!ifndef VERSION
  !error "pass -DVERSION=x.y.z"
!endif
!ifndef STAGE
  !error "pass -DSTAGE=<folder containing runtime\, app\, service\, folio.cmd>"
!endif
!ifndef OUTFILE
  !define OUTFILE "Folio-Setup-${VERSION}.exe"
!endif

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "Sections.nsh"

Name "Folio ${VERSION}"
OutFile "${OUTFILE}"
InstallDir "$PROGRAMFILES64\Folio"
InstallDirRegKey HKLM "Software\Folio" "InstallDir"
RequestExecutionLevel admin
SetCompressor /SOLID lzma
BrandingText "Folio ${VERSION} - tombrooks.dev"
ShowInstDetails show

!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Folio"

!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Welcome to Folio ${VERSION}"
!define MUI_WELCOMEPAGE_TEXT "Folio is a self-hosted wiki and Scrum board.$\r$\n$\r$\nThis wizard installs it on your computer. Your pages, issues and files stay on your machine.$\r$\n$\r$\nClick Next to continue."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchFolio
!define MUI_FINISHPAGE_RUN_TEXT "Start Folio now"
!define MUI_FINISHPAGE_LINK "tombrooks.dev"
!define MUI_FINISHPAGE_LINK_LOCATION "https://tombrooks.dev"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${STAGE}\app\LICENSE"
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "Folio"
VIAddVersionKey "CompanyName" "tombrooks.dev"
VIAddVersionKey "FileDescription" "Folio installer"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "MIT License"

; ---------------------------------------------------------------- install

Function LaunchFolio
  Exec '"$WINDIR\System32\wscript.exe" "$INSTDIR\Start Folio.vbs"'
FunctionEnd

Function .onInit
  SetRegView 64
  ; Upgrading: stop a running copy first so its files can be replaced
  IfFileExists "$INSTDIR\service\folio-service.exe" 0 +3
    nsExec::Exec '"$INSTDIR\service\folio-service.exe" stop'
    Pop $0
  IfFileExists "$INSTDIR\folio.cmd" 0 +3
    nsExec::Exec '"$INSTDIR\folio.cmd" stop'
    Pop $0
FunctionEnd

Section "Folio (required)" SecMain
  SectionIn RO
  SetOutPath "$INSTDIR"
  File /r "${STAGE}\*.*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  WriteRegStr HKLM "Software\Folio" "InstallDir" "$INSTDIR"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayName" "Folio"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "${UNINST_KEY}" "Publisher" "tombrooks.dev"
  WriteRegStr HKLM "${UNINST_KEY}" "URLInfoAbout" "https://github.com/tombrooksdev/Folio"
  WriteRegStr HKLM "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKLM "${UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoRepair" 1
SectionEnd

Section "Start menu shortcuts" SecStart
  SetShellVarContext all
  CreateDirectory "$SMPROGRAMS\Folio"
  CreateShortcut "$SMPROGRAMS\Folio\Folio.lnk" "$WINDIR\System32\wscript.exe" '"$INSTDIR\Start Folio.vbs"' "" "" SW_SHOWNORMAL "" "Start Folio and open it in your browser"
  CreateShortcut "$SMPROGRAMS\Folio\Stop Folio.lnk" "$INSTDIR\folio.cmd" "stop" "" "" SW_SHOWMINIMIZED "" "Stop the Folio server"
  CreateShortcut "$SMPROGRAMS\Folio\Folio data folder.lnk" "$APPDATA\Folio"
  CreateShortcut "$SMPROGRAMS\Folio\Uninstall Folio.lnk" "$INSTDIR\Uninstall.exe"
SectionEnd

Section /o "Desktop shortcut" SecDesktop
  SetShellVarContext all
  CreateShortcut "$DESKTOP\Folio.lnk" "$WINDIR\System32\wscript.exe" '"$INSTDIR\Start Folio.vbs"' "" "" SW_SHOWNORMAL "" "Start Folio and open it in your browser"
SectionEnd

Section /o "Run in the background and start with Windows" SecService
  nsExec::ExecToLog '"$INSTDIR\service\folio-service.exe" install'
  Pop $0
  nsExec::ExecToLog '"$INSTDIR\service\folio-service.exe" start'
  Pop $0
SectionEnd

Section /o "Let other computers on my network connect" SecNetwork
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Folio" dir=in action=allow protocol=TCP localport=3000'
  Pop $0
SectionEnd

; Written last so it can see the choices above. Never overwrites an existing config.txt.
Section "-Config"
  SetShellVarContext all
  CreateDirectory "$APPDATA\Folio"
  IfFileExists "$APPDATA\Folio\config.txt" done
  CopyFiles /SILENT "$INSTDIR\config.txt" "$APPDATA\Folio\config.txt"
  ${If} ${SectionIsSelected} ${SecNetwork}
    FileOpen $0 "$APPDATA\Folio\config.txt" a
    FileSeek $0 0 END
    FileWrite $0 "$\r$\n# Added by the installer: allow other computers on the network$\r$\nFOLIO_HOST=0.0.0.0$\r$\n"
    FileClose $0
  ${EndIf}
  done:
SectionEnd

LangString DESC_Main ${LANG_ENGLISH} "The Folio program (a private copy of Node.js is included, nothing else to install)."
LangString DESC_Start ${LANG_ENGLISH} "Start menu entries to start and stop Folio and open its data folder."
LangString DESC_Desktop ${LANG_ENGLISH} "A shortcut on your desktop."
LangString DESC_Service ${LANG_ENGLISH} "Install Folio as a Windows service so it is always available, even before you sign in."
LangString DESC_Network ${LANG_ENGLISH} "Allows connections to port 3000 from other devices on your network (opens a Windows Firewall rule). Leave unticked for this computer only."
!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecMain} $(DESC_Main)
  !insertmacro MUI_DESCRIPTION_TEXT ${SecStart} $(DESC_Start)
  !insertmacro MUI_DESCRIPTION_TEXT ${SecDesktop} $(DESC_Desktop)
  !insertmacro MUI_DESCRIPTION_TEXT ${SecService} $(DESC_Service)
  !insertmacro MUI_DESCRIPTION_TEXT ${SecNetwork} $(DESC_Network)
!insertmacro MUI_FUNCTION_DESCRIPTION_END

; ---------------------------------------------------------------- uninstall

Function un.onInit
  SetRegView 64
FunctionEnd

Section "Uninstall"
  SetShellVarContext all
  nsExec::Exec '"$INSTDIR\service\folio-service.exe" stop'
  Pop $0
  nsExec::Exec '"$INSTDIR\service\folio-service.exe" uninstall'
  Pop $0
  nsExec::Exec '"$INSTDIR\folio.cmd" stop'
  Pop $0
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Folio"'
  Pop $0

  Delete "$DESKTOP\Folio.lnk"
  RMDir /r "$SMPROGRAMS\Folio"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKLM "${UNINST_KEY}"
  DeleteRegKey HKLM "Software\Folio"

  MessageBox MB_OK|MB_ICONINFORMATION "Folio was removed.$\r$\n$\r$\nYour data (pages, issues and files) was kept in C:\ProgramData\Folio. Delete that folder if you no longer need it." /SD IDOK
SectionEnd
