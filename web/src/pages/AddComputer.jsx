import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { navigate } from '../router.jsx';
import { CopyBox, Icon } from '../components/ui.jsx';

// Install scripts live on the gateway; local dev points at production.
export const PUBLIC_ORIGIN = /localhost|127\.0\.0\.1|^http:\/\/(10|172|192)\./.test(typeof location === 'undefined' ? '' : location.origin)
  ? 'https://moonlight.hajunshin.com'
  : location.origin;

export function detectOS() {
  const p = (navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || '').toLowerCase();
  if (p.includes('win')) return 'windows';
  if (p.includes('mac') || p.includes('iphone') || p.includes('ipad')) return 'macos';
  return 'linux';
}

export function installCommand(os) {
  return os === 'windows' ? `irm ${PUBLIC_ORIGIN}/install.ps1 | iex` : `curl -fsSL ${PUBLIC_ORIGIN}/install.sh | sh`;
}

const OSES = [
  ['macos', 'macOS'],
  ['linux', 'Linux'],
  ['windows', 'Windows'],
];

// Pair codes are four letters, a dash, four digits.
export function formatCode(raw) {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const letters = s.slice(0, 4).replace(/[^A-Z]/g, '');
  const digits = s.slice(letters.length).replace(/[^0-9]/g, '').slice(0, 4);
  return letters.length === 4 ? `${letters}-${digits}` : letters;
}

function Terminal({ os }) {
  const code = 'ABCD-1234';
  const [n, setN] = useState(0);
  useEffect(() => {
    if (n >= code.length) return;
    const id = setTimeout(() => setN(n + 1), n === 0 ? 900 : 90);
    return () => clearTimeout(id);
  }, [n]);
  return (
    <div className="terminal" aria-label="What moonlight prints when you run it">
      <div className="terminal-bar">
        <i />
        <i />
        <i />
        <span>{os === 'windows' ? 'PowerShell' : 'Terminal'}</span>
      </div>
      <pre>
        <span className="t-prompt">{os === 'windows' ? 'PS>' : '$'}</span> moonlight{'\n'}
        <span className="t-moon">☾ Moonlight</span> <span className="t-dim">agent 0.2.0</span>
        {'\n'}
        <span className="t-dim">Found</span> Ollama <span className="t-dim">(6 models)</span>, LM Studio <span className="t-dim">(1 model)</span>
        {'\n\n'}
        Approve this GPU with the code{'\n'}
        {'  '}
        <span className="t-code">
          {code.slice(0, n)}
          <span className="t-caret" />
        </span>
        {'\n'}
        <span className="t-dim">Opening {PUBLIC_ORIGIN.replace('https://', '')}/pair/{code.slice(0, n)}</span>
      </pre>
    </div>
  );
}

export default function AddComputer() {
  const [os, setOs] = useState(detectOS);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const valid = /^[A-Z]{4}-\d{4}$/.test(code);
  const go = (e) => {
    e.preventDefault();
    if (valid) navigate(`/pair/${code}`);
  };
  // Mock only: stand in for the CLI so the flow can be tried without installing anything.
  const simulate = async () => {
    setBusy(true);
    try {
      const names = { macos: ["Hajun's MacBook Air", 'darwin', 'arm64', 'Apple M3', 24, 'M3 10-core', 16], linux: ['Workshop tower', 'linux', 'x64', 'Ryzen 7 7700X', 64, 'RTX 4070', 12], windows: ['Living-room gaming PC', 'windows', 'x64', 'Core i7-12700K', 32, 'RTX 3080', 10] };
      const [name, o, arch, cpu, ram_gb, gpu, vram_gb] = names[os];
      const r = await api('/api/devices/pair', { method: 'POST', body: { node: { name, os: o, arch, cpu, ram_gb, gpu, vram_gb } } });
      navigate(`/pair/${r.pair_code}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="wrap page add-page">
      <header className="page-head">
        <p className="eyebrow">Start earning</p>
        <h1 className="h1">Add your GPU</h1>
        <p className="lede">A few minutes. Your models stay on your disk, and Moonlight only uses the VRAM your own apps leave free.</p>
      </header>

      <div className="add-grid">
        <ol className="pipeline">
          <li className="pipe-step">
            <span className="step-dot num">1</span>
            <div className="pipe-body">
              <h2 className="h3">Install</h2>
              <div className="os-tabs" role="tablist" aria-label="Operating system">
                {OSES.map(([k, label]) => (
                  <button key={k} type="button" role="tab" aria-selected={os === k} onClick={() => setOs(k)}>
                    {label}
                    {k === detectOS() && <small>yours</small>}
                  </button>
                ))}
              </div>
              <CopyBox code={installCommand(os)} lang={os === 'windows' ? 'ps1' : 'sh'} />
              <p className="faint small">Downloads one small program called <code>moonlight</code>. No Node, Python or Docker needed.</p>
            </div>
          </li>
          <li className="pipe-step">
            <span className="step-dot num">2</span>
            <div className="pipe-body">
              <h2 className="h3">
                Run <code className="cmd">moonlight</code>
              </h2>
              <p className="muted">It looks for the models you already have, shows a code like <b className="mono">ABCD-1234</b>, and opens this site.</p>
              <Terminal os={os} />
            </div>
          </li>
          <li className="pipe-step">
            <span className="step-dot num">3</span>
            <div className="pipe-body">
              <h2 className="h3">Approve</h2>
              <p className="muted">The approval page opens by itself. If it doesn&apos;t, type the code here.</p>
              <form className="code-form" onSubmit={go}>
                <input
                  className="input code-input"
                  value={code}
                  onChange={(e) => setCode(formatCode(e.target.value))}
                  placeholder="ABCD-1234"
                  aria-label="Pair code"
                  autoCapitalize="characters"
                  spellCheck={false}
                  inputMode="text"
                />
                <button className="btn btn-primary" disabled={!valid}>
                  Continue <Icon name="arrow" />
                </button>
              </form>
              {__MOCK__ && (
                <button type="button" className="ghost mock-sim" onClick={simulate} disabled={busy}>
                  Mock only: simulate running moonlight on this {OSES.find(([k]) => k === os)[1]} machine
                </button>
              )}
            </div>
          </li>
        </ol>

        <aside className="add-aside">
          <h3 className="h3">What happens next</h3>
          <dl className="facts">
            <div>
              <dt>Discovery</dt>
              <dd>We find models in Ollama, LM Studio, llama.cpp, vLLM, Jan, LocalAI, KoboldCpp and the Laya runner.</dd>
            </div>
            <div>
              <dt>Fair price</dt>
              <dd>Each model goes live at the market price for its size. Change it or pause it any time.</dd>
            </div>
            <div>
              <dt>Licenses</dt>
              <dd>Models whose license forbids commercial use stay off the market. We ask before listing anything without a license.</dd>
            </div>
            <div>
              <dt>Your apps first</dt>
              <dd>Keep using your GPU while Moonlight earns. If your apps run short of GPU memory, Moonlight pauses and unloads its models, then resumes when there&apos;s room.</dd>
            </div>
            <div>
              <dt>Verification</dt>
              <dd>Hidden test jobs compare your answers with other GPUs. Honest sellers earn a Verified badge.</dd>
            </div>
            <div>
              <dt>Privacy</dt>
              <dd>Buyers are told their prompts run on a seller&apos;s GPU. Don&apos;t log or keep what you serve.</dd>
            </div>
          </dl>
        </aside>
      </div>
    </main>
  );
}
