import { redis, KEYS, HISTORY } from '../lib/redis.js';
import { send, getQuery, validId, requireAuth } from '../lib/http.js';

// The dashboard polls this. A poll with nothing new costs one Upstash command
// (reading the counter); new requests cost one more to fetch just the new ones.
export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  const { query } = getQuery(req);
  const id = query.id;
  if (!validId(id)) return send(res, 400, { error: 'Bad id' });

  try {
    if (req.method === 'DELETE') {
      await redis.del(KEYS.reqs(id), KEYS.count(id));
      return send(res, 200, { ok: true });
    }
    if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });

    const count = Number((await redis.get(KEYS.count(id))) || 0);
    const known = query.known === undefined ? -1 : Number(query.known);

    if (known === count) return send(res, 200, { count, requests: [], reset: false });

    const reset = known < 0 || count < known;
    const want = reset ? HISTORY : Math.min(count - known, HISTORY);
    const rows = want > 0 ? await redis.lrange(KEYS.reqs(id), 0, want - 1) : [];
    const requests = rows.map((r) => (typeof r === 'string' ? JSON.parse(r) : r));
    return send(res, 200, { count, requests, reset, history: HISTORY });
  } catch (e) {
    return send(res, 500, { error: String(e.message || e) });
  }
}
