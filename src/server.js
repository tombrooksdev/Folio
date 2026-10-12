import { writeFileSync, rmSync } from 'node:fs';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { createGithub } from './github.js';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.FOLIO_HOST ?? '0.0.0.0';
const file = process.env.FOLIO_DB ?? new URL('../data/folio.db', import.meta.url).pathname;
const production = process.env.NODE_ENV === 'production';
// Secure cookies: on when asked for, on by default in production, off only if explicitly disabled.
const secureCookies = process.env.FOLIO_SECURE_COOKIES === '1' || (production && process.env.FOLIO_SECURE_COOKIES !== '0');
const setupToken = process.env.FOLIO_SETUP_TOKEN ?? '';
const disableSetup = process.env.FOLIO_DISABLE_SETUP === '1';
const db = openDb(file);
const app = createApp(db, {
  secureCookies,
  trustProxy: process.env.FOLIO_TRUST_PROXY === '1',
  setupToken,
  disableSetup,
  allowRemoteImages: process.env.FOLIO_ALLOW_REMOTE_IMAGES === '1',
  maxStorageMb: Number(process.env.FOLIO_MAX_STORAGE_MB ?? 2048),
  uploadDir: process.env.FOLIO_UPLOAD_DIR ?? new URL('../data/uploads', import.meta.url).pathname,
  maxUploadMb: Number(process.env.FOLIO_MAX_UPLOAD_MB ?? 25),
  github: createGithub({ token: process.env.FOLIO_GITHUB_TOKEN ?? '' }),
  webhookUrl: process.env.FOLIO_WEBHOOK_URL ?? '',
  publicUrl: process.env.FOLIO_PUBLIC_URL ?? '',
});

if (!db.prepare('SELECT 1 FROM users').get() && !setupToken && !disableSetup)
  console.warn('WARNING: Folio has no users yet and the setup page is open to anyone who can reach it. Create your account now, or set FOLIO_SETUP_TOKEN (or FOLIO_DISABLE_SETUP=1 and use "folio add-user").');
if (production && !secureCookies) console.warn('WARNING: secure cookies are off. Sign in over HTTPS only (put Folio behind an HTTPS proxy) unless this is a trusted network.');
const server = app.listen(port, host, () => console.log(`Folio running at http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`));
server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${port} is already in use. Set PORT to use another.` : e.message);
  process.exit(1);
});

// Optional pid file so desktop launchers can stop the server (used by the Windows "Stop Folio" shortcut).
if (process.env.FOLIO_PID_FILE) {
  writeFileSync(process.env.FOLIO_PID_FILE, String(process.pid));
  process.on('exit', () => rmSync(process.env.FOLIO_PID_FILE, { force: true }));
}
process.on('unhandledRejection', (e) => console.error('Unhandled rejection:', e));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => process.exit(0));
