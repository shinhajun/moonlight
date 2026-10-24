#!/usr/bin/env node
// Moonlight seller agent: lists the AI models running on this computer on the Moonlight
// marketplace and serves the jobs buyers send them. Single file, zero dependencies.
// Runs on Node >= 22.4, or as the standalone `moonlight` binary built with `bun build --compile`.

import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const VERSION = '0.3.0';
const DEFAULT_GATEWAY = 'wss://moonlight.hajunshin.com/agent';
const PROBE_MS = 300;
const RESCAN_MS = 60_000;
const PING_MS = 15_000;
const STALE_MS = 45_000;
const DRAIN_MS = 30_000;

const HELP = `moonlight ${VERSION}: sell the AI models running on this computer

Usage
  moonlight                  connect this computer and start serving (pairs it on first run)
  moonlight scan             list the models this computer can serve, then exit
  moonlight stop             ask the running agent to finish its jobs and stop
  moonlight logout           forget this computer's token
  moonlight laya install     set up the Laya decision-model runner (uses uv)

Options
  --name <text>              name buyers see (default: this computer's name)
  --models <a,b,...>         only list these models (default: every model found)
  --price-out <usd>          chat price per 1M output tokens (default: market price)
  --price-in <usd>           price per 1M input tokens, for chat and embeddings
  --price-call <usd>         decision-model price per call
  --concurrency <n>          jobs served at once (default: OLLAMA_NUM_PARALLEL, else 1)
  --endpoint <url>           also serve an OpenAI-compatible server, e.g. http://127.0.0.1:9000/v1 (repeatable)
  --ollama <url>             Ollama address (default: OLLAMA_HOST, else http://127.0.0.1:11434)
  --laya <url>               laya-runner address (default: http://127.0.0.1:8765)
  --token <token>            use this token instead of pairing (ml_nt_... or ml_st_...)
  --gateway <url>            default: ${DEFAULT_GATEWAY}
  --no-browser               print the pairing link without opening a browser
  --plain                    print log lines instead of the live dashboard
  -h, --help                 show this help
  -v, --version              show the version

Operator and demo flags (not for normal sellers)
  --trusted                  [operator] run as a reference node; the gateway honors it only for operator tokens
  --cheat-serve <tag>        [DEMO ONLY] advertise --models but secretly serve <tag> instead, to show Moonlight's
                             verification catching a dishonest seller. The listing gets flagged and its earnings held.

Environment: MOONLIGHT_TOKEN, MOONLIGHT_GATEWAY, MOONLIGHT_HOME (default ~/.moonlight), OLLAMA_HOST, NO_COLOR`;

// ---------------------------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------------------------

const BOOL_FLAGS = new Set(['trusted', 'no-browser', 'plain', 'json', 'help', 'version']);
const VALUE_FLAGS = new Set(['token', 'gateway', 'name', 'models', 'price-out', 'price-in', 'price-call',
  'concurrency', 'endpoint', 'ollama', 'laya', 'cheat-serve']);

function parseArgs(argv) {
  const opts = { endpoint: [] };
  const cmd = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h') { opts.help = true; continue; }
    if (a === '-v') { opts.version = true; continue; }
    if (!a.startsWith('--')) { cmd.push(a); continue; }
    let [k, v] = a.slice(2).split(/=(.*)/s);
    if (BOOL_FLAGS.has(k)) { opts[k] = v === undefined || v !== 'false'; continue; }
    if (!VALUE_FLAGS.has(k)) die(`Unknown option --${k}. See \`moonlight --help\`.`);
    if (v === undefined) v = argv[++i];
    if (v === undefined) die(`--${k} needs a value.`);
    if (k === 'endpoint') opts.endpoint.push(v);
    else opts[k] = v;
  }
  return { cmd, opts };
}

function die(message, code = 1) {
  restoreTerminal();
  process.stderr.write(`moonlight: ${message}\n`);
  process.exit(code);
}

// ---------------------------------------------------------------------------------------------
// Config: ~/.moonlight/config.json holds one node token per gateway, mode 0600
// ---------------------------------------------------------------------------------------------

const HOME = process.env.MOONLIGHT_HOME || path.join(os.homedir(), '.moonlight');
const CONFIG_FILE = path.join(HOME, 'config.json');
const PID_FILE = path.join(HOME, 'agent.pid');
const STOP_FILE = path.join(HOME, 'stop');

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; }
}

function saveConfig(cfg) {
  fs.mkdirSync(HOME, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(CONFIG_FILE, 0o600);
}

function httpBase(gateway) {
  const u = new URL(gateway);
  return `${u.protocol === 'wss:' ? 'https:' : u.protocol === 'ws:' ? 'http:' : u.protocol}//${u.host}`;
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;
const sha256 = (data) => createHash('sha256').update(data).digest('hex');

function run(cmd, args, timeout = 3000) {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout) => resolve(err ? null : String(stdout).trim()));
    } catch { resolve(null); }
  });
}

async function getJSON(url, { body, timeout = PROBE_MS, method } = {}) {
  const res = await fetch(url, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) {
    const err = new Error(`${url} answered ${res.status}`);
    err.status = res.status;
    err.body = await res.text().catch(() => '');
    throw err;
  }
  return res.json();
}

function openBrowser(url) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
      : ['xdg-open', [url]];
  if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return false;
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch { return false; }
}

// ---------------------------------------------------------------------------------------------
// This computer
// ---------------------------------------------------------------------------------------------

async function computerName() {
  if (process.platform === 'darwin') {
    const name = await run('scutil', ['--get', 'ComputerName']);
    if (name) return name;
  }
  return os.hostname().replace(/\.(local|lan|home)$/i, '');
}

async function machineInfo(nameFlag) {
  const node = {
    name: nameFlag || await computerName(),
    os: { darwin: 'darwin', win32: 'windows' }[process.platform] ?? process.platform,
    arch: os.arch(),
    cpu: os.cpus()[0]?.model.replace(/\s+/g, ' ').trim() || os.arch(),
    ram_gb: round(os.totalmem() / 2 ** 30),
    gpu: null,
    vram_gb: null,
  };
  if (process.platform === 'darwin') {
    const out = await run('system_profiler', ['SPDisplaysDataType', '-json'], 5000);
    let gpu;
    try { gpu = JSON.parse(out).SPDisplaysDataType[0]; } catch {}
    if (gpu?.sppci_model) {
      node.gpu = gpu.sppci_cores ? `${gpu.sppci_model} (${gpu.sppci_cores}-core GPU)` : gpu.sppci_model;
      // Apple silicon GPUs share the unified memory.
      node.vram_gb = /apple/i.test(gpu.sppci_model) ? node.ram_gb : parseFloat(gpu.spdisplays_vram) || null;
    }
    return node;
  }
  const smi = await run('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits']);
  if (smi) {
    const rows = smi.split('\n').map((l) => l.split(',').map((s) => s.trim()));
    node.gpu = rows.length > 1 ? `${rows.length}x ${rows[0][0]}` : rows[0][0];
    node.vram_gb = round(rows.reduce((s, r) => s + Number(r[1] || 0), 0) / 1024);
  } else if (process.platform === 'win32') {
    const out = await run('powershell', ['-NoProfile', '-Command',
      'Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Json'], 6000);
    try {
      const list = [].concat(JSON.parse(out)).filter((g) => !/basic|virtual/i.test(g.Name));
      if (list[0]) {
        node.gpu = list[0].Name;
        node.vram_gb = list[0].AdapterRAM ? round(list[0].AdapterRAM / 2 ** 30) : null;
      }
    } catch {}
  }
  return node;
}

function defaultConcurrency(flag) {
  const n = parseInt(flag ?? process.env.OLLAMA_NUM_PARALLEL ?? '1', 10);
  return n > 0 ? n : 1;
}

// ---------------------------------------------------------------------------------------------
// Licenses
// ---------------------------------------------------------------------------------------------

// Checked in order: restrictive terms first, so a bundle of licenses that includes one is caught.
const LICENSE_TEXT = [
  [/qwen research license/i, 'qwen-research'],
  [/attribution-noncommercial-sharealike|cc[- ]by[- ]nc[- ]sa/i, 'CC-BY-NC-SA-4.0'],
  [/attribution-noncommercial|cc[- ]by[- ]nc\b/i, 'CC-BY-NC-4.0'],
  [/mistral ai non-production license/i, 'MNPL-0.1'],
  [/mistral ai research license/i, 'MRL-0.1'],
  [/llama 4 community license/i, 'llama4'],
  [/llama 3\.3 community license/i, 'llama3.3'],
  [/llama 3\.2 community license/i, 'llama3.2'],
  [/llama 3\.1 community license/i, 'llama3.1'],
  [/meta llama 3 community license/i, 'llama3'],
  [/llama 2 community license/i, 'llama2'],
  [/gemma terms of use/i, 'gemma'],
  [/tongyi qianwen license|qwen license agreement/i, 'qwen'],
  [/deepseek license agreement/i, 'deepseek'],
  [/nvidia open model license/i, 'nvidia-open-model'],
  [/openrail/i, 'openrail-m'],
  [/apache license,?\s+version 2\.0/i, 'Apache-2.0'],
  [/\bmit license\b|permission is hereby granted, free of charge/i, 'MIT'],
  [/redistribution and use in source and binary forms/i, 'BSD-3-Clause'],
  [/creative commons attribution 4\.0|cc[- ]by[- ]4\.0/i, 'CC-BY-4.0'],
  [/gnu general public license/i, 'GPL-3.0'],
];
const SPDX_CASE = { 'apache-2.0': 'Apache-2.0', mit: 'MIT', 'cc-by-4.0': 'CC-BY-4.0', 'cc-by-nc-4.0': 'CC-BY-NC-4.0',
  'cc-by-nc-sa-4.0': 'CC-BY-NC-SA-4.0', 'bsd-3-clause': 'BSD-3-Clause', 'gpl-3.0': 'GPL-3.0' };
const normalizeLicenseId = (id) => SPDX_CASE[id.toLowerCase()] ?? id;

function detectLicense(text, modelInfo = {}, source = 'ollama') {
  const t = typeof text === 'string' ? text : Array.isArray(text) ? text.join('\n') : '';
  const hit = t && LICENSE_TEXT.find(([re]) => re.test(t));
  if (hit) return { id: hit[1], text_sha256: sha256(t), source };
  // GGUF metadata: general.license is an SPDX-ish id, or "other" with the real name beside it.
  const meta = modelInfo['general.license'] === 'other' ? modelInfo['general.license.name'] : modelInfo['general.license'];
  if (meta) return { id: normalizeLicenseId(String(meta)), ...(t && { text_sha256: sha256(t) }), source: 'gguf' };
  return { id: 'unknown', ...(t && { text_sha256: sha256(t) }), source: t ? source : 'none' };
}

const hfLicenses = new Map();
function hfLicense(repo) {
  if (!hfLicenses.has(repo)) {
    hfLicenses.set(repo, getJSON(`https://huggingface.co/api/models/${repo}`, { timeout: 2500 })
      .then((d) => d.cardData?.license ?? d.tags?.find((t) => t.startsWith('license:'))?.slice(8) ?? null, () => null));
  }
  return hfLicenses.get(repo);
}

// ---------------------------------------------------------------------------------------------
// Discovery: everything this computer can serve
// ---------------------------------------------------------------------------------------------

const OPENAI_RUNTIMES = [ // OpenAI-compatible servers on their default ports
  { runtime: 'lmstudio', label: 'LM Studio', base: 'http://127.0.0.1:1234' },
  { runtime: 'llamacpp', label: 'llama.cpp', base: 'http://127.0.0.1:8080' }, // LocalAI also defaults to :8080
  { runtime: 'vllm', label: 'vLLM', base: 'http://127.0.0.1:8000' },
  { runtime: 'jan', label: 'Jan', base: 'http://127.0.0.1:1337' },
  { runtime: 'kobold', label: 'KoboldCpp', base: 'http://127.0.0.1:5001' },
];
const RUNTIME_LABEL = { ollama: 'Ollama', laya: 'laya-runner', localai: 'LocalAI', openai: 'OpenAI-compatible',
  ...Object.fromEntries(OPENAI_RUNTIMES.map((r) => [r.runtime, r.label])) };
const EMBED_RE = /embed|bge-|\bbge\b|\be5-|gte-|minilm|mxbai|arctic-embed|jina-emb|nomic/i;
const LAYA_PUBLIC = {
  'laya-base': { ref: 'convaiinnovations/laya', params_b: 0.42, context: 512, size_bytes: 842609210 },
  'laya-multilingual': { ref: 'convaiinnovations/laya/multilingual', params_b: 0.32, context: 1024, size_bytes: 643835514 },
};

function ollamaBase(flag) {
  let v = flag || process.env.OLLAMA_HOST || '127.0.0.1:11434';
  if (!/^https?:\/\//.test(v)) v = `http://${v}`;
  const u = new URL(v);
  if (u.hostname === '0.0.0.0' || u.hostname === '::' || u.hostname === '[::]') u.hostname = '127.0.0.1';
  if (!u.port && u.protocol === 'http:' && !(flag && /:\d+/.test(flag))) u.port = '11434';
  return u.origin;
}

function paramsB(count, label) {
  if (count) return round(count / 1e9, count < 1e10 ? 2 : 1);
  const m = String(label ?? '').match(/([\d.]+)\s*([BM])/i);
  return m ? round(parseFloat(m[1]) / (m[2].toUpperCase() === 'M' ? 1000 : 1), 2) : null;
}

function ollamaSource(name, modelfile = '') {
  const tagged = (n) => (n.includes(':') ? n : `${n}:latest`);
  const hf = name.match(/^(?:hf\.co|huggingface\.co)\/([^/]+\/[^/:]+)(?::(.+))?$/);
  if (hf) {
    // The GGUF blob Ollama stored is named by its sha256, which is the file's LFS oid on Hugging Face.
    const fileSha = modelfile.match(/^FROM .*sha256[-:]([0-9a-f]{64})/m)?.[1];
    return { registry: 'hf', ref: `${hf[1]}:${hf[2] ?? 'latest'}`, ...(fileSha && { file_sha256: fileSha }) };
  }
  const parts = name.split('/');
  if (parts.length === 1) return { registry: 'ollama', ref: `library/${tagged(name)}` };
  if (parts.length === 2) return { registry: 'ollama', ref: tagged(name) };
  return { registry: 'local', ref: name };
}

const showCache = new Map(); // digest -> compact /api/show facts (the full answer lists every tensor)

async function scanOllama(base) {
  const { models = [] } = await getJSON(`${base}/api/tags`);
  return Promise.all(models.map(async (m) => {
    let info = showCache.get(m.digest);
    if (!info) {
      const show = await getJSON(`${base}/api/show`, { body: { model: m.name }, timeout: 10_000 }).catch(() => null);
      if (show) {
        const mi = show.model_info ?? {};
        info = {
          details: show.details ?? {}, capabilities: show.capabilities ?? [], modelfile: show.modelfile ?? '',
          arch: mi['general.architecture'], count: mi['general.parameter_count'],
          context: mi[`${mi['general.architecture']}.context_length`] ?? null,
          dims: mi[`${mi['general.architecture']}.embedding_length`] ?? null,
          license: detectLicense(show.license, mi, 'ollama'),
        };
        showCache.set(m.digest, info);
      }
    }
    info ??= { details: m.details ?? {}, capabilities: [], modelfile: '', license: { id: 'unknown', source: 'none' } };
    const kind = info.capabilities.includes('embedding') ? 'embedding' : 'chat';
    const source = ollamaSource(m.name, info.modelfile);
    let license = info.license;
    if (license.id === 'unknown' && source.registry === 'hf') {
      const id = await hfLicense(source.ref.split(':')[0]);
      if (id) license = { id: normalizeLicenseId(id), source: 'hf' };
    }
    return {
      model_id: m.name.replace(/:latest$/, ''),
      kind,
      runtime: 'ollama',
      digest: source.file_sha256 ?? m.digest,
      size_bytes: m.size ?? null,
      quant: info.details.quantization_level ?? null,
      private: false,
      family: info.details.family ?? info.arch ?? null,
      params_b: paramsB(info.count, info.details.parameter_size),
      context: info.context ?? null,
      ...(kind === 'embedding' && { dims: info.dims ?? null }),
      license,
      source,
      _route: { base, name: m.name },
    };
  }));
}

async function scanLaya(base) {
  const h = await getJSON(`${base}/health`);
  const list = h.models ?? [{ model_id: h.model_id, digest: h.digest, kind: 'decision', private: false }];
  return list.map((m) => {
    const pub = LAYA_PUBLIC[m.model_id];
    return {
      model_id: m.model_id,
      kind: 'decision',
      runtime: 'laya',
      digest: m.digest,
      size_bytes: pub?.size_bytes ?? null,
      quant: null,
      private: !!m.private,
      family: 'laya',
      params_b: pub?.params_b ?? null,
      context: pub?.context ?? null,
      // Every Laya checkpoint, including private fine-tunes, derives from the Apache-2.0 Laya weights.
      license: { id: 'Apache-2.0', source: pub ? 'hf' : 'base-model' },
      source: pub ? { registry: 'hf', ref: pub.ref } : { registry: 'local', ref: m.model_id },
      _route: { base, name: m.model_id },
      _device: h.device,
    };
  });
}

async function scanOpenAI(runtime, base) {
  const list = await getJSON(`${base}/v1/models`);
  if (!Array.isArray(list?.data)) throw new Error('not an OpenAI-compatible server');
  const owners = list.data.map((d) => d.owned_by);
  let props = null;
  if (runtime === 'llamacpp') {
    props = await getJSON(`${base}/props`).catch(() => null);
    if (!props && !owners.includes('llamacpp')) runtime = 'localai';
  }
  if (runtime === 'vllm' && !owners.includes('vllm')) runtime = 'openai';
  const lms = {};
  if (runtime === 'lmstudio') {
    const v0 = await getJSON(`${base}/api/v0/models`, { timeout: 1500 }).catch(() => null);
    for (const m of v0?.data ?? []) lms[m.id] = m;
  }
  return Promise.all(list.data.map(async (d) => {
    const x = lms[d.id] ?? {};
    const id = runtime === 'kobold' ? d.id.replace(/^koboldcpp\//, '') : path.basename(d.id).replace(/\.gguf$/i, '');
    const hfRef = /^[\w.-]+\/[\w.-]+$/.test(d.id) ? d.id : null;
    const hfId = hfRef && await hfLicense(hfRef);
    return {
      model_id: hfRef ?? id,
      kind: x.type === 'embeddings' || (!x.type && EMBED_RE.test(d.id)) ? 'embedding' : 'chat',
      runtime,
      digest: null,
      size_bytes: null,
      quant: x.quantization ?? d.id.match(/\b(I?Q\d_[A-Z0-9_]+|Q\d_\d|BF16|F16|FP8|AWQ|GPTQ)\b/i)?.[1] ?? null,
      private: false,
      family: x.arch ?? null,
      params_b: paramsB(null, d.id.match(/(\d+(?:\.\d+)?)\s*([BM])\b/i)?.[0]),
      context: x.max_context_length ?? d.max_model_len ?? props?.default_generation_settings?.n_ctx ?? null,
      license: hfId ? { id: normalizeLicenseId(hfId), source: 'hf' } : { id: 'unknown', source: 'none' },
      source: hfRef ? { registry: 'hf', ref: hfRef } : { registry: 'local', ref: d.id },
      _route: { base, name: d.id },
    };
  }));
}

// Probes every runtime in parallel. Returns the de-duplicated models and what answered where.
async function discover(cfg) {
  const probes = [
    { runtime: 'ollama', base: cfg.ollama, scan: () => scanOllama(cfg.ollama) },
    { runtime: 'laya', base: cfg.laya, scan: () => scanLaya(cfg.laya) },
    ...OPENAI_RUNTIMES.map((r) => ({ ...r, scan: () => scanOpenAI(r.runtime, r.base) })),
    ...cfg.endpoints.map((u) => {
      const base = u.replace(/\/+$/, '').replace(/\/v1$/, '');
      return { runtime: 'openai', base, scan: () => scanOpenAI('openai', base) };
    }),
  ];
  const results = await Promise.all(probes.map((p) => p.scan().then((models) => ({ ...p, models }), () => ({ ...p, models: null }))));
  const seen = new Set();
  const models = [];
  for (const r of results) {
    for (const m of r.models ?? []) {
      if (seen.has(m.model_id)) continue;
      seen.add(m.model_id);
      models.push(m);
    }
  }
  const runtimes = results.filter((r) => r.models).map((r) => ({
    runtime: r.models[0]?.runtime ?? r.runtime, base: r.base, count: r.models.length,
    device: r.models[0]?._device,
  }));
  return { models, runtimes };
}

// For --cheat-serve: a listing for a registry tag that may not be installed here, with the registry's
// real digest, so the digest check passes and only behavior verification can catch the swap.
async function registryEntry(tag) {
  const src = ollamaSource(tag);
  if (src.registry !== 'ollama') throw new Error(`--cheat-serve can only advertise Ollama registry tags, not ${tag}`);
  const [repo, ref] = src.ref.split(':');
  const res = await fetch(`https://registry.ollama.ai/v2/${repo}/manifests/${ref}`, {
    headers: { accept: 'application/vnd.docker.distribution.manifest.v2+json' }, signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`the Ollama registry has no ${tag} (${res.status})`);
  const raw = Buffer.from(await res.arrayBuffer());
  const manifest = JSON.parse(raw);
  const licLayer = manifest.layers.find((l) => l.mediaType.endsWith('.license'));
  const licText = licLayer && await fetch(`https://registry.ollama.ai/v2/${repo}/blobs/${licLayer.digest}`,
    { signal: AbortSignal.timeout(8000) }).then((r) => r.text(), () => '');
  return {
    model_id: tag.replace(/:latest$/, ''), kind: 'chat', runtime: 'ollama', digest: sha256(raw),
    size_bytes: manifest.layers.reduce((s, l) => s + l.size, 0), quant: null, private: false,
    family: repo.split('/').pop(), params_b: paramsB(null, ref), context: null,
    license: detectLicense(licText, {}, 'ollama'), source: src,
  };
}

const wire = (m) => Object.fromEntries(Object.entries(m).filter(([k]) => !k.startsWith('_')));
const modelsKey = (models) => JSON.stringify(models.map((m) => [m.model_id, m.digest, m.kind, m.runtime]).sort());

// ---------------------------------------------------------------------------------------------
// Pricing (only sent when the seller sets one; otherwise the gateway applies the market price)
// ---------------------------------------------------------------------------------------------

function priceFor(kind, opts) {
  const micro = (usd) => Math.round(parseFloat(usd) * 1e6);
  if (kind === 'decision') return opts['price-call'] != null ? { per_call: micro(opts['price-call']) } : undefined;
  if (kind === 'embedding') return opts['price-in'] != null ? { in_per_m: micro(opts['price-in']) } : undefined;
  if (opts['price-out'] == null && opts['price-in'] == null) return undefined;
  const out = micro(opts['price-out'] ?? opts['price-in'] * 4);
  return { in_per_m: opts['price-in'] != null ? micro(opts['price-in']) : Math.round(out / 4), out_per_m: out };
}

// ---------------------------------------------------------------------------------------------
// Terminal UI: a live dashboard on a TTY, timestamped log lines otherwise
// ---------------------------------------------------------------------------------------------

const ui = {
  tty: false,
  color: false,
  active: false, // dashboard is on the alternate screen
  frame: '',
  timer: null,
};

const st = {
  startedAt: Date.now(),
  conn: 'starting', // starting | connecting | online | offline
  retryAt: 0,
  gatewayHost: '',
  node: null,
  nodeId: null,
  trusted: false,
  cheat: null,
  models: [],
  runtimes: [],
  listings: new Map(), // model_id -> {listing_id, status, reason, price}
  perModel: new Map(), // model_id -> {jobs, verification:{state, passed, failed}}
  connectedOnce: false,
  earned: 0,
  shownEarned: 0,
  lastStatsAt: 0,
  doneTimes: [], // completion times of recent jobs, for the jobs/min sparkline
  earnedFlashUntil: 0,
  requests: 0,
  tokensOut: 0,
  verification: null,
  activeJobs: new Map(), // job_id -> {model_id, kind, started, tokens}
  activity: [], // newest first: {ts, icon, color, text, earned?, job?}
  paused: false,
  draining: false,
  drainDeadline: 0,
};

const SGR = (code) => (s) => (ui.color ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const bold = SGR('1');
const dim = SGR('2');
const red = SGR('31');
const green = SGR('32');
const yellow = SGR('33');
const cyan = SGR('36');
const inverse = SGR('7');
const accent = (s) => (!ui.color ? String(s)
  : /truecolor|24bit/.test(process.env.COLORTERM ?? '') ? `\x1b[38;2;167;139;250m${s}\x1b[0m` : `\x1b[38;5;141m${s}\x1b[0m`);
const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;
const visible = (s) => s.replace(ANSI_RE, '').length;
const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';

function fit(text, width) {
  const s = String(text ?? '');
  return s.length > width ? s.slice(0, Math.max(0, width - 1)) + '…' : s.padEnd(width);
}

function fmtUsd(micro) {
  const usd = (micro ?? 0) / 1e6;
  return usd >= 1 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(6)}`;
}

function fmtPriceUsd(micro) {
  const usd = micro / 1e6;
  return `$${usd >= 0.01 ? usd.toFixed(2) : Number(usd.toPrecision(2))}`;
}

function fmtPrice(p, kind) {
  if (!p) return 'market';
  if (p.per_call != null) return `${fmtPriceUsd(p.per_call)}/call`;
  if (kind === 'embedding' || p.out_per_m == null) return `${fmtPriceUsd(p.in_per_m)}/M in`;
  return `${fmtPriceUsd(p.out_per_m)}/M out`;
}

const fmtNum = (n) => Number(n ?? 0).toLocaleString('en-US');
const clock = (ts = Date.now()) => new Date(ts).toTimeString().slice(0, 8);
function fmtDur(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// Log an event: shown in the dashboard's activity list, or printed as a line in plain mode.
function log(text, { icon = '·', color = dim, job, earned } = {}) {
  const entry = { ts: Date.now(), icon, color, text, job, ...(earned !== undefined && { earned }) };
  st.activity.unshift(entry);
  st.activity.length = Math.min(st.activity.length, 60);
  if (!ui.active) process.stdout.write(`${dim(clock(entry.ts))}  ${color(icon)} ${text}\n`);
  return entry;
}

const LICENSE_NAMES = {
  'qwen-research': 'Qwen RESEARCH license (non-commercial)', 'CC-BY-NC-4.0': 'CC BY-NC (non-commercial)',
  'CC-BY-NC-SA-4.0': 'CC BY-NC-SA (non-commercial)', 'MNPL-0.1': 'Mistral non-production license', 'MRL-0.1': 'Mistral research license',
};
const REJECT_REASONS = { digest_mismatch: "weights don't match the public model", namespace: 'private models must be named <your-handle>/<name>',
  invalid_model_id: 'invalid model name' };

// The gateway answers each listing as live, or rejected with the policy as its reason.
function listingStatus(l) {
  if (!l) return null;
  if (l.paused) return 'paused';
  if (l.policy) return l.policy;
  if (l.status === 'live') return 'live';
  const r = String(l.reason ?? '');
  if (r.startsWith('blocked:') || r === 'needs_attestation') return r;
  if (/uncensor|abliterat|heretic|policy/i.test(r)) return 'blocked:policy';
  return 'rejected';
}

function statusReason(model, l, status) {
  if (status === 'blocked:license') return LICENSE_NAMES[model.license?.id] ?? model.license?.id ?? '';
  const r = String(l?.reason ?? '');
  if (!r || r === status) return '';
  return REJECT_REASONS[r] ?? r;
}

function policyCell(model) {
  const l = st.listings.get(model.model_id);
  if (!l) return st.conn === 'online' ? [dim('waiting for gateway…'), ''] : [dim('not connected'), ''];
  const status = listingStatus(l);
  const why = statusReason(model, l, status);
  const reason = why ? ` — ${why}` : '';
  if (status === 'live') return [green('● live'), ''];
  if (status === 'paused') return [yellow('❚❚ paused'), dim(' in the web')];
  if (status === 'needs_attestation') return [yellow('◐ needs your OK in the web'), ''];
  if (status.startsWith('blocked:')) return [red(`✕ blocked: ${status.slice(8)}`), reason];
  return [red('✕ rejected'), reason];
}

function checksCell(model) {
  const v = st.perModel.get(model.model_id)?.verification;
  const l = st.listings.get(model.model_id);
  if (listingStatus(l) !== 'live') return dim('—');
  if (st.trusted) return cyan('◆ reference');
  if (!v) return dim('—');
  const n = (v.passed ?? 0) + (v.failed ?? 0);
  if (v.state === 'flagged') return red(`⚑ flagged ${v.failed}✕`);
  if (v.state === 'verified') return green(`✓ ${v.passed}/${n}`);
  if (v.state === 'consistent') return cyan(`≈ ${v.passed}/${n}`);
  return dim(`new ${n}/3`);
}

function verificationTile() {
  if (st.trusted) return cyan('◆ reference node');
  const v = st.verification;
  if (!v) return dim('—');
  if (v.state === 'flagged') return red(`⚑ flagged · ${v.failed} failed`);
  if (v.state === 'verified') return green(`✓ verified · ${v.passed} passed`);
  if (v.state === 'consistent') return cyan(`≈ consistent · ${v.passed} passed`);
  return `${v.state ?? 'new'} · ${v.passed ?? 0} passed`;
}

function renderDashboard() {
  const W = Math.max(60, Math.min(process.stdout.columns || 100, 140));
  const H = Math.max(20, process.stdout.rows || 30);
  const now = Date.now();
  const spin = SPIN[Math.floor(now / 90) % SPIN.length];
  const lines = [];
  const row = (left, right = '') => {
    const gap = W - visible(left) - visible(right);
    lines.push(gap >= 1 ? left + ' '.repeat(gap) + right : left);
  };

  // Header
  const conn = st.draining ? yellow('◌ stopping')
    : st.conn === 'online' ? green('● online')
      : st.conn === 'offline' ? red(`○ offline · retry in ${Math.max(0, Math.ceil((st.retryAt - now) / 1000))}s`)
        : yellow(`${spin} connecting`);
  row(` ${accent(bold('☾ moonlight'))}  ${dim(`seller agent ${VERSION}`)}`, `${conn}  ${dim(st.gatewayHost)} `);
  const n = st.node;
  row(` ${n.name}${dim(` · ${n.gpu || n.cpu} · ${n.ram_gb} GB · ${n.os} ${n.arch}`)}`,
    dim(`${st.nodeId ? `node ${st.nodeId} · ` : ''}up ${fmtDur(now - st.startedAt)} `));
  if (st.trusted) row(` ${inverse(cyan(' REFERENCE NODE '))} ${dim('operator-run; answers verification replays')}`);
  if (st.cheat) row(` ${inverse(red(' DEMO: CHEAT MODE '))} ${red(`advertises ${st.cheat.advertised.join(', ')} but serves ${st.cheat.serve}`)}`);
  lines.push('');

  // Stat tiles
  if (st.shownEarned < st.earned) st.shownEarned = Math.min(st.earned, st.shownEarned + Math.max(1, (st.earned - st.shownEarned) * 0.18));
  const flash = now < st.earnedFlashUntil;
  const tiles = [
    ['EARNED', (flash ? green : accent)(bold(fmtUsd(Math.round(st.shownEarned)))) + (flash ? green(' ▲') : '')],
    ['REQUESTS', bold(fmtNum(st.requests))],
    ['TOKENS OUT', bold(fmtNum(st.tokensOut))],
    ['VERIFICATION', verificationTile()],
  ];
  const tw = Math.floor((W - 2) / 4);
  lines.push(' ' + tiles.map(([label]) => dim(fit(label, tw))).join(''));
  lines.push(' ' + tiles.map(([, val]) => val + ' '.repeat(Math.max(1, tw - visible(val)))).join(''));
  lines.push('');

  // Models table
  const listable = st.models.filter((m) => listingStatus(st.listings.get(m.model_id)) === 'live').length;
  row(` ${bold('MODELS')}  ${dim(`found ${st.models.length} on this computer${st.listings.size ? ` · ${listable} live` : ''}`)}`);
  const cols = [
    { key: 'model', title: 'MODEL', min: 16, max: 34, prio: 1 },
    { key: 'runtime', title: 'RUNTIME', w: 11, prio: 6 },
    { key: 'kind', title: 'KIND', w: 10, prio: 2 },
    { key: 'size', title: 'SIZE', w: 12, prio: 5 },
    { key: 'price', title: 'PRICE', w: 13, prio: 4 },
    { key: 'status', title: 'STATUS', min: 16, max: 60, prio: 1 },
    { key: 'checks', title: 'CHECKS', w: 12, prio: 2 },
    { key: 'jobs', title: 'JOBS', w: 5, prio: 3 },
  ];
  let shown = cols.slice();
  const fixed = (cs) => cs.reduce((s, c) => s + (c.w ?? c.min) + 1, 3);
  while (fixed(shown) > W && shown.some((c) => c.prio > 1)) {
    const drop = shown.reduce((a, c) => (c.prio > a.prio ? c : a));
    shown = shown.filter((c) => c !== drop);
  }
  let spare = W - fixed(shown);
  for (const c of shown.filter((c) => c.min)) {
    const add = Math.min(spare, c.max - c.min);
    c.width = c.min + add;
    spare -= add;
  }
  for (const c of shown) c.width ??= c.w;
  lines.push('   ' + dim(shown.map((c) => fit(c.title, c.width)).join(' ')));
  const activeModels = new Set([...st.activeJobs.values()].map((j) => j.model_id));
  const maxModelRows = Math.max(3, H - 22);
  for (const m of st.models.slice(0, maxModelRows)) {
    const [status, reason] = policyCell(m);
    const cells = {
      model: (st.cheat?.advertised.includes(m.model_id) ? red : bold)(fit(m.model_id, shown.find((c) => c.key === 'model').width)),
      runtime: dim(RUNTIME_LABEL[m.runtime] ?? m.runtime),
      kind: m.kind,
      size: dim([m.params_b != null ? (m.params_b < 1 ? `${Math.round(m.params_b * 1000)}M` : `${m.params_b}B`) : '', m.quant ?? ''].join(' ').trim() || '—'),
      price: !['live', 'paused', 'needs_attestation', null].includes(listingStatus(st.listings.get(m.model_id))) ? dim('—')
        : fmtPrice(st.listings.get(m.model_id)?.price ?? m.price, m.kind),
      status: status + dim(reason),
      checks: checksCell(m),
      jobs: String(st.perModel.get(m.model_id)?.jobs ?? 0),
    };
    const marker = activeModels.has(m.model_id) ? accent(spin) : ' ';
    lines.push(` ${marker} ` + shown.map((c) => {
      const v = cells[c.key];
      const len = visible(v);
      return len > c.width ? fit(v.replace(ANSI_RE, ''), c.width) : v + ' '.repeat(c.width - len);
    }).join(' '));
  }
  if (st.models.length > maxModelRows) lines.push(dim(`   …and ${st.models.length - maxModelRows} more`));
  if (!st.models.length) lines.push(dim('   No models found yet. Start Ollama (ollama serve) or another local runtime; rescanning every minute.'));
  lines.push('');

  // Jobs in flight
  if (st.activeJobs.size) {
    row(` ${bold('NOW')}`);
    for (const j of [...st.activeJobs.values()].slice(0, 4)) {
      const secs = ((now - j.started) / 1000).toFixed(1);
      const what = j.kind === 'chat' ? `streaming · ${fmtNum(j.tokens)} tok` : j.kind === 'embedding' ? 'embedding' : 'deciding';
      lines.push(`   ${accent(spin)} ${bold(fit(j.model_id, 28))} ${dim(`${what} · ${secs}s`)}`);
    }
    lines.push('');
  }

  // Activity, with a jobs-per-minute sparkline over the last 10 minutes
  const buckets = Array(20).fill(0);
  for (const t of st.doneTimes) {
    const i = 19 - Math.floor((now - t) / 30_000);
    if (i >= 0) buckets[i]++;
  }
  const peak = Math.max(1, ...buckets);
  const spark = buckets.map((b) => (b ? '▁▂▃▄▅▆▇█'[Math.min(7, Math.floor((b / peak) * 7.99))] : ' ')).join('');
  const perMin = st.doneTimes.filter((t) => now - t < 60_000).length;
  row(` ${bold('ACTIVITY')}`, `${accent(spark)} ${dim(`${perMin} job${perMin === 1 ? '' : 's'}/min `)}`);
  const footerRows = 2;
  const room = Math.max(1, H - lines.length - footerRows);
  for (const a of st.activity.slice(0, room)) {
    const earned = a.earned ? green(`  +${fmtUsd(a.earned)}`) : '';
    lines.push(`   ${dim(clock(a.ts))}  ${a.color(a.icon)} ${a.text}${earned}`);
  }
  while (lines.length < H - 1) lines.push('');

  // Footer
  if (st.draining) {
    const left = Math.max(0, Math.ceil((st.drainDeadline - now) / 1000));
    const n = st.activeJobs.size;
    row(` ${yellow(`${spin} Finishing ${n} job${n === 1 ? '' : 's'} before stopping… (${left}s)`)}`, dim('Ctrl-C again to quit now '));
  } else if (st.paused) {
    row(` ${inverse(yellow(' ❚❚ PAUSED '))} ${yellow('not taking new jobs')}`, dim('p resume · w web dashboard · q stop '));
  } else {
    row(` ${dim('p pause · w web dashboard · q stop')}`, dim(`${st.activeJobs.size} in flight · max ${st.node.max_concurrency} `));
  }

  return lines.slice(0, H).map((l) => {
    if (visible(l) <= W) return l + '\x1b[K';
    return fit(l.replace(ANSI_RE, ''), W) + '\x1b[K';
  }).join('\n');
}

function startDashboard() {
  if (!ui.tty) return;
  ui.active = true;
  process.stdout.write('\x1b[?1049h\x1b[?25l\x1b[2J');
  const draw = () => {
    const frame = renderDashboard();
    if (frame === ui.frame) return;
    ui.frame = frame;
    process.stdout.write(`\x1b[?2026h\x1b[H${frame}\x1b[J\x1b[?2026l`);
  };
  ui.timer = setInterval(draw, 90);
  process.stdout.on('resize', () => { ui.frame = ''; process.stdout.write('\x1b[2J'); draw(); });
  draw();
}

function restoreTerminal() {
  if (ui.timer) clearInterval(ui.timer);
  ui.timer = null;
  if (ui.active) {
    ui.active = false;
    process.stdout.write('\x1b[?25h\x1b[?1049l');
  }
  if (process.stdin.isTTY && process.stdin.isRaw) {
    try { process.stdin.setRawMode(false); } catch {}
  }
}

function printModelTable(models, runtimes) {
  const where = runtimes.map((r) => `${RUNTIME_LABEL[r.runtime] ?? r.runtime} (${r.count}${r.device ? `, ${r.device}` : ''})`);
  const total = runtimes.reduce((s, r) => s + r.count, 0);
  const what = total > models.length ? `Listing ${bold(models.length)} of ${total} models found on this computer`
    : `Found ${bold(models.length)} model${models.length === 1 ? '' : 's'} on this computer`;
  process.stdout.write(`\n  ${accent(bold('☾ moonlight'))}  ${what}`
    + (where.length ? dim(` via ${where.join(', ')}`) : '') + '\n\n');
  for (const m of models) {
    const size = m.params_b != null ? (m.params_b < 1 ? `${Math.round(m.params_b * 1000)}M` : `${m.params_b}B`) : '';
    process.stdout.write(`    ${bold(fit(m.model_id, 40))} ${fit(m.kind, 10)} ${dim(fit(`${size} ${m.quant ?? ''}`.trim(), 14))} `
      + `${dim(fit(RUNTIME_LABEL[m.runtime] ?? m.runtime, 12))} ${m.license.id === 'unknown' ? yellow('license unknown') : dim(m.license.id)}\n`);
  }
  if (!models.length) {
    process.stdout.write(`    ${dim('Nothing found. Install Ollama (https://ollama.com) and run: ollama pull qwen2.5:7b')}\n`);
  }
  process.stdout.write('\n');
}

// ---------------------------------------------------------------------------------------------
// Pairing (device flow): show a code, the seller approves it in the browser, we get a node token
// ---------------------------------------------------------------------------------------------

async function pair(base, node, { noBrowser }) {
  let start;
  try {
    start = await getJSON(`${base}/api/devices/pair`, { body: { node }, timeout: 15_000 });
  } catch (e) {
    die(`Could not reach ${base} to pair this computer (${e.message}).`);
  }
  const { pair_code: code, verify_url: url, poll_token: pollToken } = start;
  const expires = start.expires_at ?? Date.now() + 10 * 60_000;
  const out = process.stdout;
  out.write(`\n  ${accent(bold('☾ moonlight'))}  Add this computer to your Moonlight account\n\n`);
  out.write(`  ${dim('┌' + '─'.repeat(code.length + 8) + '┐')}\n`);
  out.write(`  ${dim('│')}    ${bold(accent(code))}    ${dim('│')}\n`);
  out.write(`  ${dim('└' + '─'.repeat(code.length + 8) + '┘')}\n\n`);
  const opened = !noBrowser && openBrowser(url);
  out.write(opened ? `  Opened ${cyan(url)} in your browser.\n  Sign in, check the code matches, and approve ${bold(node.name)}.\n\n`
    : `  Open ${cyan(url)}\n  sign in, check the code matches, and approve ${bold(node.name)}.\n\n`);

  let i = 0;
  const spinner = ui.tty ? setInterval(() => out.write(`\r  ${accent(SPIN[i++ % SPIN.length])} Waiting for approval…  ${dim(`code expires in ${Math.max(0, Math.round((expires - Date.now()) / 60000))} min`)}\x1b[K`), 100) : null;
  if (!ui.tty) out.write('  Waiting for approval…\n');
  const interval = Math.max(1, start.interval ?? 2) * 1000;
  try {
    while (Date.now() < expires) {
      await sleep(interval);
      let r;
      try {
        r = await getJSON(`${base}/api/devices/pair/poll`, { body: { poll_token: pollToken }, timeout: 10_000 });
      } catch (e) {
        if (e.status === 404 || e.status === 410) break;
        if (e.status >= 400 && e.status < 500 && e.status !== 429) die(`Pairing failed: ${e.body || e.message}`);
        continue; // network blip or server restart: keep polling
      }
      if (r.status === 'approved' && r.node_token) {
        if (spinner) out.write(`\r  ${green('✓')} Approved. This computer is now part of your account.\x1b[K\n\n`);
        else out.write('  Approved.\n');
        return r;
      }
      if (r.status === 'expired' || r.status === 'denied') break;
    }
  } finally {
    if (spinner) clearInterval(spinner);
  }
  die('The pairing code expired before it was approved. Run `moonlight` again for a new code.');
}

// ---------------------------------------------------------------------------------------------
// Gateway connection
// ---------------------------------------------------------------------------------------------

const conn = {
  ws: null,
  attempt: 0,
  lastFrame: 0,
  reconnectTimer: null,
  stopping: false,
};
let ctx; // runtime settings for the agent loop, set in runAgent()

function send(msg) {
  const ws = conn.ws;
  if (!ws || ws.readyState !== 1) return false;
  ws.send(JSON.stringify(msg));
  return true;
}

function helloMessage() {
  return {
    t: 'hello',
    token: ctx.token,
    agent_version: VERSION,
    ...(ctx.trusted && { trusted: true }),
    node: st.node,
    models: st.models.map(wire),
  };
}

function connect() {
  clearTimeout(conn.reconnectTimer);
  st.conn = 'connecting';
  let ws;
  try {
    ws = new WebSocket(ctx.gateway);
  } catch (e) {
    log(`Bad gateway URL ${ctx.gateway}: ${e.message}`, { icon: '✕', color: red });
    return scheduleReconnect();
  }
  conn.ws = ws;
  ws.onopen = () => {
    if (conn.ws !== ws) return;
    conn.lastFrame = Date.now();
    send(helloMessage());
  };
  ws.onmessage = (ev) => {
    if (conn.ws !== ws) return;
    conn.lastFrame = Date.now();
    let msg;
    try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8')); } catch { return; }
    onGatewayMessage(msg);
  };
  ws.onerror = () => {}; // a close event always follows
  ws.onclose = (ev) => {
    if (conn.ws !== ws) return;
    conn.ws = null;
    onDisconnect(ev.code, ev.reason);
  };
}

function dropConnection() {
  const ws = conn.ws;
  conn.ws = null;
  try { ws?.close(); } catch {}
  if (ws) onDisconnect(1006, 'connection went quiet');
}

function onDisconnect(code, reason) {
  const wasOnline = st.conn === 'online';
  st.conn = 'offline';
  // The gateway re-routes our in-flight jobs when we drop, so stop working on them.
  for (const job of st.activeJobs.values()) job.ac.abort(new Error('disconnected'));
  if (conn.stopping) return;
  if ([4001, 4003, 4401, 4403].includes(code)) return authFailed(reason || `closed with ${code}`);
  if (code === 4000) {
    conn.stopping = true;
    die('Another Moonlight agent connected with this computer\'s token, so this one stopped. Run only one agent per computer.');
  }
  if (wasOnline) log(`Connection lost${reason ? ` (${reason})` : ''}. Reconnecting…`, { icon: '○', color: yellow });
  scheduleReconnect();
}

function scheduleReconnect() {
  const delay = Math.min(15_000, 1000 * 2 ** conn.attempt) * (0.8 + Math.random() * 0.4);
  conn.attempt++;
  st.retryAt = Date.now() + delay;
  clearTimeout(conn.reconnectTimer);
  conn.reconnectTimer = setTimeout(connect, delay);
}

function authFailed(reason) {
  conn.stopping = true;
  restoreTerminal();
  const how = ctx.tokenSource === 'config'
    ? 'Run `moonlight logout`, then `moonlight` to pair this computer again.'
    : 'Check the token you passed.';
  die(`The gateway rejected this computer's token (${reason}). ${how}`);
}

function applyListings(listings = []) {
  for (const l of listings) {
    const before = listingStatus(st.listings.get(l.model_id));
    st.listings.set(l.model_id, l);
    const status = listingStatus(l);
    if (!before || before === status) continue;
    const model = st.models.find((m) => m.model_id === l.model_id);
    const why = model && statusReason(model, l, status);
    log(`${l.model_id}: ${status}${why ? ` (${why})` : ''}`, { icon: status === 'live' ? '●' : '◐', color: status === 'live' ? green : yellow });
  }
}

function applyVerification(model_id, v) {
  if (!v) return;
  const pm = perModel(model_id);
  const before = pm.verification?.state;
  pm.verification = v;
  if (before && before !== v.state) {
    if (v.state === 'flagged') log(`${model_id} flagged by verification; its earnings are held`, { icon: '⚑', color: red });
    else if (v.state === 'verified') log(`${model_id} verified`, { icon: '✓', color: green });
  }
}

function perModel(model_id) {
  if (!st.perModel.has(model_id)) st.perModel.set(model_id, { jobs: 0, verification: null });
  return st.perModel.get(model_id);
}

function onGatewayMessage(msg) {
  switch (msg.t) {
    case 'welcome': {
      // Sent on connect, and again (same shape) as the answer to each t:"models".
      const fresh = st.conn !== 'online';
      const first = !st.connectedOnce;
      st.conn = 'online';
      st.connectedOnce = true;
      conn.attempt = 0;
      st.nodeId = msg.node_id ?? st.nodeId;
      applyListings(msg.listings);
      if (!fresh) break;
      const live = (msg.listings ?? []).filter((l) => listingStatus(l) === 'live').length;
      log(`${first ? 'Connected' : 'Reconnected'} to ${st.gatewayHost} · ${live} of ${st.models.length} model${st.models.length === 1 ? '' : 's'} live`, { icon: '●', color: green });
      if (!ui.active && first) printListings(msg.listings ?? []);
      sendStatus();
      break;
    }
    case 'listings':
      applyListings(msg.listings);
      break;
    case 'job':
      runJob(msg);
      break;
    case 'cancel':
      st.activeJobs.get(msg.job_id)?.ac.abort(new Error('cancelled'));
      break;
    case 'stats': {
      if (typeof msg.earned_microusd === 'number') {
        // Credit the increase to the newest finished job still waiting for its earnings. The first
        // stats after connecting may only carry earlier totals; those set the baseline without a flash.
        const delta = msg.earned_microusd - st.earned;
        const entry = st.activity.find((a) => a.job && a.earned === undefined && a.ts > st.lastStatsAt);
        if (delta > 0 && entry) {
          entry.earned = delta;
          st.earnedFlashUntil = Date.now() + 1500;
        } else if (!st.lastStatsAt) {
          st.shownEarned = msg.earned_microusd;
        }
        st.earned = msg.earned_microusd;
        st.lastStatsAt = Date.now();
      }
      if (typeof msg.requests === 'number') st.requests = msg.requests;
      if (msg.verification) st.verification = msg.verification;
      for (const l of msg.listings ?? []) {
        applyVerification(l.model_id, l.verification ?? l);
        const known = st.listings.get(l.model_id);
        if (known && typeof l.paused === 'boolean') known.paused = l.paused;
      }
      if (msg.model_id && msg.verification) applyVerification(msg.model_id, msg.verification);
      else if (msg.verification && !msg.listings) {
        const live = st.models.filter((m) => listingStatus(st.listings.get(m.model_id)) === 'live');
        if (live.length === 1) applyVerification(live[0].model_id, msg.verification);
      }
      break;
    }
    case 'ping':
      send({ t: 'pong', ts: msg.ts });
      break;
    case 'pong':
      break;
    case 'error':
      if (msg.job_id) break;
      if (['unauthorized', 'bad_token', 'invalid_token', 'revoked'].includes(msg.code)) return authFailed(msg.message || msg.code);
      log(`Gateway: ${msg.message || msg.code}`, { icon: '!', color: yellow });
      break;
    default:
      break;
  }
}

function printListings(listings) {
  for (const l of listings) {
    const status = listingStatus(l);
    const model = st.models.find((m) => m.model_id === l.model_id);
    const why = model ? statusReason(model, l, status) : l.reason;
    const color = status === 'live' ? green : status.startsWith('blocked') || status === 'rejected' ? red : yellow;
    process.stdout.write(`           ${fit(l.model_id, 40)} ${color(status)}${why ? dim(` — ${why}`) : ''}\n`);
  }
}

function sendStatus() {
  send({ t: 'status', paused: st.paused, inflight: st.activeJobs.size });
}

// ---------------------------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------------------------

function deadlineFrom(deadline) {
  if (!deadline) return 10 * 60_000;
  return deadline > 1e12 ? Math.max(1000, deadline - Date.now()) : deadline; // epoch ms or a duration
}

async function runJob(msg) {
  const { job_id, kind, model_id, body } = msg;
  const model = st.models.find((m) => m.model_id === model_id);
  if (!model) return send({ t: 'error', job_id, code: 'model_not_found', message: `${model_id} is not served by this node` });
  if (st.draining) return send({ t: 'error', job_id, code: 'draining', message: 'this node is shutting down' });
  if (st.paused) return send({ t: 'error', job_id, code: 'paused', message: 'this node is paused' });

  const ac = new AbortController();
  const job = { job_id, model_id, kind, ac, started: Date.now(), first: 0, tokens: 0 };
  st.activeJobs.set(job_id, job);
  sendStatus();
  const timer = setTimeout(() => ac.abort(new Error('deadline')), deadlineFrom(msg.deadline_ms));
  try {
    const route = model._route;
    const serveAs = ctx.cheat && ctx.cheat.advertised.includes(model_id) ? ctx.cheat.serve : route.name;
    if (kind === 'chat') await serveChat(job, route.base, serveAs, body);
    else if (kind === 'embedding') await serveEmbedding(job, route.base, serveAs, body);
    else if (kind === 'decision') await serveDecision(job, route.base, route.name, body);
    else throw Object.assign(new Error(`unknown job kind ${kind}`), { code: 'bad_request' });
    perModel(model_id).jobs++;
  } catch (e) {
    const reason = ac.signal.reason?.message;
    if (reason === 'disconnected') return; // the gateway already re-routed this job
    const code = reason === 'cancelled' ? 'cancelled' : reason === 'deadline' ? 'timeout' : e.code ?? 'runtime_error';
    send({ t: 'error', job_id, code, message: String(e.message || e).slice(0, 500) });
    if (code !== 'cancelled') log(`${model_id} ${kind} failed: ${String(e.message || e).slice(0, 120)}`, { icon: '✕', color: red });
  } finally {
    clearTimeout(timer);
    st.activeJobs.delete(job_id);
    sendStatus();
  }
}

async function callRuntime(job, url, payload) {
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: job.ac.signal });
  } catch (e) {
    if (job.ac.signal.aborted) throw e;
    throw Object.assign(new Error(`local runtime unreachable at ${new URL(url).origin}`), { code: 'runtime_unavailable' });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw Object.assign(new Error(`runtime answered ${res.status}: ${text.slice(0, 300)}`), { code: res.status === 422 || res.status === 400 ? 'bad_request' : 'runtime_error' });
  }
  return res;
}

function finishJob(job, usage, result) {
  const now = Date.now();
  send({ t: 'done', job_id: job.job_id, usage, ...(result && { result }),
    timing: { first_ms: (job.first || now) - job.started, total_ms: now - job.started } });
  st.tokensOut += usage.output_tokens;
  const secs = ((now - job.started) / 1000).toFixed(1);
  const what = job.kind === 'chat' ? `${fmtNum(usage.output_tokens)} tok` : job.kind === 'embedding' ? `${fmtNum(usage.input_tokens)} tok in`
    : `${Object.keys(result?.answers ?? {}).length} answer${Object.keys(result?.answers ?? {}).length === 1 ? '' : 's'}`;
  st.doneTimes.push(now);
  if (st.doneTimes.length > 500) st.doneTimes.splice(0, 100);
  log(`${bold(job.model_id)}  ${dim(`${job.kind} · ${what} · ${secs}s`)}`, { icon: '✓', color: green, job: job.job_id });
}

async function serveChat(job, base, runtimeModel, body) {
  const payload = { ...body, model: runtimeModel, stream: true, stream_options: { include_usage: true } };
  const res = await callRuntime(job, `${base}/v1/chat/completions`, payload);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let usage = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      let chunk;
      try { chunk = JSON.parse(data); } catch { continue; }
      if (chunk.error) throw Object.assign(new Error(chunk.error.message ?? JSON.stringify(chunk.error)), { code: 'runtime_error' });
      if (chunk.model) chunk.model = job.model_id;
      const delta = chunk.choices?.[0]?.delta;
      if (delta && (delta.content || delta.reasoning || delta.reasoning_content || delta.tool_calls)) {
        job.first ||= Date.now();
        job.tokens++;
      }
      if (chunk.usage) usage = chunk.usage;
      send({ t: 'chunk', job_id: job.job_id, data: chunk });
    }
  }
  finishJob(job, { input_tokens: usage?.prompt_tokens ?? 0, output_tokens: usage?.completion_tokens ?? job.tokens });
}

async function serveEmbedding(job, base, runtimeModel, body) {
  const res = await callRuntime(job, `${base}/v1/embeddings`, { ...body, model: runtimeModel });
  const result = await res.json();
  job.first = Date.now();
  result.model = job.model_id;
  finishJob(job, { input_tokens: result.usage?.prompt_tokens ?? result.usage?.total_tokens ?? 0, output_tokens: 0 }, result);
}

async function serveDecision(job, base, runtimeModel, body) {
  const res = await callRuntime(job, `${base}/v1/systemone`, { ...body, model: runtimeModel });
  const result = await res.json();
  job.first = Date.now();
  result.model = job.model_id;
  finishJob(job, { input_tokens: result.usage?.input_tokens ?? 0, output_tokens: 0 }, result);
}

// ---------------------------------------------------------------------------------------------
// Lifecycle: rescans, keyboard, graceful drain
// ---------------------------------------------------------------------------------------------

async function rescan() {
  const { models, runtimes } = await discoverFor(ctx);
  if (modelsKey(models) === modelsKey(st.models)) return;
  const before = new Set(st.models.map((m) => m.model_id));
  const after = new Set(models.map((m) => m.model_id));
  for (const m of models) if (!before.has(m.model_id)) log(`Found ${bold(m.model_id)} (${m.kind}, ${RUNTIME_LABEL[m.runtime] ?? m.runtime})`, { icon: '+', color: cyan });
  for (const id of before) if (!after.has(id)) log(`${id} is gone from this computer`, { icon: '−', color: yellow });
  st.models = models;
  st.runtimes = runtimes;
  send({ t: 'models', models: models.map(wire) });
}

// Discovery plus the operator/demo adjustments: --models filter, prices, --cheat-serve listings.
async function discoverFor(c) {
  const { models, runtimes } = await discover(c);
  let list = models;
  if (c.only) {
    list = c.only.map((id) => models.find((m) => m.model_id === id || m._route?.name === id)).filter(Boolean);
    if (c.cheat) {
      for (const id of c.cheat.advertised) {
        if (list.some((m) => m.model_id === id.replace(/:latest$/, ''))) continue;
        const entry = c.registryCache.get(id) ?? await registryEntry(id);
        c.registryCache.set(id, entry);
        const serve = models.find((m) => m.model_id === c.cheat.serve.replace(/:latest$/, ''));
        list.push({ ...entry, _route: { base: c.ollama, name: serve?._route.name ?? c.cheat.serve } });
      }
    }
  }
  for (const m of list) {
    const price = priceFor(m.kind, c.opts);
    if (price) m.price = price;
  }
  return { models: list, runtimes };
}

function setupKeys() {
  if (!ui.tty || !process.stdin.isTTY) return;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (key) => {
    if (key === '\u0003' || key === 'q' || key === 'Q') return stopGracefully();
    if (key === 'p' || key === 'P') {
      if (st.draining) return;
      st.paused = !st.paused;
      sendStatus();
      log(st.paused ? 'Paused: not taking new jobs' : 'Resumed: taking jobs again', { icon: st.paused ? '❚❚' : '▶', color: yellow });
    }
    if (key === 'w' || key === 'W') openBrowser(`${httpBase(ctx.gateway)}/me/sell`);
  });
}

async function stopGracefully() {
  if (conn.stopping) return exitNow(130);
  conn.stopping = true;
  clearTimeout(conn.reconnectTimer);
  if (st.conn !== 'online') return exitNow(0);
  send({ t: 'drain' });
  st.draining = true;
  st.drainDeadline = Date.now() + DRAIN_MS;
  const n = st.activeJobs.size;
  log(n ? `Finishing ${n} job${n === 1 ? '' : 's'} before stopping…` : 'Stopping…', { icon: '◌', color: yellow });
  while (st.activeJobs.size && Date.now() < st.drainDeadline) await sleep(100);
  for (const job of st.activeJobs.values()) job.ac.abort(new Error('deadline'));
  await sleep(150); // let the last frames flush
  try { conn.ws?.close(1000, 'drained'); } catch {}
  exitNow(0);
}

function exitNow(code) {
  restoreTerminal();
  try { if (Number(fs.readFileSync(PID_FILE, 'utf8')) === process.pid) fs.unlinkSync(PID_FILE); } catch {}
  if (st.node) {
    process.stdout.write(`${accent('☾')} Moonlight agent stopped. Served ${fmtNum(st.requests)} request${st.requests === 1 ? '' : 's'}`
      + (st.earned ? `, ${fmtUsd(st.earned)} earned in total` : '') + '.\n');
  }
  process.exit(code);
}

// ---------------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------------

async function runAgent(opts) {
  const gateway = opts.gateway || process.env.MOONLIGHT_GATEWAY || DEFAULT_GATEWAY;
  const base = httpBase(gateway);
  ui.tty = !!process.stdout.isTTY && !opts.plain;
  ui.color = !!process.stdout.isTTY && !process.env.NO_COLOR;

  fs.mkdirSync(HOME, { recursive: true, mode: 0o700 });
  try {
    const pid = Number(fs.readFileSync(PID_FILE, 'utf8'));
    if (pid && pid !== process.pid && processAlive(pid)) die(`Another Moonlight agent is already running (pid ${pid}). Stop it with \`moonlight stop\`.`);
  } catch {}
  fs.writeFileSync(PID_FILE, String(process.pid));
  try { fs.unlinkSync(STOP_FILE); } catch {}

  if (opts['cheat-serve'] && !opts.models) die('--cheat-serve needs --models <the model(s) to advertise>.');
  ctx = {
    gateway,
    token: null,
    tokenSource: null,
    trusted: !!opts.trusted,
    opts,
    ollama: ollamaBase(opts.ollama),
    laya: (opts.laya || 'http://127.0.0.1:8765').replace(/\/+$/, ''),
    endpoints: opts.endpoint,
    only: opts.models ? opts.models.split(',').map((s) => s.trim()).filter(Boolean) : null,
    cheat: opts['cheat-serve'] ? { serve: opts['cheat-serve'], advertised: opts.models.split(',').map((s) => s.trim().replace(/:latest$/, '')) } : null,
    registryCache: new Map(),
  };
  st.trusted = ctx.trusted;
  st.cheat = ctx.cheat;
  st.gatewayHost = new URL(base).host;

  const [node, found] = await Promise.all([machineInfo(opts.name), discoverFor(ctx).catch((e) => die(e.message))]);
  node.max_concurrency = defaultConcurrency(opts.concurrency);
  st.node = node;
  st.models = found.models;
  st.runtimes = found.runtimes;
  printModelTable(st.models, st.runtimes);

  const cfg = loadConfig();
  if (opts.token) { ctx.token = opts.token; ctx.tokenSource = 'flag'; }
  else if (process.env.MOONLIGHT_TOKEN) { ctx.token = process.env.MOONLIGHT_TOKEN; ctx.tokenSource = 'env'; }
  else if (cfg.tokens?.[base]) { ctx.token = cfg.tokens[base]; ctx.tokenSource = 'config'; }
  else {
    const r = await pair(base, node, { noBrowser: opts['no-browser'] });
    const fresh = loadConfig();
    fresh.tokens = { ...fresh.tokens, [base]: r.node_token };
    saveConfig(fresh);
    process.stdout.write(`  ${dim(`Saved this computer's token to ${CONFIG_FILE}`)}\n\n`);
    ctx.token = r.node_token;
    ctx.tokenSource = 'config';
    if (r.node_id) st.nodeId = r.node_id;
  }

  setupKeys();
  process.on('SIGINT', () => stopGracefully());
  process.on('SIGTERM', () => stopGracefully());
  process.on('uncaughtException', (e) => { restoreTerminal(); process.stderr.write(`moonlight crashed: ${e.stack || e}\n`); process.exit(1); });
  startDashboard();
  connect();

  setInterval(() => {
    if (st.conn === 'online') send({ t: 'ping', ts: Date.now() });
    if (conn.ws && Date.now() - conn.lastFrame > STALE_MS) dropConnection();
  }, PING_MS);
  setInterval(() => rescan().catch(() => {}), RESCAN_MS);
  let lastTick = Date.now();
  setInterval(() => {
    // A long gap between ticks means the computer slept; the socket is probably dead, so reconnect now.
    if (Date.now() - lastTick > 10_000 && conn.ws && !conn.stopping) {
      log('Woke from sleep. Reconnecting…', { icon: '○', color: yellow });
      dropConnection();
    }
    lastTick = Date.now();
    if (fs.existsSync(STOP_FILE)) {
      try { fs.unlinkSync(STOP_FILE); } catch {}
      stopGracefully();
    }
  }, 1000);
}

async function scanCommand(opts) {
  ui.color = !!process.stdout.isTTY && !process.env.NO_COLOR;
  const c = { ollama: ollamaBase(opts.ollama), laya: (opts.laya || 'http://127.0.0.1:8765').replace(/\/+$/, ''), endpoints: opts.endpoint };
  const [node, { models, runtimes }] = await Promise.all([machineInfo(opts.name), discover(c)]);
  if (opts.json) {
    process.stdout.write(JSON.stringify({ node, models: models.map(wire) }, null, 2) + '\n');
    return;
  }
  process.stdout.write(`\n  ${bold(node.name)}${dim(` · ${node.cpu} · ${node.ram_gb} GB RAM${node.gpu ? ` · ${node.gpu}` : ''}${node.vram_gb && node.gpu ? ` (${node.vram_gb} GB)` : ''}`)}\n`);
  printModelTable(models, runtimes);
}

function logoutCommand(opts) {
  const base = httpBase(opts.gateway || process.env.MOONLIGHT_GATEWAY || DEFAULT_GATEWAY);
  const cfg = loadConfig();
  if (!cfg.tokens?.[base]) {
    process.stdout.write(`No saved token for ${base}. Nothing to forget.\n`);
    return;
  }
  delete cfg.tokens[base];
  saveConfig(cfg);
  process.stdout.write(`Forgot this computer's token for ${base}.\nRemove the computer from your account at ${base}/me/sell, and run \`moonlight\` to pair it again.\n`);
}

function stopCommand() {
  let pid = 0;
  try { pid = Number(fs.readFileSync(PID_FILE, 'utf8')); } catch {}
  if (!pid || !processAlive(pid)) {
    process.stdout.write('No Moonlight agent is running.\n');
    return;
  }
  fs.writeFileSync(STOP_FILE, String(Date.now()));
  process.stdout.write(`Asked the agent (pid ${pid}) to stop. It finishes its in-flight jobs first (up to 30 s).\n`);
}

async function layaInstallCommand() {
  ui.color = !!process.stdout.isTTY && !process.env.NO_COLOR;
  const uv = await run('uv', ['--version']);
  if (!uv) {
    const how = process.platform === 'win32'
      ? 'powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"'
      : 'curl -LsSf https://astral.sh/uv/install.sh | sh';
    die(`laya-runner is a Python app installed with uv, which isn't on this computer.\nInstall uv first:\n  ${how}\nthen run \`moonlight laya install\` again.`);
  }
  const spec = 'git+https://github.com/shinhajun/moonlight#subdirectory=laya-runner';
  process.stdout.write(`Installing laya-runner with ${uv}…\n`);
  const code = await new Promise((resolve) => {
    const child = spawn('uv', ['tool', 'install', '--force', '--python', '3.12', spec], { stdio: 'inherit' });
    child.on('exit', resolve);
    child.on('error', () => resolve(1));
  });
  if (code !== 0) die('uv could not install laya-runner (see the output above).');
  process.stdout.write(`\n${green('✓')} Installed. Start it in its own terminal (first start downloads the 840 MB Laya model):\n\n    laya-runner\n\nThen run \`moonlight\`; it finds the runner on :8765 automatically.\n`);
}

async function main() {
  const { cmd, opts } = parseArgs(process.argv.slice(2));
  if (opts.version) return void process.stdout.write(`moonlight ${VERSION}\n`);
  if (opts.help || cmd[0] === 'help') return void process.stdout.write(HELP + '\n');
  switch (cmd[0]) {
    case undefined:
    case 'run':
    case 'start':
      return runAgent(opts);
    case 'scan':
      return scanCommand(opts);
    case 'logout':
      return logoutCommand(opts);
    case 'stop':
      return stopCommand();
    case 'laya':
      if (cmd[1] === 'install') return layaInstallCommand();
      return die('Usage: moonlight laya install');
    default:
      return die(`Unknown command "${cmd[0]}". See \`moonlight --help\`.`);
  }
}

main().catch((e) => die(e.stack || String(e)));
