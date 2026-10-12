' Starts Folio in the background (no console window) if it is not running, then opens it in its own app window
' (Microsoft Edge or Chrome without tabs or address bar), or in your default browser if neither is installed.
Option Explicit
Dim sh, fso, base, data, port, i, ts, line
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.GetParentFolderName(WScript.ScriptFullName)
If fso.FileExists(base & "\portable.txt") Then
  data = base & "\data"
Else
  data = sh.ExpandEnvironmentStrings("%ProgramData%") & "\Folio"
End If
port = "3000"
If fso.FileExists(data & "\config.txt") Then
  Set ts = fso.OpenTextFile(data & "\config.txt", 1)
  Do Until ts.AtEndOfStream
    line = Trim(ts.ReadLine)
    If UCase(Left(line, 5)) = "PORT=" Then port = Trim(Mid(line, 6))
  Loop
  ts.Close
End If

Function IsUp()
  Dim http
  On Error Resume Next
  Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  http.setTimeouts 1000, 1000, 1000, 1000
  http.open "GET", "http://127.0.0.1:" & port & "/healthz", False
  http.send
  IsUp = (Err.Number = 0 And http.status = 200)
  On Error GoTo 0
End Function

If Not IsUp() Then
  sh.Run """" & base & "\folio.cmd"" start", 0, False
  For i = 1 To 40
    WScript.Sleep 500
    If IsUp() Then Exit For
  Next
End If
Function FindBrowser()
  Dim names, roots, r, n, p
  names = Array("Microsoft\Edge\Application\msedge.exe", "Google\Chrome\Application\chrome.exe")
  roots = Array(sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%"), sh.ExpandEnvironmentStrings("%ProgramFiles%"), sh.ExpandEnvironmentStrings("%LocalAppData%"))
  FindBrowser = ""
  For Each n In names
    For Each r In roots
      p = r & "\" & n
      If fso.FileExists(p) Then
        FindBrowser = p
        Exit Function
      End If
    Next
  Next
End Function

Dim browser, url
url = "http://localhost:" & port
browser = FindBrowser()
If browser <> "" Then
  sh.Run """" & browser & """ --app=" & url, 1, False
Else
  sh.Run url
End If
