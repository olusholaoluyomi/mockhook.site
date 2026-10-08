import { redis, KEYS, HISTORY } from '../lib/redis.js';
import { send, getQuery, validId } from '../lib/http.js';
import { requireUser } from '../lib/auth.js';

// The dashboard polls this. A poll with nothing new costs one Upstash command
// (the endpoint's owner and its counter, read together); new requests cost one more.
export default async function handler(req, res) {
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const { query } = getQuery(req);
    const id = query.id;
    if (!validId(id)) return send(res, 400, { error: 'Bad id' });
    if (req.method !== 'GET' && req.method !== 'DELETE') return send(res, 405, { error: 'Method not allowed' });

    const [raw, counted] = await redis.mget(KEYS.ep(id), KEYS.count(id));
    if (!raw || JSON.parse(raw).owner !== user) return send(res, 404, { error: 'Not found' });

    if (req.method === 'DELETE') {
      await redis.del(KEYS.reqs(id), KEYS.count(id));
      return send(res, 200, { ok: true });
    }

    const count = Number(counted || 0);
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
