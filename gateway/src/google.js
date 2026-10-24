// Firebase ID token verification with node:crypto only: RS256 against Google's securetoken certificates,
// keyed by kid, cached for the response's max-age and refetched once when a token names an unknown kid.
import crypto from 'node:crypto';

const CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const SKEW_S = 60; // tolerated clock difference for iat / auth_time

export class TokenError extends Error {}

export async function fetchGoogleCerts() {
  const res = await fetch(CERTS_URL, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`certificate fetch failed: ${res.status}`);
  const maxAgeS = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') || '')?.[1] || 3600);
  return { certs: await res.json(), maxAgeS };
}

// PEM certificate (what Google serves) or a bare public key (tests).
function publicKey(pem) {
  return pem.includes('BEGIN CERTIFICATE') ? new crypto.X509Certificate(pem).publicKey : crypto.createPublicKey(pem);
}

const decode = (part) => {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    throw new TokenError('malformed token');
  }
};

export function createFirebaseVerifier({ projectId, fetchCerts = fetchGoogleCerts, now = () => Date.now() }) {
  let keys = new Map();
  let expiresAt = 0;
  let loading = null;

  async function refresh() {
    loading ||= fetchCerts()
      .then(({ certs, maxAgeS }) => {
        keys = new Map(Object.entries(certs).map(([kid, pem]) => [kid, publicKey(pem)]));
        expiresAt = now() + maxAgeS * 1000;
      })
      .finally(() => (loading = null));
    await loading;
  }

  async function keyFor(kid) {
    if (now() >= expiresAt) await refresh();
    if (!keys.has(kid)) await refresh(); // rotated keys
    const key = keys.get(kid);
    if (!key) throw new TokenError('token signed with an unknown key');
    return key;
  }

  // Returns the verified claims, or throws TokenError.
  return async function verify(token) {
    const parts = typeof token === 'string' ? token.split('.') : [];
    if (parts.length !== 3) throw new TokenError('malformed token');
    const header = decode(parts[0]);
    const claims = decode(parts[1]);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new TokenError('unexpected token algorithm');
    const ok = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), await keyFor(header.kid), Buffer.from(parts[2], 'base64url'));
    if (!ok) throw new TokenError('bad signature');

    const t = now() / 1000;
    if (claims.aud !== projectId) throw new TokenError('token is for another project');
    if (claims.iss !== `https://securetoken.google.com/${projectId}`) throw new TokenError('unexpected issuer');
    if (!(claims.exp > t)) throw new TokenError('token expired');
    if (!(claims.iat <= t + SKEW_S)) throw new TokenError('token issued in the future');
    if (!(claims.auth_time <= t + SKEW_S)) throw new TokenError('sign-in time is in the future');
    if (typeof claims.sub !== 'string' || !claims.sub) throw new TokenError('token has no subject');
    if (claims.email_verified !== true || typeof claims.email !== 'string') throw new TokenError('Google account email is not verified');
    if (claims.firebase?.sign_in_provider !== 'google.com') throw new TokenError('not a Google sign-in');
    return claims;
  };
}
