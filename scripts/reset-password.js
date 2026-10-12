// Set a new password for a user and sign them out everywhere:  npm run reset-password -- <username>
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { openDb } from '../src/db.js';
import { hashPassword, validatePassword } from '../src/auth.js';

const username = process.argv[2];
if (!username) { console.error('Usage: npm run reset-password -- <username>'); process.exit(1); }
function askHidden(q) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(q)) rl.output.write(s); };
    rl.question(q, (a) => { rl.close(); console.log(); resolve(a); });
  });
}
const db = openDb(process.env.FOLIO_DB ?? fileURLToPath(new URL('../data/folio.db', import.meta.url)));
const user = db.prepare('SELECT id, username FROM users WHERE username = ? COLLATE NOCASE').get(username);
if (!user) { console.error(`No user named "${username}".`); process.exit(1); }
const password = await askHidden('New password (10+ characters): ');
const problem = validatePassword(password, user.username);
if (problem) { console.error(problem); process.exit(1); }
db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(password), user.id);
db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
console.log(`Password changed for "${user.username}". They were signed out of every session.`);
