import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chatModel, say, sleep, startGateway, waitFor } from './harness.js';

const ask = (who, extra = {}) => ({ model: 'qwen2.5:7b', messages: [{ role: 'user', content: who }], moonlight: { max_wait_s: 5 }, ...extra });

// Holds every job until the test releases it.
function gated() {
  const waiting = [];
  const behavior = (job, io) => new Promise((resolve) => waiting.push(() => {
    io.chunk(`done ${job.body.messages[0].content}`);
    io.done({ input_tokens: 5, output_tokens: 2 });
    resolve();
  }));
  return { behavior, release: () => waiting.shift()(), pending: () => waiting.length };
}

test('never exceeds max_concurrency and serves the queue round-robin across buyers', async (t) => {
  const g = await startGateway();
  t.after(g.close);
  const gate = gated();
  const node = await g.agent({ name: 'one-slot', maxConcurrency: 1, models: [chatModel('qwen2.5:7b')], behavior: gate.behavior });
  const x = await g.buyer('x');
  const y = await g.buyer('y');

  const results = [g.chat(x.secret, ask('x1'))];
  await waitFor(() => node.jobs.length === 1);
  for (const [b, who] of [[x, 'x2'], [x, 'x3'], [y, 'y1']]) {
    results.push(g.chat(b.secret, ask(who)));
    await sleep(30);
  }
  assert.equal(g.ctx.scheduler.depth('qwen2.5:7b'), 3);
  for (let i = 1; i <= 4; i++) {
    await waitFor(() => node.jobs.length === i);
    assert.equal(gate.pending(), 1, 'one job at a time');
    gate.release();
  }
  const order = node.jobs.map((j) => j.body.messages[0].content);
  assert.deepEqual(order, ['x1', 'y1', 'x2', 'x3']);
  for (const r of await Promise.all(results)) assert.equal(r.status, 200);
  // Queue time is recorded, never billed: every request costs the same.
  const rows = g.ctx.db.all('SELECT cost, queue_ms FROM requests ORDER BY ts');
  assert.equal(new Set(rows.map((r) => r.cost)).size, 1);
  assert.ok(rows.some((r) => r.queue_ms > 0));
});

test('queue timeout returns 503 no_capacity with suggestions and Retry-After, and charges nothing', async (t) => {
  const g = await startGateway();
  t.after(g.close);
  const gate = gated();
  await g.agent({ name: 'busy', models: [chatModel('qwen2.5:7b', { params_b: 7 })], behavior: gate.behavior });
  await g.agent({ name: 'alt', models: [chatModel('qwen2.5:3b', { params_b: 3 })], behavior: say('alt') });
  const buyer = await g.buyer();

  const first = g.chat(buyer.secret, ask('first'));
  await sleep(50);
  const t0 = Date.now();
  const r = await g.chat(buyer.secret, ask('second', { moonlight: { max_wait_s: 0.3 } }));
  assert.ok(Date.now() - t0 >= 280);
  assert.equal(r.status, 503);
  assert.equal(r.body.error.code, 'no_capacity');
  assert.equal(r.headers['retry-after'], '10');
  assert.deepEqual(r.body.moonlight.suggestions, ['qwen2.5:3b', 'auto/chat-small']);
  gate.release();
  await first;
  assert.equal(g.ctx.db.get("SELECT COUNT(*) AS n FROM requests WHERE status = 'ok'").n, 1);
});

test('a seller coming online drains the queue at once; streams get queued keepalives', async (t) => {
  const g = await startGateway();
  t.after(g.close);
  // The model must exist in the catalog: one seller lists it, then goes away.
  const early = await g.agent({ name: 'early', models: [chatModel('qwen2.5:7b')], behavior: say('early') });
  early.close();
  await waitFor(() => g.ctx.hub.conns.size === 0);
  const buyer = await g.buyer();

  const pending = g.stream(buyer.secret, ask('waiting'));
  await sleep(200);
  assert.equal(g.ctx.scheduler.depth('qwen2.5:7b'), 1);
  await g.agent({ name: 'late', models: [chatModel('qwen2.5:7b')], behavior: say('served after the wait') });
  const r = await pending;
  assert.equal(r.text, 'served after the wait');
  assert.match(r.comments[0], /^: queued position=1 eta_s=\d+$/);
  const row = g.ctx.db.get('SELECT queue_ms FROM requests WHERE id = ?', r.final.moonlight.request);
  assert.ok(row.queue_ms >= 150);
});

test('a draining node gets no new jobs while its in-flight job finishes', async (t) => {
  const g = await startGateway();
  t.after(g.close);
  const gate = gated();
  const a = await g.agent({ name: 'a', maxConcurrency: 4, models: [chatModel('qwen2.5:7b', { price: { out_per_m: 1 } })], behavior: gate.behavior });
  const b = await g.agent({ name: 'b', models: [chatModel('qwen2.5:7b')], behavior: say('from b') });
  const buyer = await g.buyer();

  const inflight = g.chat(buyer.secret, ask('long one'));
  await waitFor(() => a.jobs.length === 1);
  a.send({ t: 'drain' });
  await waitFor(() => g.ctx.hub.conns.get(a.nodeId).draining);
  const next = await g.chat(buyer.secret, ask('new one'));
  assert.equal(next.body.choices[0].message.content, 'from b');
  assert.equal(a.jobs.length, 1);
  gate.release();
  assert.equal((await inflight).body.choices[0].message.content, 'done long one');
  assert.equal(b.jobs.length, 1);
});

test('no seller connected: 503 no_sellers at once; a seller that just left still gets the queue', async (t) => {
  const g = await startGateway({ offlineGraceMs: 300 });
  t.after(g.close);
  const gone = await g.agent({ name: 'gone', models: [chatModel('qwen3.5:35b-a3b', { params_b: 35 })] });
  await g.agent({ name: 'small', models: [chatModel('qwen2.5:7b', { params_b: 7 })], behavior: say('small') });
  const buyer = await g.buyer();
  gone.close();
  await waitFor(() => g.ctx.hub.conns.size === 1);

  // Within the grace period: it may reconnect, so the request waits its max_wait.
  let t0 = Date.now();
  const recent = await g.chat(buyer.secret, ask('x', { model: 'qwen3.5:35b-a3b', moonlight: { max_wait_s: 0.2 } }));
  assert.ok(Date.now() - t0 >= 180);
  assert.deepEqual([recent.status, recent.body.moonlight.reason], [503, 'busy']);

  await sleep(350);
  t0 = Date.now();
  const none = await g.chat(buyer.secret, ask('x', { model: 'qwen3.5:35b-a3b', moonlight: { max_wait_s: 30 } }));
  assert.ok(Date.now() - t0 < 200, 'fails fast');
  assert.equal(none.status, 503);
  assert.equal(none.body.error.code, 'no_capacity');
  assert.equal(none.body.moonlight.reason, 'no_sellers');
  assert.deepEqual(none.body.moonlight.suggestions, ['qwen2.5:7b', 'auto/chat-small']);
  assert.equal(none.headers['retry-after'], '10');

  // Same for an auto/* class with nobody in it, and for filters no connected seller can meet.
  assert.equal((await g.chat(buyer.secret, ask('x', { model: 'auto/chat-large' }))).body.moonlight.reason, 'no_sellers');
  assert.equal((await g.chat(buyer.secret, ask('x', { moonlight: { verified_only: true, max_wait_s: 30 } }))).body.moonlight.reason, 'no_sellers');
});

test('after a gateway restart, buyers wait for sellers that were connected just before it', async (t) => {
  const dbPath = `${(await import('node:os')).tmpdir()}/ml-restart-${process.pid}-${Date.now()}.sqlite`;
  const g1 = await startGateway({ dbPath });
  const seller = await g1.seller();
  await g1.agent({ seller, name: 'ref', models: [chatModel('qwen2.5:1.5b', { params_b: 1.5 })] });
  const buyer = await g1.buyer();
  await g1.close(); // the restart: every agent connection drops

  const g2 = await startGateway({ dbPath });
  t.after(async () => {
    await g2.close();
    const fs = await import('node:fs');
    for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) fs.rmSync(f, { force: true });
  });
  const waiting = g2.chat(buyer.secret, ask('after restart', { model: 'auto/chat-small', moonlight: { max_wait_s: 5 } }));
  await sleep(200);
  assert.equal(g2.ctx.scheduler.depth('auto/chat-small'), 1, 'queued, not failed with no_sellers');
  await g2.agent({ seller, name: 'ref', models: [chatModel('qwen2.5:1.5b', { params_b: 1.5 })], behavior: say('reconnected') });
  const r = await waiting;
  assert.equal(r.status, 200);
  assert.equal(r.body.choices[0].message.content, 'reconnected');
});
