import assert from 'node:assert/strict';
import { test } from 'node:test';
import { estimatePrompt } from '../src/metering.js';
import { PLATFORM_ID } from '../src/store.js';
import { chatModel, say, startGateway } from './harness.js';

const TEN_WORDS = 'one two three four five six seven eight nine ten';
const ask = { model: 'qwen2.5:7b', messages: [{ role: 'user', content: 'Count to ten.' }] };
const price = { in_per_m: 100_000, out_per_m: 1_000_000 };
const promptEst = estimatePrompt(ask.messages);

test('agent-reported usage is clamped to ±20% of the gateway count', async (t) => {
  const g = await startGateway();
  t.after(g.close);
  const buyer = await g.buyer();

  const liar = await g.agent({ name: 'liar', models: [chatModel('qwen2.5:7b', { price })], behavior: say(TEN_WORDS, { usage: { input_tokens: 5000, output_tokens: 1000 } }) });
  const high = await g.chat(buyer.secret, ask);
  assert.equal(high.body.usage.completion_tokens, 12); // 10 chunks × 1.2
  assert.equal(high.body.usage.prompt_tokens, Math.ceil(promptEst * 1.2));
  liar.close();

  await g.agent({ name: 'shy', models: [chatModel('qwen2.5:7b', { price })], behavior: say(TEN_WORDS, { usage: { input_tokens: 0, output_tokens: 0 } }) });
  const low = await g.chat(buyer.secret, ask);
  assert.equal(low.body.usage.completion_tokens, 8); // 10 × 0.8
  assert.equal(low.body.usage.prompt_tokens, Math.floor(promptEst * 0.8));
});

test('each request writes debit, 90% seller credit and 10% fee; the buyer balance and seller earnings follow', async (t) => {
  const g = await startGateway();
  t.after(g.close);
  const seller = await g.seller();
  await g.agent({ seller, name: 'n', models: [chatModel('qwen2.5:7b', { price })], behavior: say(TEN_WORDS, { usage: { input_tokens: promptEst, output_tokens: 10 } }) });
  const buyer = await g.buyer();

  const r = await g.chat(buyer.secret, ask);
  const cost = Math.ceil((promptEst * price.in_per_m + 10 * price.out_per_m) / 1e6);
  assert.equal(r.body.moonlight.cost, cost);
  assert.equal(r.headers['x-moonlight-cost-microusd'], String(cost));

  const rows = g.ctx.db.all('SELECT account_id, kind, amount FROM ledger WHERE request_id = ? ORDER BY id', r.body.moonlight.request).map((x) => ({ ...x }));
  const fee = Math.round(cost / 10);
  assert.deepEqual(rows, [
    { account_id: buyer.id, kind: 'debit', amount: -cost },
    { account_id: seller.id, kind: 'earn', amount: cost - fee },
    { account_id: PLATFORM_ID, kind: 'fee', amount: fee },
  ]);
  assert.equal(rows.reduce((s, x) => s + x.amount, 0), 0);
  assert.equal(g.ctx.store.account(buyer.id).balance, 5_000_000 - cost);

  const me = await g.get('/api/me', { key: seller.secret });
  assert.equal(me.body.earnings.total, cost - fee);
  assert.equal(me.body.jobs[0].earned_microusd, cost - fee);
});

test('reasoning tokens are billed as output', async (t) => {
  const g = await startGateway();
  t.after(g.close);
  await g.agent({
    name: 'thinker', models: [chatModel('qwen3.5:35b-a3b', { price })],
    behavior: (job, io) => {
      for (const w of ['Let', ' me', ' think', ' about', ' it.']) io.reasoning(w);
      for (const w of ['Ten', ' words', ' later.']) io.chunk(w);
      io.done({ input_tokens: promptEst, output_tokens: 8 });
    },
  });
  const buyer = await g.buyer();
  const r = await g.stream(buyer.secret, { ...ask, model: 'qwen3.5:35b-a3b' });
  assert.equal(r.text, 'Ten words later.');
  assert.equal(r.chunks.map((c) => c.choices[0].delta.reasoning || '').join(''), 'Let me think about it.');
  assert.equal(r.final.usage.completion_tokens, 8);
});

test('earnings of a flagged listing are held', async (t) => {
  const g = await startGateway();
  t.after(g.close);
  const seller = await g.seller();
  const a = await g.agent({ seller, name: 'n', models: [chatModel('qwen2.5:7b', { price })], behavior: say(TEN_WORDS) });
  const buyer = await g.buyer();
  await g.chat(buyer.secret, ask);
  const before = (await g.get('/api/me', { key: seller.secret })).body.earnings;
  assert.ok(before.total > 0);
  assert.equal(before.held, 0);

  g.ctx.store.updateListing(a.listing('qwen2.5:7b').listing_id, { state: 'flagged' });
  const after = (await g.get('/api/me', { key: seller.secret })).body.earnings;
  assert.deepEqual(after, { total: 0, today: 0, held: before.total });
  // Suspended: buyers can't reach it any more.
  assert.equal((await g.chat(buyer.secret, ask)).status, 503);
});
