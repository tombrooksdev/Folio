---
title: Add people
minutes: 2
---
The first account you create is the administrator. Everyone else is added from the command line, so there is no sign-up page to secure.

## Add someone

| How you installed it | Command |
|---|---|
| Windows | `folio.cmd add-user alice` in the install folder |
| Linux package | `sudo folio add-user alice` |
| Docker | `docker compose exec folio node scripts/add-user.js alice` |

You are asked for a password. Share it, and ask them to keep it private.

## Good to know

- All users can see and edit every space. Folio deliberately has no permission schemes.
- Passwords are stored hashed, sessions are random tokens, and failed logins are throttled.

> [!INFO]
> New people see the **first-login tour** automatically the first time they sign in.
