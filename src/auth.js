import { scrypt, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const SESSION_DAYS = 30;
export const COOKIE = 'folio_sid';
export const HOST_COOKIE = '__Host-folio_sid'; // used when Secure cookies are on (requires Path=/ and no Domain)
export const ROLES = ['admin', 'member', 'viewer'];
export const MIN_PASSWORD = 10;
export const MAX_PASSWORD = 1024;

// scrypt runs on the thread pool, so a burst of logins can't stall the event loop.
export async function hashPassword(pw) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(pw, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export async function verifyPassword(pw, stored) {
  if (typeof pw !== 'string' || pw.length > MAX_PASSWORD) return false;
  const [saltHex, hashHex] = stored.split(':');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scryptAsync(pw, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

// Compare against a throw-away hash when the user doesn't exist, so unknown and known usernames take the same time.
let dummyHash;
export async function verifyOrDummy(pw, stored) {
  if (stored) return verifyPassword(pw, stored);
  dummyHash ??= await hashPassword('folio-timing-equaliser');
  await verifyPassword(pw, dummyHash);
  return false;
}

const COMMON = new Set(`password123 1234567890 12345678910 qwertyuiop qwerty1234 qwerty12345 1q2w3e4r5t 1qaz2wsx3edc password1234 passw0rd123 p@ssw0rd123 password12345
  abcdefghij abcd123456 0123456789 123456789a 1234567890a 12345678901 iloveyou123 iloveyou12 letmein1234 letmein123 welcome1234 welcome123 administrator changeme123 changeme1234
  football123 baseball123 trustno1234 monkey12345 dragon12345 master12345 sunshine123 princess123 superman123 whatever123 starwars123 freedom123 shadow12345 michael1234 jennifer123
  computer123 internet123 123123123123 000000000000 111111111111 aaaaaaaaaa abc1234567 qazwsxedc123 zaq12wsxcde asdfghjkl123 asdfghjklqwe qwertyuiopas`.split(/\s+/));

export function validatePassword(pw, username = '') {
  if (typeof pw !== 'string') return 'Enter a password.';
  if (pw.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters.`;
  if (pw.length > MAX_PASSWORD) return `Password must be at most ${MAX_PASSWORD} characters.`;
  if (COMMON.has(pw.toLowerCase()) || /^(.)\1+$/.test(pw)) return 'That password is too common. Choose something less guessable.';
  if (username && pw.toLowerCase() === username.toLowerCase()) return 'Password cannot be the same as the username.';
  return null;
}
export const USERNAME = /^[A-Za-z0-9][A-Za-z0-9._-]{1,31}$/;
export const validateUsername = (name) => (USERNAME.test(name) ? null : 'Username must be 2 to 32 letters, numbers, dots, dashes or underscores.');

const sha = (s) => createHash('sha256').update(s).digest('hex');

export function createSession(db, userId) {
  const token = randomBytes(32).toString('hex');
  const expires = Date.now() + SESSION_DAYS * 864e5;
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha(token), userId, expires);
  return { token, maxAge: SESSION_DAYS * 864e5 };
}

export function userForToken(db, token) {
  if (!token) return null;
  return (
    db
      .prepare(
        `SELECT u.id, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ?`
      )
      .get(sha(token), Date.now()) ?? null
  );
}

export function destroySession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
}
// Revoke every session of a user except (optionally) the one making the request.
export function destroyOtherSessions(db, userId, keepToken) {
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(userId, keepToken ? sha(keepToken) : '');
}
export const purgeExpiredSessions = (db) => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()).changes;
