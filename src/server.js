import { writeFileSync, rmSync } from 'node:fs';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { createGithub } from './github.js';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.FOLIO_HOST ?? '0.0.0.0';
const file = process.env.FOLIO_DB ?? new URL('../data/folio.db', import.meta.url).pathname;
const app = createApp(openDb(file), {
  secureCookies: process.env.FOLIO_SECURE_COOKIES === '1',
  uploadDir: process.env.FOLIO_UPLOAD_DIR ?? new URL('../data/uploads', import.meta.url).pathname,
  maxUploadMb: Number(process.env.FOLIO_MAX_UPLOAD_MB ?? 25),
  github: createGithub({ token: process.env.FOLIO_GITHUB_TOKEN ?? '' }),
  webhookUrl: process.env.FOLIO_WEBHOOK_URL ?? '',
  publicUrl: process.env.FOLIO_PUBLIC_URL ?? '',
});
if (process.env.FOLIO_TRUST_PROXY === '1') app.set('trust proxy', 1);

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
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => process.exit(0));
