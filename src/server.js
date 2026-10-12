import { openDb } from './db.js';
import { createApp } from './app.js';
import { createGithub } from './github.js';

const port = Number(process.env.PORT ?? 3000);
const file = process.env.FOLIO_DB ?? new URL('../data/folio.db', import.meta.url).pathname;
const app = createApp(openDb(file), {
  secureCookies: process.env.FOLIO_SECURE_COOKIES === '1',
  uploadDir: process.env.FOLIO_UPLOAD_DIR ?? new URL('../data/uploads', import.meta.url).pathname,
  maxUploadMb: Number(process.env.FOLIO_MAX_UPLOAD_MB ?? 25),
  github: createGithub({ token: process.env.FOLIO_GITHUB_TOKEN ?? '' }),
});
if (process.env.FOLIO_TRUST_PROXY === '1') app.set('trust proxy', 1);
app.listen(port, () => console.log(`Folio running at http://localhost:${port}`));
