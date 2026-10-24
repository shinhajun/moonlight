import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';
import { startGateway } from './harness.js';

// A local stand-in for Google's securetoken signing keys.
const keyPair = () => crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = (k) => k.publicKey.export({ type: 'spki', format: 'pem' });

function token(privateKey, claims = {}, kid = 'k1') {
  const t = Math.floor(Date.now() / 1000);
  const body = {
    iss: 'https://securetoken.google.com/vada-so', aud: 'vada-so', auth_time: t - 5, iat: t - 5, exp: t + 3600,
    sub: 'google-uid-1', email: 'ada@example.com', email_verified: true, name: 'Ada Lovelace',
    firebase: { sign_in_provider: 'google.com', identities: {} }, ...claims,
  };
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = `${enc({ alg: 'RS256', kid, typ: 'JWT' })}.${enc(body)}`;
  return `${head}.${crypto.sign('RSA-SHA256', Buffer.from(head), privateKey).toString('base64url')}`;
}

async function setup(t) {
  const k1 = keyPair();
  const certs = { k1: pem(k1) };
  let fetches = 0;
  const g = await startGateway({ fetchGoogleCerts: async () => (fetches++, { certs: { ...certs }, maxAgeS: 3600 }) });
  t.after(g.close);
  const signIn = (tok, ip = '198.51.100.20') => g.post('/api/auth/google', { id_token: tok }, { headers: { 'x-forwarded-for': ip } });
  return { g, k1, certs, signIn, fetches: () => fetches };
}

test('a valid Google token creates an account with demo credit and a session; signing in again reuses it', async (t) => {
  const { g, k1, signIn, fetches } = await setup(t);
  const first = await signIn(token(k1.privateKey));
  assert.equal(first.status, 201);
  assert.equal(first.body.account.email, 'ada@example.com');
  assert.equal(first.body.account.name, 'Ada Lovelace');
  assert.equal(first.body.demo_credit_microusd, 5_000_000);
  const cookie = first.headers['set-cookie'].split(';')[0];
  assert.equal((await g.get('/api/me', { cookie })).body.balance_microusd, 5_000_000);

  const again = await signIn(token(k1.privateKey));
  assert.equal(again.status, 200);
  assert.equal(again.body.account.id, first.body.account.id);
  assert.equal(again.body.demo_credit_microusd, undefined);
  assert.equal(g.ctx.db.get("SELECT COUNT(*) AS n FROM accounts WHERE role = 'user' AND trusted = 0").n, 1);
  assert.equal(fetches(), 1, 'certificates are cached');

  // Password login on a Google-only account says how to sign in.
  const pw = await g.post('/api/auth/login', { email: 'ada@example.com', password: 'whatever-123' });
  assert.equal(pw.status, 401);
  assert.equal(pw.body.error.message, 'This account uses Google sign-in.');
});

test('rejects bad signatures, other projects, other issuers, expired tokens, unverified emails and non-Google providers', async (t) => {
  const { g, k1, signIn } = await setup(t);
  const t0 = Math.floor(Date.now() / 1000);
  const cases = {
    'bad signature': token(keyPair().privateKey),
    'wrong aud': token(k1.privateKey, { aud: 'other-project' }),
    'wrong iss': token(k1.privateKey, { iss: 'https://securetoken.google.com/other-project' }),
    expired: token(k1.privateKey, { exp: t0 - 10 }),
    'issued in the future': token(k1.privateKey, { iat: t0 + 3600 }),
    'email not verified': token(k1.privateKey, { email_verified: false }),
    'password provider': token(k1.privateKey, { firebase: { sign_in_provider: 'password' } }),
    'no subject': token(k1.privateKey, { sub: '' }),
    garbage: 'not.a.token',
  };
  for (const [name, tok] of Object.entries(cases)) {
    const r = await signIn(tok);
    assert.equal(r.status, 401, name);
    assert.equal(r.body.error.code, 'invalid_token', name);
    assert.equal(r.headers['set-cookie'], undefined, name);
  }
  assert.equal(g.ctx.db.get("SELECT COUNT(*) AS n FROM accounts WHERE role = 'user' AND trusted = 0").n, 0);
});

test('links Google to an existing account with the same verified email', async (t) => {
  const { g, k1, signIn } = await setup(t);
  const signup = await g.post('/api/auth/signup', { email: 'Ada@Example.com', password: 'correct-horse', name: 'Ada' });
  const linked = await signIn(token(k1.privateKey));
  assert.equal(linked.status, 200);
  assert.equal(linked.body.account.id, signup.body.account.id);
  assert.equal(g.ctx.store.account(signup.body.account.id).google_sub, 'google-uid-1');
  // Both ways in keep working.
  assert.equal((await g.post('/api/auth/login', { email: 'ada@example.com', password: 'correct-horse' })).status, 200);
  // A different Google identity can't take over that email.
  assert.equal((await signIn(token(k1.privateKey, { sub: 'someone-else' }))).status, 409);
});

test('a token signed with a rotated-in key triggers one certificate refetch', async (t) => {
  const { k1, certs, signIn, fetches } = await setup(t);
  assert.equal((await signIn(token(k1.privateKey))).status, 201);
  const k2 = keyPair();
  certs.k2 = pem(k2);
  assert.equal((await signIn(token(k2.privateKey, {}, 'k2'))).status, 200);
  assert.equal(fetches(), 2);
  assert.equal((await signIn(token(k2.privateKey, {}, 'k3'))).status, 401);
});

test('Google sign-ups share the per-IP daily credit and signup limit', async (t) => {
  const { k1, signIn } = await setup(t);
  const ip = '198.51.100.30';
  const a = await signIn(token(k1.privateKey, { sub: 'a', email: 'a@example.com' }), ip);
  const b = await signIn(token(k1.privateKey, { sub: 'b', email: 'b@example.com' }), ip);
  assert.equal(a.body.demo_credit_microusd, 5_000_000);
  assert.equal(b.body.demo_credit_microusd, 0);
  assert.match(b.body.notice, /first account/);
  for (const sub of ['c', 'd', 'e']) assert.equal((await signIn(token(k1.privateKey, { sub, email: `${sub}@example.com` }), ip)).status, 201);
  assert.equal((await signIn(token(k1.privateKey, { sub: 'f', email: 'f@example.com' }), ip)).status, 429);
});
