import { TYPES, LOCALES } from '../lib/catalog.js';
import { usingMemory } from '../lib/redis.js';
import { send, authorized } from '../lib/http.js';

export default function handler(req, res) {
  send(res, 200, {
    types: TYPES,
    locales: LOCALES,
    memory: usingMemory,
    onVercel: Boolean(process.env.VERCEL),
    passwordRequired: Boolean(process.env.DASHBOARD_PASSWORD),
    authed: authorized(req),
  });
}
