# Third-party notices

Folio itself is MIT licensed (see [LICENSE](LICENSE)). It includes or bundles the following third-party material.

## Trademarks

Folio is an independent project. It is not affiliated with, sponsored by or endorsed by Atlassian. Jira, Confluence and Atlassian are trademarks of Atlassian Corporation Plc. They are mentioned only to describe which familiar tools Folio resembles in function. Folio contains no code, artwork, icons, fonts or text from those products.

## Fonts (SIL Open Font License 1.1)

Bundled in `public/fonts/`. Full licence text and copyright lines: [public/fonts/OFL.txt](public/fonts/OFL.txt).

- DM Serif Display
- Plus Jakarta Sans
- JetBrains Mono

## Runtime dependencies

Express, marked, sanitize-html and their transitive dependencies (86 packages in all) are licensed under MIT (77), ISC (3), BSD-3-Clause (2) or BSD-2-Clause (4). Each package keeps its own licence file in `node_modules/` (and in the installers' `app/node_modules/`). Run `npm ls --omit=dev --all` for the list.

## Bundled with the installers and packages only

- **Node.js** runtime: MIT licence, https://github.com/nodejs/node/blob/main/LICENSE (shipped as `runtime/NODE-LICENSE.txt`).
- **WinSW** (Windows service wrapper, Windows installer only): MIT licence, https://github.com/winsw/winsw/blob/v2/LICENSE.txt
- **NSIS** is used to build the Windows installer; its output carries no NSIS licence obligations beyond its own zlib/bzip2/LZMA terms.
