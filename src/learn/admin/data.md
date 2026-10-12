---
title: Backups and your data
minutes: 3
---
Everything lives in one data folder, so protecting your work is simple.

## Where it is

| Install | Data folder |
|---|---|
| Windows installer | `C:\ProgramData\Folio` |
| Windows portable | `data` beside the program |
| Linux package | `/var/lib/folio` |
| Docker | `./data` |

It holds the database (`folio.db`), your attachments (`uploads`) and, on Windows, `config.txt`.

## Back up

Run `folio backup` (see *Add people* for how to run commands). It makes a consistent copy of the database and attachments while Folio is running. Copy the result somewhere safe.

## Restore

Stop Folio, put the database and `uploads` folder back, and start it again.

> [!WARNING]
> A backup that lives on the same disk as the data is not a backup. Copy it somewhere else.
