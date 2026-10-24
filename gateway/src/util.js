import crypto from 'node:crypto';

export const now = () => Date.now();
export const newId = (prefix) => `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
export const newSecret = (prefix) => `${prefix}_${crypto.randomBytes(16).toString('hex')}`;
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export class ApiError extends Error {
  // extra: fields merged into the error body (e.g. {moonlight:{suggestions}}); headers: extra response headers
  constructor(status, type, code, message, { extra = null, headers = null } = {}) {
    super(message);
    Object.assign(this, { status, type, code, extra, headers });
  }
}

export const errors = {
  badRequest: (message) => new ApiError(400, 'invalid_request_error', 'invalid_request', message),
  unauthorized: (message = 'Missing or invalid API key.') => new ApiError(401, 'authentication_error', 'invalid_api_key', message),
  forbidden: (message) => new ApiError(403, 'permission_error', 'forbidden', message),
  balance: () => new ApiError(402, 'insufficient_quota', 'insufficient_balance', 'Your balance is too low for this request.'),
  noModel: (id) => new ApiError(404, 'invalid_request_error', 'model_not_found', `The model \`${id}\` does not exist.`),
  notFound: (message = 'Not found.') => new ApiError(404, 'invalid_request_error', 'not_found', message),
  upstream: (message) => new ApiError(503, 'server_error', 'upstream_failed', message),
};

// Ollama treats `name` and `name:latest` as the same model; the catalog uses the short form.
export function canonicalModel(id) {
  if (typeof id !== 'string') return '';
  const s = id.trim();
  return s.endsWith(':latest') ? s.slice(0, -7) : s;
}

export const normalizeDigest = (d) => (typeof d === 'string' ? d.trim().toLowerCase().replace(/^sha256[:-]/, '') : '');

export function p50(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
}

// Bounded array of recent samples.
export function pushRing(map, key, value, size = 50) {
  let ring = map.get(key);
  if (!ring) map.set(key, (ring = []));
  ring.push(value);
  if (ring.length > size) ring.shift();
}
