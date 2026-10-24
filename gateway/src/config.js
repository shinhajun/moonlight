import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// There is no allowlist (see policy.js). These digests are accepted in addition to the public sources:
// for Laya, the sha256 of model.safetensors.
export const FIXED_DIGESTS = {
  'laya-base': ['891102d372688fc2a094dac56a384bc537b87c63f21f9f3dac0be2b7cbc8d86c'],
  'laya-multilingual': ['9d628fd971b700382ac6f65920a86f149777b2e748e0c955fb3b19695aa8f204'],
};

const list = (s) => (s || '').split(',').map((x) => x.trim()).filter(Boolean);
const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

export function loadConfig(overrides = {}) {
  const env = process.env;
  const base = {
    host: env.HOST || '127.0.0.1',
    port: num(env.PORT, 8080),
    dbPath: env.MOONLIGHT_DB || path.join(ROOT, 'gateway/data/moonlight.sqlite'),
    webDist: env.MOONLIGHT_WEB_DIST || path.join(ROOT, 'web/dist'),
    agentFile: env.MOONLIGHT_AGENT_FILE || path.join(ROOT, 'agent/agent.mjs'),
    // install.sh, install.ps1 and moonlight-<os>-<arch>[.exe] binaries, uploaded by deploy/deploy.sh
    releaseDir: env.MOONLIGHT_RELEASE_DIR || path.join(ROOT, 'agent/release'),
    publicUrl: env.MOONLIGHT_PUBLIC_URL || 'https://moonlight.hajunshin.com',
    // Seller tokens of operator-owned reference nodes (the agent's --trusted). Their hello sets reference digests.
    trustedTokens: list(env.MOONLIGHT_TRUSTED_TOKENS),
    adminToken: env.MOONLIGHT_ADMIN_TOKEN || '',
    fixedDigests: FIXED_DIGESTS,
    // Accepted digests per public model: the Ollama registry / Hugging Face LFS digest (cached), every digest
    // a trusted node has reported, and the fixed ones above. MOONLIGHT_REGISTRY=off disables the lookups.
    registryUrl: env.MOONLIGHT_REGISTRY === 'off' ? null : env.MOONLIGHT_REGISTRY || 'https://registry.ollama.ai',
    hfUrl: env.MOONLIGHT_HF || 'https://huggingface.co',
    registryTtlMs: 3_600_000,
    pairTtlMs: 10 * 60_000,

    feeBps: 1000,
    demoCredit: 5_000_000,
    // micro-USD per million tokens, or per call
    maxPrice: { per_m: 100_000_000, per_call: 1_000_000 },
    usageTolerance: 0.2,
    maxTokensCap: 4096,

    // score = price·w + p50·w + inflight·w − reputation·w, each term normalized across candidates
    weights: { price: 1, lat: 1, load: 1, rep: 1 },
    maxAttempts: 4,
    maxWaitS: 30, // queue wait when every seller is busy or offline; buyers may ask for up to maxWaitCapS
    maxWaitCapS: 120,
    maxConcurrencyCap: 64,
    firstChunkTimeoutMs: num(env.MOONLIGHT_FIRST_CHUNK_MS, 60_000),
    idleTimeoutMs: 30_000,
    jobDeadlineMs: 180_000,

    pingIntervalMs: 15_000,
    heartbeatTimeoutMs: 45_000,
    helloTimeoutMs: 10_000,

    verify: {
      rate: num(env.MOONLIGHT_VERIFY_RATE, 0.1), // per-listing default; admin can set 1.0 for the demo
      canaryTickMs: num(env.MOONLIGHT_CANARY_TICK_MS, 60_000), // 0 disables scheduled canaries
      chatThreshold: 0.85, // teacher-forced next-word agreement: 7 of 8 boundaries
      boundaries: 8, // word boundaries probed per chat canary
      consistencyThreshold: 0.85, // token similarity of the same canary twice (private models)
      decisionMaxDelta: 0.05,
      embeddingMinCosine: 0.99,
      canary: { temperature: 0, seed: 42, max_tokens: 48, reasoning_effort: 'none' },
      probeMaxTokens: 4,
    },
  };
  return {
    ...base,
    ...overrides,
    verify: { ...base.verify, ...overrides.verify },
    weights: { ...base.weights, ...overrides.weights },
  };
}
