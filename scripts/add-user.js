// Create a user from the command line:  npm run add-user -- <username> [--role admin|member|viewer]
// The first user ever created is an administrator. The password is asked for (input hidden).
import { createInterface } from 'node:readline';
import { openDb } from '../src/db.js';
import { hashPassword, validatePassword, validateUsername, ROLES } from '../src/auth.js';

const args = process.argv.slice(2);
const roleAt = args.indexOf('--role');
const role = roleAt >= 0 ? args.splice(roleAt, 2)[1] : null;
const username = args[0];
if (!username || (role && !ROLES.includes(role))) { console.error(`Usage: npm run add-user -- <username> [--role ${ROLES.join('|')}]`); process.exit(1); }

function askHidden(q) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(q)) rl.output.write(s); };
    rl.question(q, (a) => { rl.close(); console.log(); resolve(a); });
  });
}
const bad = validateUsername(username);
if (bad) { console.error(bad); process.exit(1); }
if (process.env.FOLIO_PASSWORD) console.error('Note: FOLIO_PASSWORD can end up in shell history and process listings. Prefer the prompt.');
const password = process.env.FOLIO_PASSWORD ?? (await askHidden('Password (10+ characters): '));
const problem = validatePassword(password, username);
if (problem) { console.error(problem); process.exit(1); }

const db = openDb(process.env.FOLIO_DB ?? new URL('../data/folio.db', import.meta.url).pathname);
if (db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE').get(username)) { console.error(`A user named "${username}" already exists.`); process.exit(1); }
const first = !db.prepare('SELECT 1 FROM users').get();
const finalRole = role ?? (first ? 'admin' : 'member');
db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(username, await hashPassword(password), finalRole);
console.log(`Created ${finalRole} "${username}".`);
