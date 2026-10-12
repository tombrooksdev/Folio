---
title: Link a repository
minutes: 2
---
Folio can show your GitHub repository beside your work. It only reads from GitHub. It never writes.

## Link a repository

1. Open a space and choose **Code** in the sidebar.
2. Enter `owner/repository` (a full GitHub URL also works) and choose **Link repository**.

You can then browse **Commits**, **Pull requests**, **Branches** and the repository's **README**.

## Private repositories

Public repositories work immediately. For private repositories, or to raise GitHub's anonymous limit of 60 requests an hour, ask your administrator to set `FOLIO_GITHUB_TOKEN`. A read-only token is enough.

> [!INFO]
> Results are cached for five minutes, so a brand-new commit may take a moment to appear.
