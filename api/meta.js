import { TYPES, LOCALES } from '../lib/catalog.js';
import { redis, KEYS, usingMemory, MAX_ENDPOINTS } from '../lib/redis.js';
import { send } from '../lib/http.js';
import { currentUser, signupsOpen } from '../lib/auth.js';

export default async function handler(req, res) {
  let user = null, legacy = 0;
  try {
    user = await currentUser(req);
    // Endpoints made before accounts existed, waiting for their owner to import them.
    if (user) legacy = Number(await redis.scard(KEYS.index)) || 0;
  } catch { /* storage unreachable: the dashboard shows that separately */ }
  send(res, 200, {
    types: TYPES,
    locales: LOCALES,
    memory: usingMemory,
    onVercel: Boolean(process.env.VERCEL),
    user,
    signups: signupsOpen(),
    legacy,
    legacyNeedsPassword: Boolean(process.env.DASHBOARD_PASSWORD),
    maxEndpoints: MAX_ENDPOINTS,
  });
}
