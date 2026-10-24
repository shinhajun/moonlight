import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FakeAgent, chatModel, say, startGateway, waitFor } from './harness.js';

test('email + password accounts with an HttpOnly session cookie', async (t) => {
  const g = await startGateway();
  t.after(g.close);
  const s = await g.post('/api/auth/signup', { email: 'Ada@Example.com', password: 'correct-horse', name: 'Ada' });
  assert.equal(s.status, 201);
  assert.deepEqual(Object.keys(s.body.account), ['id', 'email', 'name', 'handle', 'created_at']);
  assert.equal(s.body.account.email, 'ada@example.com');
  assert.match(s.headers['set-cookie'], /^ml_session=[0-9a-f]{64}; HttpOnly; SameSite=Lax; Path=\//);
  const cookie = s.headers['set-cookie'].split(';')[0];

  assert.equal((await g.post('/api/auth/signup', { email: 'ada@example.com', password: 'another-one', name: 'x' })).body.error.code, 'email_taken');
  assert.equal((await g.post('/api/auth/signup', { email: 'b@example.com', password: 'short' })).status, 400);

  const me = await g.get('/api/me', { cookie });
  assert.equal(me.status, 200);
  assert.deepEqual(Object.keys(me.body), ['account', 'balance_microusd', 'keys', 'requests', 'earnings', 'jobs', 'verification_log']);
  assert.equal(me.body.balance_microusd, 5_000_000);

  assert.equal((await g.post('/api/auth/logout', undefined, { cookie })).status, 204);
  assert.equal((await g.get('/api/me', { cookie })).status, 401);

  const bad = await g.post('/api/auth/login', { email: 'ada@example.com', password: 'wrong-password' });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.error.code, 'bad_credentials');
  const ok = await g.post('/api/auth/login', { email: 'ADA@example.com', password: 'correct-horse' });
  assert.equal(ok.status, 200);
  assert.equal((await g.get('/api/me', { cookie: ok.headers['set-cookie'].split(';')[0] })).status, 200);
});

test('API keys: create (secret shown once), use, list, delete', async (t) => {
  const g = await startGateway();
  t.after(g.close);
  const u = await g.user();
  const k = await g.post('/api/me/keys', { name: 'laptop' }, { cookie: u.cookie });
  assert.equal(k.status, 201);
  assert.match(k.body.secret, /^ml_sk_[0-9a-f]{32}$/);
  assert.deepEqual(Object.keys(k.body.key), ['id', 'name', 'prefix', 'created_at']);

  await g.agent({ name: 'n', models: [chatModel('qwen2.5:7b')], behavior: say('hi') });
  const r = await g.chat(k.body.secret, { model: 'qwen2.5:7b', messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(r.status, 200);

  const me = await g.get('/api/me', { cookie: u.cookie });
  assert.equal(me.body.keys.length, 1);
  assert.ok(me.body.keys[0].last_used);
  assert.equal(me.body.requests.length, 1);
  assert.deepEqual(Object.keys(me.body.requests[0]), ['request_id', 'ts', 'model_id', 'kind', 'status', 'seller', 'node', 'verification', 'input_tokens', 'output_tokens', 'latency_ms', 'cost_microusd']);
  assert.equal(me.body.balance_microusd, 5_000_000 - me.body.requests[0].cost_microusd);

  assert.equal((await g.req('DELETE', `/api/me/keys/${k.body.key.id}`, { cookie: u.cookie })).status, 204);
  assert.equal((await g.chat(k.body.secret, { model: 'qwen2.5:7b', messages: [{ role: 'user', content: 'hi' }] })).status, 401);
});

test('device pairing: code → approve in the browser → node token → the agent connects as that node', async (t) => {
  const g = await startGateway();
  t.after(g.close);
  const node = { name: "Hajun's MacBook", os: 'darwin', arch: 'arm64', cpu: 'Apple M3', ram_gb: 24, gpu: 'Apple M3', vram_gb: 24 };
  const p = await g.post('/api/devices/pair', { node });
  assert.equal(p.status, 201);
  assert.match(p.body.pair_code, /^[A-Z]{4}-\d{4}$/);
  assert.equal(p.body.verify_url, `https://moonlight.hajunshin.com/pair/${p.body.pair_code}`);
  assert.ok(p.body.expires_at > Date.now());

  const info = await g.get(`/api/devices/${p.body.pair_code.toLowerCase().replace('-', '')}`);
  assert.deepEqual(info.body, { pair_code: p.body.pair_code, status: 'pending', expires_at: p.body.expires_at, node });
  assert.deepEqual((await g.post('/api/devices/pair/poll', { poll_token: p.body.poll_token })).body, { status: 'pending' });

  // Approval needs a signed-in owner.
  assert.equal((await g.post(`/api/devices/${p.body.pair_code}/approve`, {})).status, 401);
  const u = await g.user();
  const ok = await g.post(`/api/devices/${p.body.pair_code}/approve`, {}, { cookie: u.cookie });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.name, node.name);
  assert.equal((await g.get(`/api/devices/${p.body.pair_code}`)).body.status, 'approved');

  const poll = await g.post('/api/devices/pair/poll', { poll_token: p.body.poll_token });
  assert.equal(poll.body.status, 'approved');
  assert.match(poll.body.node_token, /^ml_nt_[0-9a-f]{32}$/);
  // Handed out once; stored only as a hash.
  assert.equal((await g.post('/api/devices/pair/poll', { poll_token: p.body.poll_token })).body.status, 'expired');
  assert.equal(g.ctx.db.get('SELECT COUNT(*) AS n FROM nodes WHERE token_hash = ?', poll.body.node_token).n, 0);

  const agent = await g.agent({ token: poll.body.node_token, name: 'whatever the agent calls itself', maxConcurrency: 2, models: [chatModel('qwen2.5:7b', { params_b: 7.6, quant: 'Q4_K_M', price: undefined })], behavior: say('hi') });
  assert.equal(agent.nodeId, ok.body.node_id);
  assert.equal(agent.sellerId, u.id);

  const nodes = await g.get('/api/me/nodes', { cookie: u.cookie });
  const n = nodes.body.nodes[0];
  assert.equal(n.name, node.name);
  assert.equal(n.online, true);
  assert.deepEqual(Object.keys(n.earnings), ['total', 'today']);
  const m = n.models[0];
  for (const k of ['listing_id', 'model_id', 'kind', 'runtime', 'family', 'params_b', 'quant', 'size_bytes', 'context', 'license', 'policy', 'price', 'market_price', 'verify_method', 'verification', 'reputation', 'requests', 'earned_microusd']) {
    assert.ok(k in m, k);
  }
  assert.equal(m.policy, 'live');
  assert.deepEqual(m.price, m.market_price); // no price from the agent: the suggested one
  assert.deepEqual(Object.keys(m.verification), ['state', 'badge', 'passed', 'failed', 'recent', 'last_check']);

  // Seller edits: price and pause; a web price survives the agent reconnecting.
  const patched = await g.req('PATCH', `/api/me/listings/${m.listing_id}`, { cookie: u.cookie, body: { price: { out_per_m: 123_000 }, paused: true } });
  assert.equal(patched.body.price.out_per_m, 123_000);
  assert.equal(patched.body.policy, 'paused');
  agent.close();
  await waitFor(() => !g.ctx.hub.conns.size);
  const again = await g.agent({ token: poll.body.node_token, models: [chatModel('qwen2.5:7b', { price: { out_per_m: 999 } })] });
  assert.equal(again.welcome.listings[0].paused, true);
  assert.equal(g.listing(m.listing_id).price.out_per_m, 123_000);

  // Someone else can't touch it, and a bad token can't connect.
  const other = await g.user();
  assert.equal((await g.req('PATCH', `/api/me/listings/${m.listing_id}`, { cookie: other.cookie, body: { paused: false } })).status, 404);
  const intruder = new FakeAgent(`${g.base.replace('http', 'ws')}/agent`, { token: 'ml_nt_' + 'f'.repeat(32) });
  await assert.rejects(intruder.connect(), /Unknown token/);
});

test('an expired pairing code cannot be approved', async (t) => {
  const g = await startGateway({ pairTtlMs: 1 });
  t.after(g.close);
  const p = await g.post('/api/devices/pair', { node: { name: 'x' } });
  await new Promise((r) => setTimeout(r, 5));
  const u = await g.user();
  assert.equal((await g.post(`/api/devices/${p.body.pair_code}/approve`, {}, { cookie: u.cookie })).status, 410);
  assert.equal((await g.post('/api/devices/pair/poll', { poll_token: p.body.poll_token })).body.status, 'expired');
});

test('catalog, stats and the SSE event feed', async (t) => {
  const g = await startGateway();
  t.after(g.close);
  const events = [];
  const ac = new AbortController();
  t.after(() => ac.abort());
  fetch(`${g.base}/api/events`, { signal: ac.signal }).then(async (res) => {
    const dec = new TextDecoder();
    for await (const chunk of res.body) {
      for (const block of dec.decode(chunk).split('\n\n')) {
        const m = /^event: (\w+)\ndata: (.*)$/s.exec(block);
        if (m) events.push({ type: m[1], data: JSON.parse(m[2]) });
      }
    }
  }).catch(() => {});
  await new Promise((r) => setTimeout(r, 50));

  const a = await g.agent({ name: 'box', models: [chatModel('qwen3.5:35b-a3b', { params_b: 35, context: 262144, family: 'qwen35moe' })], behavior: say('hello there') });
  const buyer = await g.buyer();
  await g.chat(buyer.secret, { model: 'qwen3.5:35b-a3b', messages: [{ role: 'user', content: 'hi' }] });
  await waitFor(() => events.some((e) => e.type === 'request') && events.some((e) => e.type === 'earning'));

  const node = events.find((e) => e.type === 'node').data;
  assert.deepEqual(Object.keys(node), ['ts', 'node_id', 'node_name', 'seller_id', 'online', 'paused', 'reason', 'vram']);
  const req = events.find((e) => e.type === 'request').data;
  assert.deepEqual(Object.keys(req), ['ts', 'model_id', 'kind', 'seller_id', 'seller_name', 'node_id', 'node_name', 'cost_microusd', 'latency_ms']);
  assert.equal(req.node_id, a.nodeId);
  const earning = events.find((e) => e.type === 'earning').data;
  assert.deepEqual(Object.keys(earning), ['ts', 'seller_id', 'listing_id', 'amount_microusd', 'held']);

  const stats = await g.get('/api/stats');
  assert.deepEqual(Object.keys(stats.body), ['nodes_online', 'sellers_online', 'models_live', 'requests_per_min', 'paid_to_sellers_microusd', 'verifications_last_hour']);
  assert.equal(stats.body.requests_per_min, 1);
  assert.ok(stats.body.paid_to_sellers_microusd > 0);

  const models = await g.get('/api/models');
  const m = models.body.models.find((x) => x.id === 'qwen3.5:35b-a3b');
  assert.equal(m.sellers_online, 1);
  assert.equal(m.price_from, 200_000);
  assert.equal(m.thinking, true);
  assert.equal(m.context, 262144);
  assert.ok(models.body.models.some((x) => x.id === 'auto/chat-large' && x.sellers_online === 1));

  const detail = await g.get('/api/models/qwen3.5:35b-a3b');
  assert.equal(detail.body.model.id, 'qwen3.5:35b-a3b');
  const l = detail.body.listings[0];
  assert.equal(l.node.node_id, a.nodeId);
  assert.equal(l.node.online, true);
  assert.equal(l.node.gpu, 'Fake GPU');
  assert.equal(l.seller.id, a.sellerId);
  assert.ok(l.p50_ms >= 0);
  assert.equal(l.verification.state, 'new');
  assert.equal((await g.get('/api/models/nope')).status, 404);
});

test('static web app with SPA fallback, agent and release downloads', async (t) => {
  const g = await startGateway();
  t.after(g.close);
  for (const p of ['/', '/models/qwen3.5:35b-a3b', '/pair/ABCD-1234', '/me/sell', '/chat']) {
    const r = await g.get(p);
    assert.equal(r.status, 200, p);
    assert.match(r.text, /Moonlight web/);
  }
  const asset = await g.get('/assets/app.js');
  assert.match(asset.headers['cache-control'], /immutable/);
  assert.equal((await g.get('/assets/index-old.js')).status, 404);
  assert.equal((await g.get('/agent.mjs')).text, '// agent');
  const sh = await g.get('/install.sh');
  assert.match(sh.headers['content-type'], /shellscript/);
  const bin = await g.get('/dl/moonlight-linux-x64');
  assert.equal(bin.text, 'BINARY');
  assert.match(bin.headers['content-disposition'], /moonlight-linux-x64/);
  assert.equal((await g.get('/dl/moonlight-darwin-arm64')).status, 404);
  assert.equal((await g.get('/dl/whatever')).status, 404);
  assert.equal((await g.get('/api/nope')).status, 404);
  assert.equal((await g.get('/v1/models')).headers['access-control-allow-origin'], '*');
});
