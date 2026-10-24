import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ADMIN, startGateway } from './harness.js';

const from = (ip) => ({ headers: { 'x-forwarded-for': ip } });
const signup = (g, ip, i) => g.post('/api/auth/signup', { email: `u${i}-${ip}@example.com`, password: 'correct-horse', name: 'U' }, from(ip));

test('signup: 5 per hour per IP, then 429 with Retry-After; other addresses are unaffected', async (t) => {
  const g = await startGateway();
  t.after(g.close);
  for (let i = 0; i < 5; i++) assert.equal((await signup(g, '203.0.113.7', i)).status, 201);
  const sixth = await signup(g, '203.0.113.7', 5);
  assert.equal(sixth.status, 429);
  assert.equal(sixth.body.error.code, 'rate_limited');
  assert.ok(Number(sixth.headers['retry-after']) > 3000);
  assert.equal((await signup(g, '198.51.100.9', 0)).status, 201);
});

test('demo credit goes to the first account per IP per day; later ones start at $0 with a notice', async (t) => {
  const g = await startGateway();
  t.after(g.close);
  const first = await signup(g, '203.0.113.8', 0);
  assert.equal(first.body.demo_credit_microusd, 5_000_000);
  assert.equal(first.body.notice, undefined);
  const second = await signup(g, '203.0.113.8', 1);
  assert.equal(second.body.demo_credit_microusd, 0);
  assert.match(second.body.notice, /first account .* each day/);
  const me = await g.get('/api/me', { cookie: second.headers['set-cookie'].split(';')[0] });
  assert.equal(me.body.balance_microusd, 0);
  assert.equal(g.ctx.db.get("SELECT COUNT(*) AS n FROM ledger WHERE account_id = ? AND kind = 'grant'", second.body.account.id).n, 0);
});

test('login: 20 attempts per 15 minutes per IP', async (t) => {
  const g = await startGateway();
  t.after(g.close);
  await signup(g, '203.0.113.9', 0);
  for (let i = 0; i < 20; i++) {
    assert.equal((await g.post('/api/auth/login', { email: 'nobody@example.com', password: 'wrong-password' }, from('192.0.2.1'))).status, 401);
  }
  const blocked = await g.post('/api/auth/login', { email: 'u0-203.0.113.9@example.com', password: 'correct-horse' }, from('192.0.2.1'));
  assert.equal(blocked.status, 429);
  assert.equal((await g.post('/api/auth/login', { email: 'u0-203.0.113.9@example.com', password: 'correct-horse' }, from('192.0.2.2'))).status, 200);
});

test('device pairing: 10 codes per hour per IP', async (t) => {
  const g = await startGateway();
  t.after(g.close);
  for (let i = 0; i < 10; i++) assert.equal((await g.post('/api/devices/pair', { node: { name: `n${i}` } }, from('192.0.2.3'))).status, 201);
  assert.equal((await g.post('/api/devices/pair', { node: { name: 'n10' } }, from('192.0.2.3'))).status, 429);
});

test('seed accounts need the operator token', async (t) => {
  const g = await startGateway();
  t.after(g.close);
  const denied = await g.post('/api/accounts', { name: 'x', role: 'buyer' });
  assert.equal(denied.status, 403);
  const ok = await g.post('/api/accounts', { name: 'x', role: 'buyer' }, { key: ADMIN });
  assert.equal(ok.status, 201);
  assert.match(ok.body.secret, /^ml_sk_/);
});
