// Accepted digests from public sources, cached for registryTtlMs. A failed lookup keeps the last
// known answer and is retried after a minute.
//   Ollama tags: sha256 of the registry manifest.
//   hf.co/<user>/<repo>[:<quant>]: the LFS sha256 of the repo's GGUF files (matching the quant if given).
import { sha256 } from './util.js';

export function createDigests(config) {
  const cache = new Map(); // key -> {value, until, pending}

  function cached(key, load) {
    const hit = cache.get(key);
    if (hit && Date.now() < hit.until) return hit.value;
    if (hit?.pending) return hit.pending;
    const entry = { value: hit?.value ?? [], until: 0 };
    entry.pending = load()
      .then((v) => Object.assign(entry, { value: v, until: Date.now() + config.registryTtlMs }))
      .catch(() => Object.assign(entry, { until: Date.now() + 60_000 }))
      .then(() => {
        entry.pending = null;
        return entry.value;
      });
    cache.set(key, entry);
    return entry.pending;
  }

  async function ollama(modelId) {
    const [name, tag = 'latest'] = modelId.split(':');
    const repo = name.includes('/') ? name : `library/${name}`;
    const res = await fetch(`${config.registryUrl}/v2/${repo}/manifests/${encodeURIComponent(tag)}`, {
      headers: { accept: 'application/vnd.docker.distribution.manifest.v2+json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`registry ${res.status}`);
    return [sha256(Buffer.from(await res.arrayBuffer()))];
  }

  async function hf(modelId) {
    const [path, quant] = modelId.replace(/^hf\.co\//, '').split(':');
    const res = await fetch(`${config.hfUrl}/api/models/${path}/tree/main?recursive=true`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`hf ${res.status}`);
    const files = (await res.json()).filter((f) => f.lfs?.oid && /\.gguf$/i.test(f.path));
    const match = quant ? files.filter((f) => f.path.toLowerCase().includes(quant.toLowerCase())) : files;
    return (match.length ? match : files).map((f) => f.lfs.oid);
  }

  return {
    // Digests the outside world vouches for; [] when there is no public source or it is unreachable.
    async lookup(modelId, runtime) {
      if (!config.registryUrl) return [];
      if (modelId.startsWith('hf.co/')) return cached(`hf:${modelId}`, () => hf(modelId));
      if (runtime === 'ollama') return cached(`ollama:${modelId}`, () => ollama(modelId));
      return [];
    },
  };
}
