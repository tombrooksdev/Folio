FOLIO for Windows (portable)
============================

1. Unzip this folder anywhere (for example C:\Folio or a USB stick).
2. Double-click  "Start Folio.vbs"  - Folio starts quietly and opens in your browser.
   The first visit asks you to create your administrator account.
3. To stop it, run:  folio.cmd stop   (from a Command Prompt in this folder).

Your data lives in the "data" folder next to this file. Copy that folder to back up or move Folio.

Command line (open Command Prompt in this folder):
  folio.cmd start            run in this window
  folio.cmd stop             stop the server
  folio.cmd add-user NAME    add another person
  folio.cmd backup           back up the database and attachments
  folio.cmd config           show where things are

Settings: edit data\config.txt (create it by copying config.txt from this folder).

Want it to start with Windows and run as a service? Use the installer instead
(Folio-Setup-x.y.z.exe), which can set that up for you.
