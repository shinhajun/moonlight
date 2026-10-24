// Data layer: same-origin JSON API, one shared SSE connection, local sessions, and formatting.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

// ---------------------------------------------------------------- signed-in account (session cookie)

// One shared copy of GET /api/me. `me` is undefined while loading and null when signed out.
let meState = { me: undefined, error: null };
const meListeners = new Set();
let meInflight = null;

export function refreshMe() {
  meInflight ??= api('/api/me')
    .then((me) => (meState = { me, error: null }))
    // Only a 401 means signed out (null); any other failure keeps what we knew, unknown if nothing, with the error.
    .catch((error) => (meState = { me: error.status === 401 ? null : meState.me, error: error.status === 401 ? null : error }))
    .finally(() => {
      meInflight = null;
      meListeners.forEach((fn) => fn());
    });
  return meInflight;
}

export function useMe({ interval } = {}) {
  const snap = useSyncExternalStore(
    (fn) => (meListeners.add(fn), () => meListeners.delete(fn)),
    () => meState,
  );
  useEffect(() => {
    if (meState.me === undefined) refreshMe();
    if (!interval) return;
    const id = setInterval(refreshMe, interval);
    return () => clearInterval(id);
  }, [interval]);
  return snap;
}

export async function signOut() {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  meState = { me: null, error: null };
  meListeners.forEach((fn) => fn());
}

// ---------------------------------------------------------------- HTTP

export class ApiError extends Error {
  constructor(status, message, code, body, retryAfter) {
    super(message);
    this.status = status;
    this.code = code;
    this.body = body;
    this.retryAfter = retryAfter;
  }
}

async function errorFrom(res) {
  const body = await res.json().catch(() => null);
  const e = body?.error;
  const retry = Number(res.headers.get('retry-after'));
  return new ApiError(res.status, e?.message || `Request failed (${res.status})`, e?.code, body, retry > 0 ? retry : null);
}

// Server or network failures read as one plain sentence; client errors keep the server's words.
export function serviceError(err) {
  if (err?.status === 402) return 'Your balance is too low for this request.';
  if (!err?.status || err.status >= 500) return "Couldn't reach a GPU just now. Try again in a moment.";
  return err.message;
}

// What a failed model request says, whether it failed before the stream opened (503/402/429/5xx) or in it.
export function requestError(err, model) {
  if (err?.code === 'no_capacity') {
    const reason = err.reason ?? err.body?.moonlight?.reason;
    return reason === 'busy' ? `Every GPU serving ${model} is busy right now.` : `No GPU is serving ${model} right now.`;
  }
  return err?.status === 429 ? friendly(err) : serviceError(err);
}

// How long a web request waits in line, or for a seller that just dropped (e.g. during a deploy) to reconnect.
export const MAX_WAIT_S = 90;

// Rate limits (429) say what was limited and when to come back; other errors keep the server's words.
export function friendly(err, action) {
  if (err?.status !== 429) return err?.message || 'Something went wrong. Try again.';
  const s = err.retryAfter;
  const when = !s ? 'in a little while' : s >= 90 ? `in about ${Math.ceil(s / 60)} minutes` : `in ${s} seconds`;
  const what = { signup: 'Too many new accounts from your network', login: 'Too many sign-in attempts', pair: 'Too many pairing attempts from your network' }[action] || 'Too many requests';
  return `${what}. Please try again ${when}.`;
}

// ---------------------------------------------------------------- one-off banner under the masthead

let flashState = null;
const flashListeners = new Set();
export function flash(message) {
  flashState = message ? { message, id: Date.now() } : null;
  flashListeners.forEach((fn) => fn());
}
export function useFlash() {
  return useSyncExternalStore(
    (fn) => (flashListeners.add(fn), () => flashListeners.delete(fn)),
    () => flashState,
  );
}

export async function api(path, { method = 'GET', body, signal, raw = false } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal, credentials: 'same-origin' });
  if (!res.ok) throw await errorFrom(res);
  if (raw) return { data: await res.json(), headers: res.headers };
  return res.status === 204 ? null : res.json();
}

// The gateway may wrap lists; accept a bare array or {models}/{data}.
export const listOf = (x, key) => (Array.isArray(x) ? x : x?.[key] ?? x?.data ?? []);

export function useApi(path, { interval, enabled = true } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: !!path && enabled });
  const tick = useRef(0);
  const load = useCallback(async () => {
    if (!path || !enabled) return;
    const n = ++tick.current;
    try {
      const data = await api(path);
      if (n === tick.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (n === tick.current) setState((s) => ({ data: s.data, error, loading: false }));
    }
  }, [path, enabled]);
  useEffect(() => {
    setState((s) => ({ ...s, loading: !!path && enabled }));
    load();
    if (!interval) return;
    const id = setInterval(load, interval);
    return () => clearInterval(id);
  }, [load, interval, path, enabled]);
  return { ...state, reload: load, setData: (fn) => setState((s) => ({ ...s, data: typeof fn === 'function' ? fn(s.data) : fn })) };
}

// ---------------------------------------------------------------- live events (one EventSource for the app)

const EVENT_TYPES = ['request', 'node', 'verification', 'earning'];
const eventListeners = new Set();
let source = null;
let status = 'connecting';
const statusListeners = new Set();
const setStatus = (s) => {
  status = s;
  statusListeners.forEach((fn) => fn());
};

function ensureSource() {
  if (source || typeof EventSource === 'undefined') return;
  source = new EventSource('/api/events');
  const dispatch = (type, raw) => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    // Accept named events, or unnamed ones that carry {type, ...}.
    const t = type === 'message' ? data.type || data.event : type;
    if (!EVENT_TYPES.includes(t)) return;
    const payload = type === 'message' && data.data ? data.data : data;
    eventListeners.forEach((fn) => fn(t, payload));
  };
  EVENT_TYPES.forEach((t) => source.addEventListener(t, (e) => dispatch(t, e.data)));
  source.onmessage = (e) => dispatch('message', e.data);
  source.onopen = () => setStatus('live');
  source.onerror = () => setStatus(source.readyState === EventSource.CLOSED ? 'closed' : 'reconnecting');
}

export function useEvents(handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    ensureSource();
    const fn = (t, d) => ref.current(t, d);
    eventListeners.add(fn);
    return () => eventListeners.delete(fn);
  }, []);
}

export function useEventStatus() {
  return useSyncExternalStore(
    (fn) => (ensureSource(), statusListeners.add(fn), () => statusListeners.delete(fn)),
    () => status,
  );
}

// ---------------------------------------------------------------- streaming chat

// POSTs an OpenAI chat body with stream:true. Calls onChunk per parsed chunk, and the gateway's
// keepalive comments: onQueue for `: queued position=2 eta_s=8`, onWaiting for
// `: waiting model=<id> elapsed_s=N` (dispatched, no token yet).
export async function streamChat(path, body, { onChunk, onQueue, onWaiting, signal }) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  });
  if (!res.ok) throw await errorFrom(res);
  const meta = { seller: res.headers.get('x-moonlight-seller'), node: res.headers.get('x-moonlight-node'), request: res.headers.get('x-moonlight-request') };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 2);
      for (const line of frame.split('\n')) {
        const q = /^:\s*queued\s+position=(\d+)(?:\s+eta_s=(\d+))?/.exec(line);
        if (q) onQueue?.({ position: Number(q[1]), eta_s: q[2] == null ? null : Number(q[2]) });
        const wt = /^:\s*waiting\s+model=(\S+)\s+elapsed_s=(\d+)/.exec(line);
        if (wt) onWaiting?.({ model: wt[1], elapsed_s: Number(wt[2]) });
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') return meta;
        try {
          onChunk(JSON.parse(data));
        } catch {
          /* ignore malformed frame */
        }
      }
    }
  }
  return meta;
}

// ---------------------------------------------------------------- formatting

const nf = (d) => new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

// Money arrives as integer micro-USD. Small amounts keep enough digits to stay meaningful.
export function usd(micro, digits) {
  if (micro == null) return '—';
  const v = micro / 1e6;
  const d = digits ?? (Math.abs(v) >= 100 ? 2 : Math.abs(v) >= 1 ? 2 : Math.abs(v) >= 0.01 ? 4 : 6);
  return `$${nf(d).format(v)}`;
}

// Prices: chat per million output tokens, embeddings per million input tokens, decisions per thousand calls.
export function priceLabel(price, kind) {
  if (price == null) return { amount: '—', unit: '' };
  if (typeof price === 'number') {
    if (kind === 'decision') return { amount: usd(price * 1000, 2), unit: '/ 1k calls' };
    if (kind === 'embedding') return { amount: usd(price, 3), unit: '/ 1M tokens' };
    return { amount: usd(price, 2), unit: '/ 1M out' };
  }
  if (price.per_call != null) return { amount: usd(price.per_call * 1000, 2), unit: '/ 1k calls' };
  if (price.out_per_m == null) return { amount: usd(price.in_per_m, 3), unit: '/ 1M tokens' };
  return { amount: usd(price.out_per_m, 2), unit: '/ 1M out', sub: `${usd(price.in_per_m, 2)} in` };
}

export const priceValue = (p) => (p == null ? null : typeof p === 'number' ? p : p.out_per_m ?? p.per_call ?? p.in_per_m);

export const KINDS = { chat: 'Chat', embedding: 'Embedding', decision: 'Decision' };

// Auto models route to any live, verified listing of a class (PROTOCOL v0.3).
export const AUTO_MODELS = [
  { id: 'auto/chat-small', kind: 'chat', label: 'Any small model', hint: 'Best available small model · 1B–9B' },
  { id: 'auto/chat-large', kind: 'chat', label: 'Any large model', hint: 'Best available large model · over 9B' },
  { id: 'auto/embedding', kind: 'embedding', label: 'Any embedding model', hint: 'Cheapest verified' },
  { id: 'auto/decision', kind: 'decision', label: 'Any decision model', hint: 'Laya or compatible' },
];

export const RUNTIMES = { ollama: 'Ollama', lmstudio: 'LM Studio', llamacpp: 'llama.cpp', vllm: 'vLLM', jan: 'Jan', localai: 'LocalAI', kobold: 'KoboldCpp', openai: 'OpenAI-compatible', laya: 'Laya runner' };

export function bytes(n) {
  if (!n) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)} GB`;
  return `${Math.round(n / 1e6)} MB`;
}

export const params = (b) => (b == null ? '' : b < 1 ? `${Math.round(b * 1000)}M` : `${+b.toFixed(1)}B`);

export const ms = (n) => (n == null ? '—' : n >= 10_000 ? `${(n / 1000).toFixed(0)} s` : n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${Math.round(n)} ms`);
export const int = (n) => (n == null ? '—' : new Intl.NumberFormat('en-US').format(n));

export function ago(ts, now = Date.now()) {
  if (!ts) return 'never';
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export const clock = (ts) => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function hardware(node) {
  if (!node) return '';
  const unified = node.os === 'macos' || node.os === 'darwin';
  if (!node.gpu) return `CPU only · ${node.ram_gb} GB`;
  if (!node.vram_gb) return `${node.gpu} · ${node.ram_gb} GB`;
  return `${node.gpu} · ${node.vram_gb} GB${unified ? ' unified' : ''}`;
}

export const osLabel = (os) => ({ macos: 'macOS', darwin: 'macOS', linux: 'Linux', windows: 'Windows', win32: 'Windows' })[os] || os;

// A private model's passing badge reads "Consistent" because there is no reference to compare to.
export function badgeState(verification, isPrivate) {
  const s = verification?.state || verification || 'new';
  if (s === 'verified' && isPrivate) return 'consistent';
  return s;
}

// Buyer-facing badge of a listing: the gateway sends {state, badge}; badge wins when present.
export function badgeOf(v, method) {
  const b = v?.badge || v?.state || v || 'new';
  return b === 'verified' && (method === 'consistency' || method === 'consistent') ? 'consistent' : b;
}

export const short = (id, n = 6) => (id && id.length > n + 6 ? `${id.slice(0, n + 4)}…` : id);
