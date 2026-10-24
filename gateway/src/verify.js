// Verification: canaries at random times, replays of real decision jobs, and the per-listing state machine.
// Reference order: a trusted node serving the model, else peer majority across 2+ other sellers, else the
// listing's own consistency. Verification jobs are ordinary paid jobs from the verifier account.
import { serveChat, serveDecision, serveEmbeddings } from './serve.js';
import { VERIFIER_ID } from './store.js';
import { now } from './util.js';

const TOPICS = ['photosynthesis', 'the moon landing', 'compound interest', 'volcanoes', 'the printing press', 'black holes', 'honeybees',
  'the water cycle', 'supply and demand', 'the Roman empire', 'plate tectonics', 'vaccines', 'jazz', 'chess openings', 'coral reefs',
  'solar panels', 'the internet', 'origami', 'glaciers', 'coffee', 'sourdough bread', 'the Silk Road', 'electric cars', 'sleep',
  'the stock market', 'rainbows', 'octopuses', 'the Great Wall', 'recycling', 'marathon training'];
const TEMPLATES = [
  (t) => `Explain ${t} to a ten-year-old in two sentences.`,
  (t) => `Give me three quick facts about ${t}.`,
  (t) => `What is the most common misconception about ${t}?`,
  (t) => `Summarize the history of ${t} in one short paragraph.`,
  (t) => `Write a short, friendly intro paragraph for a blog post about ${t}.`,
  (t) => `Why do people find ${t} interesting? Answer briefly.`,
  (t) => `Describe ${t} in plain language for a beginner.`,
];
const SNIPPETS = [
  'My package arrived two days late and the box was crushed.',
  'Can you recommend a good book about the history of mathematics?',
  'The new update drains my battery twice as fast as before.',
  'Thanks so much, the support team fixed my issue in minutes!',
  'Is there a student discount for the annual plan?',
  'I was charged twice for the same order last week.',
  'The app crashes every time I open the camera.',
  'What time does the downtown store close on Sundays?',
  'I love the new dark mode, it looks great on my phone.',
  'Please cancel my subscription before the next billing date.',
];

const pick = (a) => a[Math.floor(Math.random() * a.length)];
export const canaryPrompt = () => pick(TEMPLATES)(pick(TOPICS));

function decisionCanary(modelId) {
  return {
    model: modelId,
    state: { message: pick(SNIPPETS) },
    questions: {
      is_complaint: { type: 'noul', instructions: 'Is `message` a complaint?' },
      topic: {
        type: 'choice',
        instructions: 'What is `message` mainly about?',
        criteria: { billing: 'payments, charges, refunds or prices', product: 'how the product or app works', shipping: 'delivery and packages', other: 'anything else' },
      },
    },
  };
}

// The first n words of a continuation, lowercased, as one comparable string.
export function firstWords(text, n) {
  return ((text || '').toLowerCase().match(/\w+|[^\w\s]/g) || []).slice(0, n).join(' ');
}

// The answer at least two voters agree on and no other answer ties; null if there is none.
export function majority(words) {
  const counts = new Map();
  for (const w of words) if (w != null) counts.set(w, (counts.get(w) || 0) + 1);
  const sorted = [...counts].sort((a, b) => b[1] - a[1]);
  if (!sorted.length || sorted[0][1] < 2 || sorted[1]?.[1] === sorted[0][1]) return null;
  return sorted[0][0];
}

const tokens = (s) => (s || '').toLowerCase().match(/[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu) || [];

// 2·LCS / (|a|+|b|) over word tokens.
export function similarity(a, b) {
  const x = tokens(a);
  const y = tokens(b);
  if (!x.length && !y.length) return 1;
  let prev = new Array(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i++) {
    const cur = new Array(y.length + 1).fill(0);
    for (let j = 1; j <= y.length; j++) cur[j] = x[i - 1] === y[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    prev = cur;
  }
  return (2 * prev[y.length]) / (x.length + y.length);
}

// max |Δp| across all answers; 1 when the answers don't line up.
export function maxDelta(a, b) {
  let max = 0;
  for (const name of Object.keys(a || {})) {
    const x = a[name];
    const y = b?.[name];
    if (!y || x.type !== y.type) return 1;
    if (x.type === 'noul') max = Math.max(max, Math.abs((x.noul ?? 0) - (y.noul ?? 0)));
    else {
      for (const k of new Set([...Object.keys(x.probabilities || {}), ...Object.keys(y.probabilities || {})])) {
        max = Math.max(max, Math.abs((x.probabilities?.[k] ?? 0) - (y.probabilities?.[k] ?? 0)));
      }
    }
  }
  return max;
}

export function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export function computeState(db, listingId) {
  const last = db.all('SELECT passed FROM checks WHERE listing_id = ? ORDER BY id DESC LIMIT 10', listingId);
  const fails = last.filter((c) => !c.passed).length;
  const { n, passes } = db.get('SELECT COUNT(*) AS n, COALESCE(SUM(passed), 0) AS passes FROM checks WHERE listing_id = ?', listingId);
  if (fails >= 2) return 'flagged';
  if (n < 3) return 'new';
  return passes >= 3 && fails === 0 ? 'verified' : 'new';
}

export function createVerifier(ctx) {
  const { config, db, store, hub, bus } = ctx;
  const V = config.verify;
  const busy = new Set();
  const pending = new Set();
  const timers = new Set();
  let ticker = null;

  const log = (s) => config.log?.(s);
  const verifier = () => store.account(VERIFIER_ID);
  const rateOf = (l) => l.verify_rate ?? V.rate;
  const pinOf = (conn, modelId) => ({ node_id: conn.id, listing_id: conn.listings.get(modelId) });
  const track = (p) => {
    pending.add(p);
    p.finally(() => pending.delete(p));
    return p;
  };

  // Who to compare a listing with.
  function plan(listing, conn) {
    if (listing.private) return { method: 'consistency', refs: [] };
    const others = [...hub.conns.values()].filter((c) => {
      if (c === conn || c.sellerId === listing.seller_id || c.paused || c.draining) return false;
      const lid = c.listings.get(listing.model_id);
      return lid && store.listing(lid).state !== 'flagged';
    });
    const trusted = others.filter((c) => c.trusted).sort((a, b) => a.inflight.size - b.inflight.size);
    if (trusted.length) return { method: 'canary', refs: [trusted[0]] };
    const bySeller = new Map();
    for (const c of others) if (!bySeller.has(c.sellerId)) bySeller.set(c.sellerId, c);
    const peers = [...bySeller.values()].slice(0, 4);
    return peers.length >= 2 ? { method: 'peer', refs: peers } : { method: 'consistency', refs: [] };
  }

  // 'trusted' | 'peer' | 'consistent', for the seller's dashboard.
  function methodFor(listing) {
    if (store.account(listing.seller_id)?.trusted) return 'trusted';
    const conn = [...hub.conns.values()].find((c) => c.listings.get(listing.model_id) === listing.id) || { id: null };
    const p = plan(listing, conn);
    return p.method === 'canary' ? 'trusted' : p.method === 'peer' ? 'peer' : 'consistent';
  }

  const chat = (conn, modelId, body) =>
    serveChat(ctx, { buyer: verifier(), body, pin: pinOf(conn, modelId), verification: true }).then((r) => {
      if (!r) throw new Error('no result');
      return r.content || r.reasoning;
    });

  // Teacher-forced agreement: the reference's greedy answer is cut at word boundaries (never the first) and
  // each prefix is sent as a trailing assistant message to the target and the reference(s); the first
  // compareWords words of their continuations must match. Works whether the model continues a prefill or
  // restarts. A small model of the same family guesses one next word too well, hence three.
  async function chatCheck(listing, conn, p) {
    const base = { model: listing.model_id, messages: [{ role: 'user', content: canaryPrompt() }], ...V.canary };
    if (p.method === 'consistency') {
      const a = await chat(conn, listing.model_id, base);
      const b = await chat(conn, listing.model_id, base);
      const score = similarity(a, b);
      return { method: 'consistency', metric: 'match', score, threshold: V.consistencyThreshold, passed: score >= V.consistencyThreshold };
    }
    const answer = await chat(p.refs[0], listing.model_id, base);
    // ends[k] is where word k ends; boundary k sends words 0..k and asks for what follows. k = 0 is skipped.
    const ends = [...answer.matchAll(/\S+/g)].map((m) => m.index + m[0].length);
    if (ends.length < 6) return null;
    const span = ends.length - 2; // boundaries 1 .. ends.length - 2 leave at least one word to predict
    const n = Math.min(V.boundaries, span);
    const cuts = [...new Set(Array.from({ length: n }, (_, i) => 1 + Math.floor(((i + 0.5) * span) / n)))];
    const words = (text) => firstWords(text, V.compareWords);
    let agree = 0;
    let compared = 0;
    for (const k of cuts) {
      const probe = { ...base, messages: [...base.messages, { role: 'assistant', content: answer.slice(0, ends[k]) }], max_tokens: V.probeMaxTokens };
      const [mine, ...theirs] = await Promise.all([conn, ...p.refs].map((c) => chat(c, listing.model_id, probe).then(words, () => null)));
      const expected = p.method === 'peer' ? majority(theirs) : theirs[0];
      if (mine == null || expected == null) continue;
      compared++;
      if (mine === expected) agree++;
    }
    if (compared < Math.ceil(n / 2)) return null;
    const score = agree / compared;
    return { method: p.method, metric: 'agreement', score, threshold: V.chatThreshold, passed: score >= V.chatThreshold, refNode: p.refs[0].id };
  }

  // Compare the target's output with each reference's; a peer check passes when it agrees with most peers.
  async function compare(listing, conn, p, run, mine, { metric, ok, threshold, replay = false }) {
    if (p.method === 'consistency') {
      const score = metric === 'cosine' ? cosine(mine, await run(conn)) : maxDelta(mine, await run(conn));
      return { method: 'consistency', metric, score, threshold, passed: ok(score) };
    }
    const theirs = (await Promise.all(p.refs.map((c) => run(c).catch(() => null)))).filter((x) => x != null);
    const scores = theirs.map((t) => (metric === 'cosine' ? cosine(mine, t) : maxDelta(mine, t)));
    if (p.method === 'peer') {
      if (scores.length < 2) return null;
      const sorted = [...scores].sort((a, b) => a - b);
      return { method: 'peer', metric, score: sorted[Math.floor(sorted.length / 2)], threshold, passed: scores.filter(ok).length * 2 > scores.length };
    }
    if (!scores.length) return null;
    return { method: replay ? 'replay' : 'canary', metric, score: scores[0], threshold, passed: ok(scores[0]), refNode: p.refs[0].id };
  }

  async function decisionCheck(listing, conn, p, body = decisionCanary(listing.model_id), original = null) {
    const run = (c) => serveDecision(ctx, { buyer: verifier(), body, pin: pinOf(c, listing.model_id), verification: true }).then((r) => r.answers);
    const mine = original ?? (await run(conn));
    const t = V.decisionMaxDelta;
    return compare(listing, conn, p, run, mine, { metric: 'max_dp', threshold: t, ok: (d) => d <= t, replay: !!original });
  }

  async function embeddingCheck(listing, conn, p) {
    const body = { model: listing.model_id, input: pick(SNIPPETS) };
    const run = (c) => serveEmbeddings(ctx, { buyer: verifier(), body, pin: pinOf(c, listing.model_id), verification: true }).then((r) => r.data[0].embedding);
    const t = V.embeddingMinCosine;
    return compare(listing, conn, p, run, await run(conn), { metric: 'cosine', threshold: t, ok: (c) => c >= t });
  }

  function record(listing, conn, res) {
    const t = now();
    const { lastInsertRowid } = db.run(
      'INSERT INTO checks (ts, listing_id, node_id, method, metric, passed, score, threshold, ref_node_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      t, listing.id, conn.id, res.method, res.metric, res.passed ? 1 : 0, res.score, res.threshold, res.refNode ?? null,
    );
    const state = computeState(db, listing.id);
    db.run('UPDATE checks SET state_after = ? WHERE id = ?', state, lastInsertRowid);
    if (state !== listing.state) store.updateListing(listing.id, { state });
    log(`check ${listing.id} ${listing.model_id} ${res.method} ${res.metric}=${Number(res.score).toFixed(3)} ${res.passed ? 'pass' : 'FAIL'} → ${state}`);
    bus.publish('verification', {
      ts: t, listing_id: listing.id, model_id: listing.model_id, seller_id: listing.seller_id, seller_name: conn.seller.name,
      node_id: conn.id, node_name: conn.info.name, passed: res.passed, state, method: res.method, score: res.score,
    });
    for (const c of hub.conns.values()) if (c.sellerId === listing.seller_id) hub.pushStats(c);
    if (state !== listing.state) hub.capacityChanged();
    return { ...res, state };
  }

  // Run one check on a listing now. Resolves to the recorded check, or null if it was inconclusive.
  async function check(listingId) {
    const listing = store.listing(listingId);
    if (!listing || listing.policy !== 'live' || listing.paused || busy.has(listingId)) return null;
    const conn = [...hub.conns.values()].find((c) => !c.trusted && !c.paused && c.listings.get(listing.model_id) === listing.id);
    if (!conn) return null;
    busy.add(listingId);
    try {
      const p = plan(listing, conn);
      const kind = { chat: chatCheck, decision: decisionCheck, embedding: embeddingCheck }[listing.kind];
      const res = await kind(listing, conn, p);
      return res ? record(listing, conn, res) : null;
    } catch (err) {
      log(`check ${listingId} inconclusive: ${err.message}`);
      return null;
    } finally {
      busy.delete(listingId);
    }
  }

  // A sample of real decision jobs is replayed on the reference (or peers, or the same node).
  function afterDecision({ listing, conn, body, answers }) {
    if (conn.trusted || busy.has(listing.id) || Math.random() >= rateOf(listing)) return;
    busy.add(listing.id);
    track(
      decisionCheck(listing, conn, plan(listing, conn), body, answers)
        .then((res) => res && record(store.listing(listing.id), conn, res))
        .catch((err) => log(`replay ${listing.id} inconclusive: ${err.message}`))
        .finally(() => busy.delete(listing.id)),
    );
  }

  function tick() {
    for (const conn of hub.conns.values()) {
      if (conn.trusted || conn.paused || conn.draining) continue;
      for (const lid of conn.listings.values()) {
        const l = store.listing(lid);
        if (l.paused || Math.random() >= rateOf(l)) continue;
        const timer = setTimeout(() => {
          timers.delete(timer);
          track(check(lid));
        }, Math.random() * V.canaryTickMs * 0.9);
        timer.unref();
        timers.add(timer);
      }
    }
  }

  return {
    check,
    afterDecision,
    methodFor,
    start() {
      if (V.canaryTickMs > 0) (ticker = setInterval(tick, V.canaryTickMs)).unref();
    },
    stop() {
      clearInterval(ticker);
      for (const t of timers) clearTimeout(t);
    },
    async idle() {
      while (pending.size) await Promise.allSettled([...pending]);
    },
  };
}
