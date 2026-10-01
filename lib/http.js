import crypto from 'node:crypto';

export const MAX_BODY = 256 * 1024; // what we read from incoming requests
export const MAX_STORED_BODY = 64 * 1024; // what we keep per captured request

export function send(res, status, data, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(data));
}

export function getQuery(req) {
  const u = new URL(req.url, 'http://local');
  return { url: u, query: Object.fromEntries(u.searchParams) };
}

export async function readRaw(req) {
  // Vercel may have already buffered the body for us.
  if (Buffer.isBuffer(req.rawBody)) return { buf: req.rawBody, truncated: false };
  const chunks = [];
  let size = 0, truncated = false;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) { truncated = true; continue; }
    chunks.push(c);
  }
  return { buf: Buffer.concat(chunks), truncated, size };
}

export async function readJson(req) {
  const { buf } = await readRaw(req);
  if (!buf.length) return {};
  return JSON.parse(buf.toString('utf8'));
}

export function newId(len = 10) {
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += abc[bytes[i] % abc.length];
  return s;
}

export const validId = (id) => typeof id === 'string' && /^[a-z0-9-]{3,40}$/.test(id);

// Optional dashboard password, set DASHBOARD_PASSWORD on Vercel to turn it on.
export function authorized(req) {
  const pass = process.env.DASHBOARD_PASSWORD;
  if (!pass) return true;
  const given = String(req.headers['x-dashboard-key'] || '');
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(pass).digest();
  return crypto.timingSafeEqual(a, b);
}

export function requireAuth(req, res) {
  if (authorized(req)) return true;
  send(res, 401, { error: 'Wrong or missing dashboard password' });
  return false;
}
