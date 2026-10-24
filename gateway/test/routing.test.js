import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chatModel, model, say, sleep, startGateway } from './harness.js';

const ask = (m, extra = {}) => ({ model: m, messages: [{ role: 'user', content: 'Say hello.' }], ...extra });

test('routes to the cheapest live listing and reports who served it', async (t) => {
  const g = await startGateway();
  t.after(g.close);
  await g.agent({ name: 'pricey', models: [chatModel('qwen2.5:7b', { price: { in_per_m: 0, out_per_m: 300_000 } })], behavior: say('from pricey') });
  const cheap = await g.agent({ name: 'cheap', models: [chatModel('qwen2.5:7b', { price: { in_per_m: 0, out_per_m: 100_000 } })], behavior: say('from cheap') });
  const buyer = await g.buyer();

  const r = await g.chat(buyer.secret, ask('qwen2.5:7b'));
  assert.equal(r.status, 200);
  assert.equal(r.body.choices[0].message.content, 'from cheap');
  assert.equal(r.body.object, 'chat.completion');
  assert.equal(r.headers['x-moonlight-seller'], cheap.sellerId);
  assert.equal(r.headers['x-moonlight-node'], cheap.nodeId);
  assert.ok(Number(r.headers['x-moonlight-cost-microusd']) > 0);
  assert.deepEqual(Object.keys(r.body.usage), ['prompt_tokens', 'completion_tokens', 'total_tokens']);
});

test('buyer filters: seller, max price, verified only', async (t) => {
  const g = await startGateway();
  t.after(g.close);
  const pricey = await g.agent({ name: 'pricey', models: [chatModel('qwen2.5:7b', { price: { out_per_m: 300_000 } })], behavior: say('from pricey') });
  await g.agent({ name: 'cheap', models: [chatModel('qwen2.5:7b', { price: { out_per_m: 100_000 } })], behavior: say('from cheap') });
  const buyer = await g.buyer();

  const pinned = await g.chat(buyer.secret, ask('qwen2.5:7b', { moonlight: { seller: pricey.sellerId } }));
  assert.equal(pinned.body.choices[0].message.content, 'from pricey');

  const tooCheap = await g.chat(buyer.secret, ask('qwen2.5:7b', { moonlight: { max_price_out_per_m: 50_000 } }));
  assert.equal(tooCheap.status, 503);
  assert.equal(tooCheap.body.error.code, 'no_capacity');

  const verifiedOnly = await g.chat(buyer.secret, ask('qwen2.5:7b', { moonlight: { verified_only: true } }));
  assert.equal(verifiedOnly.status, 503);
});

test('retries on another seller when a node errors before its first chunk; the buyer never sees it', async (t) => {
  const g = await startGateway();
  t.after(g.close);
  const bad = await g.agent({ name: 'bad', models: [chatModel('qwen2.5:7b', { price: { out_per_m: 1 } })], behavior: (job, io) => io.error('oom', 'out of memory') });
  const good = await g.agent({ name: 'good', models: [chatModel('qwen2.5:7b')], behavior: say('hello from good') });
  const buyer = await g.buyer();

  const r = await g.stream(buyer.secret, ask('qwen2.5:7b'));
  assert.equal(r.status, 200);
  assert.equal(r.text, 'hello from good');
  assert.equal(r.final.moonlight.node, good.nodeId);
  assert.deepEqual(r.final.moonlight.failovers, []);
  assert.equal(bad.jobs.length, 1);
  assert.equal(good.jobs.length, 1);
});

test('retries when a node times out before its first chunk', async (t) => {
  const g = await startGateway({ firstChunkTimeoutMs: 150 });
  t.after(g.close);
  const hang = await g.agent({ name: 'hang', models: [chatModel('qwen2.5:7b', { price: { out_per_m: 1 } })], behavior: () => {} });
  await g.agent({ name: 'good', models: [chatModel('qwen2.5:7b')], behavior: say('late but fine') });
  const buyer = await g.buyer();

  const r = await g.chat(buyer.secret, ask('qwen2.5:7b'));
  assert.equal(r.status, 200);
  assert.equal(r.body.choices[0].message.content, 'late but fine');
  assert.equal(hang.jobs.length, 1);
  // The hung node was told to stop.
  assert.ok(hang.frames.some((f) => f.t === 'cancel' && f.job_id === hang.jobs[0].job_id));
});

const ANSWER = 'Hello there, general Kenobi. You are a bold one.';

// Streams the first n pieces of ANSWER, then the connection drops.
const dropsAfter = (n) => async (job, io) => {
  const parts = ANSWER.match(/\s*\S+/g);
  for (const p of parts.slice(0, n)) io.chunk(p);
  await sleep(30);
  io.drop();
};

test('mid-stream failover continues from the prefill on the next node', async (t) => {
  const g = await startGateway();
  t.after(g.close);
  const a = await g.agent({ name: 'a', models: [chatModel('qwen2.5:7b', { price: { out_per_m: 1 } })], behavior: dropsAfter(2) });
  const b = await g.agent({ name: 'b', models: [chatModel('qwen2.5:7b')], behavior: model(() => ANSWER) });
  const buyer = await g.buyer();

  const r = await g.stream(buyer.secret, ask('qwen2.5:7b'));
  assert.equal(r.status, 200);
  assert.equal(r.text, ANSWER);
  assert.ok(r.done);
  const prefill = b.jobs[0].body.messages.at(-1);
  assert.deepEqual(prefill, { role: 'assistant', content: 'Hello there,' });
  assert.equal(r.final.moonlight.node, b.nodeId);
  assert.deepEqual(r.final.moonlight.failovers, [{ from_node: a.nodeId, to_node: b.nodeId, at_token: 2 }]);
  assert.equal(r.final.choices[0].finish_reason, 'stop');
  assert.ok(r.final.usage.completion_tokens > 0);
});

test('mid-stream failover to a model that restarts drops the repeated prefix', async (t) => {
  const g = await startGateway();
  t.after(g.close);
  await g.agent({ name: 'a', models: [chatModel('gemma4:26b', { price: { out_per_m: 1 } })], behavior: dropsAfter(3) });
  await g.agent({ name: 'b', models: [chatModel('gemma4:26b')], behavior: model(() => ANSWER, { restart: true }) });
  const buyer = await g.buyer();

  const r = await g.stream(buyer.secret, ask('gemma4:26b'));
  assert.equal(r.text, ANSWER);
  assert.equal(r.final.moonlight.failovers.length, 1);
});

test('seller lost mid-stream with nobody to take over: partial answer, finish_reason length, billed for delivered tokens', async (t) => {
  const g = await startGateway();
  t.after(g.close);
  await g.agent({ name: 'a', models: [chatModel('qwen2.5:7b')], behavior: dropsAfter(3) });
  const buyer = await g.buyer();

  const r = await g.stream(buyer.secret, ask('qwen2.5:7b', { moonlight: { max_wait_s: 0.3 } }));
  assert.equal(r.status, 200);
  assert.equal(r.text, 'Hello there, general');
  assert.equal(r.final.choices[0].finish_reason, 'length');
  assert.equal(r.final.moonlight.error, 'seller_lost');
  assert.equal(r.final.usage.completion_tokens, 3);
  const row = g.ctx.db.get('SELECT status, output_tokens, cost FROM requests WHERE id = ?', r.final.moonlight.request);
  assert.equal(row.status, 'seller_lost');
  assert.equal(row.output_tokens, 3);
  assert.ok(row.cost > 0);
});

test('auto/* aliases route to a listing of that class and name the served model', async (t) => {
  const g = await startGateway();
  t.after(g.close);
  await g.agent({ name: 'small', models: [chatModel('qwen2.5:3b', { params_b: 3.1 })], behavior: say('small here') });
  await g.agent({ name: 'large', models: [chatModel('qwen3.5:35b-a3b', { params_b: 35 })], behavior: say('large here') });
  const buyer = await g.buyer();

  const small = await g.chat(buyer.secret, ask('auto/chat-small'));
  assert.equal(small.body.choices[0].message.content, 'small here');
  assert.equal(small.body.model, 'qwen2.5:3b');
  assert.equal(small.body.moonlight.served_model, 'qwen2.5:3b');

  const large = await g.stream(buyer.secret, ask('auto/chat-large'));
  assert.equal(large.text, 'large here');
  assert.equal(large.final.model, 'qwen3.5:35b-a3b');

  const list = await g.get('/v1/models');
  assert.ok(list.body.data.some((m) => m.id === 'auto/chat-small' && m.moonlight.sellers_online === 1));
});

test('errors: 401 without a key, 402 at zero balance, 404 unknown model, 503 no_capacity with suggestions', async (t) => {
  const g = await startGateway();
  t.after(g.close);
  const seller = await g.seller();
  const busy = await g.agent({ seller, name: 'busy', models: [chatModel('qwen2.5:7b', { params_b: 7 })], behavior: async (job, io) => { await sleep(300); io.chunk('x'); io.done({}); } });
  await g.agent({ name: 'other', models: [chatModel('llama3.2:3b', { params_b: 3 })], behavior: say('llama') });
  const buyer = await g.buyer();

  assert.equal((await g.chat(null, ask('qwen2.5:7b'))).status, 401);
  assert.equal((await g.chat('ml_sk_' + '0'.repeat(32), ask('qwen2.5:7b'))).status, 401);
  const st = await g.chat(seller.secret, ask('qwen2.5:7b'));
  assert.equal(st.status, 401);

  const missing = await g.chat(buyer.secret, ask('nope:1b'));
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, 'model_not_found');

  // Occupy the only qwen node, then ask with no wait.
  const first = g.chat(buyer.secret, ask('qwen2.5:7b'));
  await sleep(50);
  const full = await g.chat(buyer.secret, ask('qwen2.5:7b', { moonlight: { max_wait_s: 0 } }));
  assert.equal(full.status, 503);
  assert.equal(full.body.error.code, 'no_capacity');
  assert.equal(full.headers['retry-after'], '10');
  assert.deepEqual(full.body.moonlight.suggestions, ['llama3.2:3b', 'auto/chat-small']);
  assert.equal((await first).status, 200);
  assert.equal(busy.jobs.length, 1);

  g.ctx.db.run('UPDATE accounts SET balance = 0 WHERE id = ?', buyer.id);
  const broke = await g.chat(buyer.secret, ask('qwen2.5:7b'));
  assert.equal(broke.status, 402);
  assert.equal(broke.body.error.code, 'insufficient_balance');
});
