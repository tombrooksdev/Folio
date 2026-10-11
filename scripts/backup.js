// Consistent online backup of the database:  npm run backup [-- path/to/backup.db]
import { openDb } from '../src/db.js';

const src = process.env.FOLIO_DB ?? new URL('../data/folio.db', import.meta.url).pathname;
const dest = process.argv[2] ?? `folio-backup-${new Date().toISOString().slice(0, 10)}.db`;
openDb(src).exec(`VACUUM INTO '${dest.replaceAll("'", "''")}'`);
console.log(`Backed up ${src} -> ${dest}`);
