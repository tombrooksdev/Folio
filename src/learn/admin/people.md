---
title: Add people
minutes: 2
---
The first account you create is the administrator. Everyone else is added by an administrator, so there is no public sign-up page to secure.

## Add someone

Open your avatar menu, choose **Account**, then **Manage people** and fill in **Add a person**. Or use the command line:

| How you installed it | Command |
|---|---|
| Windows | `folio.cmd add-user alice` in the install folder |
| Linux package | `sudo folio add-user alice` |
| Docker | `docker compose exec folio node scripts/add-user.js alice` |

Add `--role viewer` or `--role admin` to choose a role. Passwords must be at least 10 characters.

## Roles

| Role | Can |
|---|---|
| **Viewer** | Read everything, change nothing |
| **Member** | Create and edit pages, issues, sprints and epics |
| **Administrator** | Also manage people and link GitHub repositories |

Give people the lowest role that works. There is no per-space permission scheme, on purpose.

## Forgotten password?

Run `folio reset-password alice`. It sets a new password and signs that person out everywhere. People can change their own password, and sign out other sessions, from **Account**.

> [!INFO]
> New people see the **first-login tour** automatically the first time they sign in.
