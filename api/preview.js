import { buildResponse } from '../lib/generate.js';
import { send, readJson, requireAuth } from '../lib/http.js';

// Runs the generator on an unsaved config. Uses no Upstash commands.
export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  try {
    const { config, query = {}, method = 'GET', body = {}, headers = {}, path = '/' } = await readJson(req);
    if (!config) return send(res, 400, { error: 'Missing config' });
    const proto = req.headers['x-forwarded-proto'] || (req.socket?.encrypted ? 'https' : 'http');
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const sub = path && path !== '/' ? '/' + String(path).replace(/^\//, '') : '';
    const out = buildResponse(config, {
      baseUrl: host ? `${proto}://${host}/h/${config.id}${sub}` : null,
      req: { method, path: path || '/', query, headers, body },
    });
    return send(res, 200, out);
  } catch (e) {
    return send(res, 400, { error: String(e.message || e) });
  }
}
