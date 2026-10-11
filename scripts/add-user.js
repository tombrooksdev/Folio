// Create a user from the command line:  npm run add-user -- <username>
// The password is read from FOLIO_PASSWORD or prompted for (input hidden).
import { createInterface } from 'node:readline';
import { openDb } from '../src/db.js';
import { hashPassword } from '../src/auth.js';

const username = process.argv[2];
if (!username) { console.error('Usage: npm run add-user -- <username>'); process.exit(1); }

function askHidden(q) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(q)) rl.output.write(s); };
    rl.question(q, (a) => { rl.close(); console.log(); resolve(a); });
  });
}
const password = process.env.FOLIO_PASSWORD ?? (await askHidden('Password (min 8 chars): '));
if (password.length < 8) { console.error('Password must be at least 8 characters.'); process.exit(1); }

const db = openDb(process.env.FOLIO_DB ?? new URL('../data/folio.db', import.meta.url).pathname);
try {
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username.trim(), hashPassword(password));
  console.log(`Created user "${username.trim()}".`);
} catch {
  console.error(`A user named "${username}" already exists.`);
  process.exit(1);
}
