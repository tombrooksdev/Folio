# Contributing to Folio

Thanks for helping. Folio is intentionally small, so the best contributions keep it that way.

## Setup

```bash
git clone https://github.com/<your-username>/folio.git
cd folio
npm install
npm run dev     # http://localhost:3000
npm test
```

Requires Node.js 22.5+.

## Ground rules

- **Keep it dependency-light.** Think twice before adding a package; the runtime has three.
- **No build step.** Server-rendered HTML and plain JavaScript are a feature.
- **Escape everything.** All user-supplied text goes through `esc()` or the sanitised Markdown renderer.
- **Respect the CSP.** No inline `<script>` or `style=""`. Put behaviour in `public/*.js` and styling in `public/style.css`.
- **Accessible by default.** Real buttons and links, labels on inputs, visible focus, and honour `prefers-reduced-motion`.
- **Test behaviour.** Add a case to `test/app.test.js` for new routes.

## Pull requests

1. Open an issue first for anything large.
2. Keep PRs focused, with a clear description of what and why.
3. `npm test` must pass. CI also builds the Docker image.
4. Include a screenshot for visual changes, ideally in more than one theme.

## Adding a theme

See "Adding a theme" in the README.

## Reporting security issues

Please do not open a public issue. Email the maintainer via [tombrooks.dev](https://tombrooks.dev).
