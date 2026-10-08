// Accounts: a username and password per person, and a session token the browser
// keeps after signing in. Every dashboard call names its user through that token.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { redis, KEYS } from './redis.js';
import { send } from './http.js';

const scrypt = promisify(crypto.scrypt);
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

export const signupsOpen = () => !/^(false|0|off|no)$/i.test(process.env.ALLOW_SIGNUPS || '');
export const cleanUsername = (u) => String(u ?? '').trim().toLowerCase();
export const validUsername = (u) => /^[a-z0-9][a-z0-9_-]{2,29}$/.test(u);
export const validPassword = (p) => typeof p === 'string' && p.length >= 8 && p.length <= 200;

export async function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: (await scrypt(password, salt, 32)).toString('hex') };
}

export async function passwordMatches(password, user) {
  const { hash } = await hashPassword(String(password ?? ''), user.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.hash, 'hex'));
}

// Compares two secrets without leaking where they differ.
export const sameSecret = (a, b) => crypto.timingSafeEqual(Buffer.from(sha(String(a ?? '')), 'hex'), Buffer.from(sha(String(b ?? '')), 'hex'));

// Only a hash of the token is stored, so a copy of the database can't be used to sign in.
export async function startSession(username) {
  const token = crypto.randomBytes(32).toString('base64url');
  await redis.set(KEYS.session(sha(token)), username, { ex: SESSION_SECONDS });
  return token;
}

// Warm instances remember a session briefly, which saves an Upstash command on most calls.
const CACHE_MS = 30000;
const cache = (globalThis.__mhSessions ||= new Map());
const tokenOf = (req) => /^Bearer ([A-Za-z0-9_-]{20,128})$/.exec(req.headers.authorization || '')?.[1];

export async function endSession(req) {
  const token = tokenOf(req);
  if (!token) return;
  cache.delete(sha(token));
  await redis.del(KEYS.session(sha(token)));
}

export async function currentUser(req) {
  const token = tokenOf(req);
  if (!token) return null;
  const key = sha(token);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.user;
  const user = await redis.get(KEYS.session(key));
  if (!user) return null;
  cache.set(key, { user, at: Date.now() });
  if (cache.size > 1000) cache.delete(cache.keys().next().value);
  return user;
}

// Returns the signed-in username, or answers 401 and returns null.
export async function requireUser(req, res) {
  const user = await currentUser(req);
  if (!user) send(res, 401, { error: 'Please sign in' });
  return user;
}

// Allows `max` tries per `seconds` for one caller. Used to slow password guessing.
export async function allowed(kind, who, max, seconds) {
  const key = KEYS.rate(kind, who);
  await redis.set(key, '0', { nx: true, ex: seconds });
  const n = Number(await redis.incr(key));
  if (n === 1) await redis.expire(key, seconds);
  return n <= max;
}
