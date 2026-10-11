import { openDb } from './db.js';
import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 3000);
const file = process.env.FOLIO_DB ?? new URL('../data/folio.db', import.meta.url).pathname;
const app = createApp(openDb(file), { secureCookies: process.env.FOLIO_SECURE_COOKIES === '1' });
if (process.env.FOLIO_TRUST_PROXY === '1') app.set('trust proxy', 1);
app.listen(port, () => console.log(`Folio running at http://localhost:${port}`));
