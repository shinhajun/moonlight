// Canned chat answers and a heuristic System-1 answerer for the mock.

const CANNED = [
  [/moonlight|moonlighting|night shift/i, `Moonlighting used to mean a second job worked after dark. Here it means your computer takes one: while you sleep, the models already on your disk answer other people's requests, and you get paid per token.\n\nNothing about the model leaves your machine except its answers. The gateway sends work out, meters it, and pays you 90% of what the buyer spent.`],
  [/steam|industrial|factory|cottage|revolution/i, `Before the mills, English cloth was made through the **putting-out system**: merchants delivered raw wool to cottages, families spun and wove it at home, and the merchant collected the finished cloth.\n\nThe factory won on coordination, not on craft. One building, one clock, one owner. Moonlight bets that the network can now do the coordinating, so the work can go back out to the cottages.`],
  [/haiku|poem/i, `Fans hum in the dark,\na laptop lid left open,\nearning while you dream.`],
  [/code|python|function|javascript/i, "Here's a small function that formats micro-dollars:\n\n```python\ndef usd(micro: int) -> str:\n    dollars = micro / 1_000_000\n    return f\"${dollars:,.6f}\" if dollars < 0.01 else f\"${dollars:,.2f}\"\n```\n\nKeep money as integers everywhere and only format at the edge."],
  [/hello|hi\b|hey/i, `Hello! I'm running on someone's home machine tonight. Ask me anything you'd ask any chat model; just don't paste secrets, since the person who owns this computer can read prompts.`],
];
const GENERIC = `Good question. The short answer: it depends on what you optimise for.\n\nIf you need speed, a small model on a nearby machine answers in a few hundred milliseconds. If you need depth, route to a larger model and accept a slower first token. Moonlight lets you choose per request: pin a seller, cap the price, or ask for verified machines only.`;

export function chatAnswer(messages, model_id) {
  const last = [...messages].reverse().find((m) => m.role === 'user');
  const text = typeof last?.content === 'string' ? last.content : '';
  let answer = CANNED.find(([re]) => re.test(text))?.[1] ?? GENERIC;
  if (model_id === 'qwen2.5:3b') answer = answer.split('\n\n')[0];
  return answer;
}

// What a thinking model (qwen3.5, gemma4) streams in delta.reasoning before its answer.
export function reasoningFor(messages) {
  const last = [...messages].reverse().find((m) => m.role === 'user');
  const text = String(last?.content ?? '').slice(0, 80);
  return `The user asks: "${text}". Keep it short and concrete. Mention what matters to them first, then one practical detail. No need for headings.`;
}

// Splits text into stream pieces about one token long.
export const tokens = (text) => text.match(/\s*\S+|\s+/g) ?? [];

function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0xffffffff;
}

const words = (v) => (typeof v === 'string' ? v : JSON.stringify(v ?? '')).toLowerCase();
const overlap = (a, b) => {
  const bw = new Set(words(b).match(/[a-z]{4,}/g) ?? []);
  return (words(a).match(/[a-z]{4,}/g) ?? []).filter((w) => bw.has(w)).length;
};
const round2 = (x) => Math.round(x * 100) / 100;
function normalize(scores) {
  const exp = scores.map((s) => Math.exp(s));
  const sum = exp.reduce((a, b) => a + b, 0);
  const p = exp.map((e) => round2(e / sum));
  const drift = round2(1 - p.reduce((a, b) => a + b, 0));
  p[p.indexOf(Math.max(...p))] = round2(p[p.indexOf(Math.max(...p))] + drift);
  return p;
}

// Same response shape as TypeSafe Jev (/v1/systemone).
export function systemoneAnswer({ model, state, questions }) {
  const ctx = words(state);
  const answers = {};
  for (const [name, q] of Object.entries(questions || {})) {
    const instr = words(q.instructions);
    const seed = hash(ctx + name);
    if (q.type === 'noul') {
      const signal = overlap(instr, ctx) * 0.9 + (/refund|broken|urgent|angry|now|asap/.test(ctx) ? 1.2 : -0.4);
      answers[name] = { type: 'noul', noul: round2(Math.min(0.99, Math.max(0.01, 1 / (1 + Math.exp(-(signal + (seed - 0.5) * 2)))))) };
    } else if (q.type === 'choice') {
      const keys = Object.keys(q.criteria || {});
      const p = normalize(keys.map((k, i) => overlap(`${k} ${q.criteria[k]}`, ctx) * 1.4 + hash(ctx + k) * 1.6 + (i === 0 ? 0.2 : 0)));
      const best = keys[p.indexOf(Math.max(...p))];
      answers[name] = { type: 'choice', choice: best, confidence: round2(Math.max(...p) * 0.86), probabilities: Object.fromEntries(keys.map((k, i) => [k, p[i]])) };
    } else if (q.type === 'score') {
      const crit = Array.isArray(q.criteria) ? q.criteria : Object.values(q.criteria || {});
      const p = normalize(crit.map((c, i) => overlap(c, ctx) * 1.2 + hash(ctx + c) * 1.5 + (crit.length - i) * 0.1));
      const score = round2(p.reduce((a, pi, i) => a + pi * i, 0));
      answers[name] = { type: 'score', score, confidence: round2(Math.max(...p)), legend: Object.fromEntries(crit.map((c, i) => [String(i), c])), probabilities: Object.fromEntries(p.map((pi, i) => [String(i), pi])) };
    }
  }
  const input_tokens = Math.round((JSON.stringify(state ?? {}).length + JSON.stringify(questions ?? {}).length) / 3.2) + 120;
  return { model, answers, usage: { input_tokens, output_tokens: 0 } };
}

// Deterministic unit vector: words hash into dimensions, so similar texts land close together.
export function embed(text, dims = 768) {
  const v = new Array(dims).fill(0);
  const ws = text.toLowerCase().match(/[a-z0-9]+/g) ?? [''];
  for (const word of ws) {
    let h = hash(word) * 4294967295;
    for (let k = 0; k < 24; k++) {
      h = (Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0) || 1;
      v[h % dims] += ((h >>> 8) & 1 ? 1 : -1) * (1 + (h % 7) / 7);
    }
  }
  for (let i = 0; i < dims; i++) v[i] += Math.sin(i * 0.37 + ws.length) * 0.15;
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => Math.round((x / norm) * 1e6) / 1e6);
}
