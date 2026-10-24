// Listing policy for an open catalog: banned variants, licenses, suggested ("market") prices, size classes.

// Uncensored / abliterated / "heretic" variants are never listed.
export const BANNED_MODEL = /abliterat|heretic|uncensor|jailbr[eo]ak/i;

// Checked first: any of these makes a license non-commercial or research-only (qwen-research, MRL, MNPL, CC-BY-NC…).
const NC_LICENSE = /non[- ]?commercial|\bnc\b|-nc(-|$)|\bresearch\b|\bmrl\b|mnpl|non[- ]production|c4ai|command[- ]?r/i;
const PERMISSIVE_LICENSE = new RegExp(
  [
    'apache', '\\bmit\\b', '\\bbsd\\b', 'bsd-', '\\bisc\\b', 'mpl-?2', 'unlicense', 'cc0', 'cc-by-4', 'cc-by-sa', 'creative commons attribution 4',
    'llama ?[234]', 'llama[23]\\.\\d', 'llama[- ]?\\d', 'gemma', 'qwen', 'tongyi qianwen', 'deepseek', 'openrail', 'glm-4', 'falcon',
    'nvidia[- ]open[- ]model', '\\bphi\\b', 'granite', 'olmo', 'smollm', '\\bgpl', 'lgpl', 'agpl', '\\brail\\b',
  ].join('|'),
  'i',
);

// 'permissive' | 'blocked' | 'unknown'
export function licenseClass(license) {
  const id = [license?.id, license?.name].filter((x) => typeof x === 'string').join(' ').slice(0, 300);
  if (!id.trim()) return 'unknown';
  if (NC_LICENSE.test(id)) return 'blocked';
  return PERMISSIVE_LICENSE.test(id) ? 'permissive' : 'unknown';
}

const BYTES_PER_PARAM = [
  [/f32|fp32/i, 4], [/f16|fp16|bf16/i, 2], [/q8|int8|8bit/i, 1.07], [/q6/i, 0.83], [/q5/i, 0.69], [/q4|int4|4bit|mxfp4/i, 0.57], [/q3/i, 0.45], [/q2/i, 0.35],
];

// Billions of parameters, from what the agent reported or else from file size and quantization.
export function paramsB(l) {
  if (Number.isFinite(l.params_b) && l.params_b > 0) return l.params_b;
  const m = /(\d+(?:\.\d+)?)b\b/i.exec(l.model_id || '');
  if (m) return Number(m[1]);
  if (!l.size_bytes) return null;
  const bpp = BYTES_PER_PARAM.find(([re]) => re.test(l.quant || ''))?.[1] ?? 0.6;
  return Math.round((l.size_bytes / bpp / 1e9) * 10) / 10;
}

// micro-USD. embedding < small chat < large chat; higher-precision weights cost a bit more to run.
export function marketPrice(l) {
  const p = paramsB(l) ?? 7;
  const precise = /f16|fp16|bf16|f32|q8/i.test(l.quant || '') ? 1.25 : 1;
  if (l.kind === 'embedding') return { in_per_m: Math.round((p <= 1 ? 10_000 : 20_000) * precise) };
  if (l.kind === 'decision') return { per_call: 20 };
  const tiers = [[1.5, 50_000], [4, 100_000], [9, 200_000], [15, 300_000], [35, 600_000], [80, 1_000_000]];
  const out = Math.round((tiers.find(([max]) => p <= max)?.[1] ?? 2_000_000) * precise);
  return { in_per_m: Math.round(out / 4), out_per_m: out };
}

// auto/* aliases group listings by class. Chat aliases never pick a model under 1B (or of unknown size): those
// answer ordinary questions badly. They can still be requested by name.
export const AUTO_MODELS = {
  'auto/chat-small': { kind: 'chat', title: 'Auto · small chat (1–9B)', match: (l) => l.kind === 'chat' && (paramsB(l) ?? 0) >= 1 && paramsB(l) <= 9 },
  'auto/chat-large': { kind: 'chat', title: 'Auto · large chat (> 9B)', match: (l) => l.kind === 'chat' && (paramsB(l) ?? 0) > 9 },
  'auto/embedding': { kind: 'embedding', title: 'Auto · embedding', match: (l) => l.kind === 'embedding' },
  'auto/decision': { kind: 'decision', title: 'Auto · decision', match: (l) => l.kind === 'decision' },
};

export const autoAliasOf = (l) => Object.keys(AUTO_MODELS).find((k) => AUTO_MODELS[k].match(l));
