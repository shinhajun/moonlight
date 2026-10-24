import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reputation, sellerUptime } from '../src/routing.js';
import { chatModel, say, sleep, startGateway, waitFor } from './harness.js';

const ask = (extra = {}) => ({ model: 'qwen2.5:1.5b', messages: [{ role: 'user', content: 'hi' }], ...extra });
const vram = { total_gb: 24, free_gb: 3.2, moonlight_gb: 1.9, others_gb: 18.9, budget_gb: 8 };

test('owner_busy pauses routing without counting as offline; selling resumes when the owner is done', async (t) => {
  const g = await startGateway();
  t.after(g.close);
  const events = [];
  g.ctx.bus.subscribe((type, data) => type === 'node' && events.push(data));
  const seller = await g.seller();
  const a = await g.agent({ seller, name: 'gamer-pc', models: [chatModel('qwen2.5:1.5b', { params_b: 1.5 })], behavior: say('back') });
  const buyer = await g.buyer();

  a.send({ t: 'status', paused: true, inflight: 0, reason: 'owner_busy', vram });
  await waitFor(() => events.some((e) => e.paused));
  assert.deepEqual(events.at(-1), { ...events.at(-1), online: true, paused: true, reason: 'owner_busy', vram });

  // Nothing is routed to it; with no wait the buyer gets "busy", not "no sellers".
  const now = await g.chat(buyer.secret, ask({ moonlight: { max_wait_s: 0 } }));
  assert.deepEqual([now.status, now.body.moonlight.reason], [503, 'busy']);
  assert.equal(a.jobs.length, 0);

  const nodes = (await g.get('/api/me/nodes', { key: seller.secret })).body.nodes;
  assert.deepEqual([nodes[0].online, nodes[0].paused, nodes[0].reason, nodes[0].vram], [true, true, 'owner_busy', vram]);
  const listing = (await g.get('/api/models/qwen2.5:1.5b')).body.listings[0];
  assert.deepEqual([listing.node.online, listing.paused, listing.reason, listing.vram], [true, true, 'owner_busy', vram]);

  // A waiting buyer is served as soon as the owner is done.
  const waiting = g.chat(buyer.secret, ask({ moonlight: { max_wait_s: 5 } }));
  await sleep(150);
  a.send({ t: 'status', paused: false, inflight: 0, vram: { ...vram, free_gb: 12, others_gb: 10.1 } });
  const r = await waiting;
  assert.equal(r.status, 200);
  assert.equal(r.body.choices[0].message.content, 'back');
  assert.deepEqual([events.at(-1).paused, events.at(-1).reason, events.at(-1).vram.free_gb], [false, null, 12]);

  // Owner time is not held against the seller.
  assert.equal(sellerUptime(g.ctx, seller.id), 1);
  assert.ok(reputation(g.ctx, g.listing(a.listing('qwen2.5:1.5b').listing_id)) > 0);
});

test('a node paused by hand gets no jobs, and with no other seller the buyer gets no_sellers at once', async (t) => {
  const g = await startGateway();
  t.after(g.close);
  const a = await g.agent({ name: 'n', models: [chatModel('qwen2.5:1.5b')], behavior: say('x') });
  const buyer = await g.buyer();
  a.send({ t: 'status', paused: true, inflight: 0, reason: 'manual' });
  await waitFor(() => g.ctx.hub.conns.get(a.nodeId).paused);
  const r = await g.chat(buyer.secret, ask({ moonlight: { max_wait_s: 30 } }));
  assert.deepEqual([r.status, r.body.moonlight.reason], [503, 'no_sellers']);
  assert.equal(a.jobs.length, 0);
});

test('hello stores the VRAM budget and free memory', async (t) => {
  const g = await startGateway();
  t.after(g.close);
  const seller = await g.seller();
  const url = `${g.base.replace('http', 'ws')}/agent`;
  const ws = new WebSocket(url);
  await new Promise((r) => (ws.onopen = r));
  ws.send(JSON.stringify({ t: 'hello', token: seller.secret, node: { name: 'budgeted', vram_gb: 24, vram_budget_gb: 8, vram_free_gb: 20.47 }, models: [chatModel('qwen2.5:1.5b')] }));
  await waitFor(() => g.ctx.hub.conns.size === 1);
  const n = (await g.get('/api/me/nodes', { key: seller.secret })).body.nodes[0];
  assert.equal(n.vram_budget_gb, 8);
  assert.deepEqual(n.vram, { total_gb: 24, free_gb: 20.5, moonlight_gb: null, others_gb: null, budget_gb: 8 });
  assert.deepEqual([n.paused, n.reason], [false, null]);
  ws.close();
});
