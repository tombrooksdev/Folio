// Consistent online backup of the database (and attachments):  npm run backup [-- path/to/backup.db]
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db.js';
import { cpSync, existsSync, chmodSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const src = process.env.FOLIO_DB ?? fileURLToPath(new URL('../data/folio.db', import.meta.url));
const dest = process.argv[2] ?? `folio-backup-${new Date().toISOString().slice(0, 10)}.db`;
openDb(src).exec(`VACUUM INTO '${dest.replaceAll("'", "''")}'`);
chmodSync(dest, 0o600); // backups hold password hashes and every page: keep them private
console.log(`Backed up ${src} -> ${dest}`);
// attachments live beside the database; copy them too so a restore is complete
const uploads = process.env.FOLIO_UPLOAD_DIR ?? fileURLToPath(new URL('../data/uploads', import.meta.url));
const lock = (dir) => { chmodSync(dir, 0o700); for (const f of readdirSync(dir)) { const p = join(dir, f); statSync(p).isDirectory() ? lock(p) : chmodSync(p, 0o600); } };
if (existsSync(uploads)) { cpSync(uploads, `${dest}.uploads`, { recursive: true }); lock(`${dest}.uploads`); console.log(`Backed up attachments -> ${dest}.uploads`); }
