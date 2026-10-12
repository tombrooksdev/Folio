---
title: Issue keys in commits and pull requests
minutes: 2
---
The link between code and work is the **issue key**.

## Use the key

Put your space key and issue number in commit messages, branch names or pull request titles:

```
ENG-12 Add email verification
git checkout -b eng-12-email-verification
```

## What you get

- On the **Code** page, keys in commit messages and PR titles become links to the issue.
- On the issue itself, a **Development** panel lists every pull request and commit that mentions it, with its state: open, merged or closed.

That is all it takes. No integration to configure per issue.

> [!TIP]
> Make the key the first thing in the commit message. Habits that start in the editor are the ones that stick.
