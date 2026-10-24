import { useState } from 'react';
import { badgeOf, useEvents, usd, clock } from '../api.js';
import { useNetwork } from '../network.js';
import { Link, modelPath } from '../router.jsx';
import { Badge, Machine, Icon, BADGE_COPY } from '../components/ui.jsx';

// A real-shaped canary: the reference's greedy answer, cut at 8 word boundaries.
const ANSWER = 'Yeast eats the sugars in the flour and releases carbon dioxide, which gets trapped in the stretchy gluten and makes the dough expand.'.split(' ');
const GATES = {
  1: 'feeds',
  3: 'sugars',
  6: 'dough',
  8: 'makes',
  11: 'which',
  13: 'trapped',
  16: 'dough',
  19: 'makes',
};
const MEASURED = [
  ['Same GPU, twice', 0.97, 'pass'],
  ['Honest CPU vs GPU', 0.94, 'pass'],
  ['0.5B model posing as 3B', 0.69, 'fail'],
];

function Agreement() {
  const [who, setWho] = useState('honest');
  const gates = Object.keys(GATES).map(Number);
  const agree = gates.filter((i) => who === 'honest' || GATES[i] === ANSWER[i]).length;
  const pass = agree >= 7;
  return (
    <div className="agree">
      <div className="agree-controls" role="radiogroup" aria-label="Which GPU">
        <button type="button" className="chip" role="radio" aria-checked={who === 'honest'} aria-pressed={who === 'honest'} onClick={() => setWho('honest')}>
          Honest seller
        </button>
        <button type="button" className="chip" role="radio" aria-checked={who === 'cheat'} aria-pressed={who === 'cheat'} onClick={() => setWho('cheat')}>
          Cheater: smaller model, same label
        </button>
      </div>
      <p className="agree-prompt">
        <span className="label">Test job</span> In one sentence, why does bread dough rise?
      </p>
      <p className="agree-text">
        {ANSWER.map((w, i) => {
          if (!(i in GATES)) return <span key={i}>{w} </span>;
          const home = who === 'honest' ? w : GATES[i];
          const ok = home === w;
          return (
            <span key={`${i}-${who}`} className={`gate ${ok ? 'ok' : 'miss'}`} style={{ animationDelay: `${gates.indexOf(i) * 70}ms` }}>
              <span className="gate-ref">{w.replace(/[.,]/g, '')}</span>
              <span className="gate-home">{home.replace(/[.,]/g, '')}</span>
              <span className="gate-mark" aria-label={ok ? 'agrees' : 'disagrees'}>
                {ok ? '✓' : '✕'}
              </span>{' '}
            </span>
          );
        })}
      </p>
      <div className="agree-legend small">
        <span>
          <i className="lg-ref" /> what the reference says next
        </span>
        <span>
          <i className="lg-home" /> what the seller&apos;s GPU says next
        </span>
      </div>
      <div className={`agree-result ${pass ? 'pass' : 'fail'}`}>
        <b className="num">{agree} of 8</b> next words agree
        <span>{pass ? 'Passes (needs 7 of 8)' : 'Fails (needs 7 of 8)'}</span>
        <Badge state={pass ? 'verified' : 'flagged'} size="lg" withTip={false} />
      </div>
    </div>
  );
}

// Measured agreement scores as bars on a 0.5–1.0 scale, with the 7-of-8 pass line.
function Measured() {
  const pos = (v) => `${((v - 0.5) / 0.5) * 100}%`;
  return (
    <figure className="measured">
      <figcaption className="label">Measured next-word agreement</figcaption>
      {MEASURED.map(([label, v, k]) => (
        <div key={label} className={`m-row ${k}`}>
          <span className="m-label">{label}</span>
          <span className="m-track">
            <span className="m-fill" style={{ width: pos(v) }} />
            <span className="m-pass" style={{ left: pos(0.875) }} aria-hidden />
          </span>
          <b className="num">{v.toFixed(2)}</b>
        </div>
      ))}
      <div className="m-row m-scale num" aria-hidden>
        <span className="m-track">
          <span style={{ left: 0 }}>0.5</span>
          <span className="m-pass-label" style={{ left: pos(0.875) }}>
            pass 0.875
          </span>
          <span style={{ left: '100%' }}>1.0</span>
        </span>
      </div>
    </figure>
  );
}

function LiveChecks({ names }) {
  const [rows, setRows] = useState([]);
  useEvents((type, d) => {
    if (type === 'verification') setRows((r) => [{ ...d, k: `${d.ts}-${d.listing_id}-${Math.random()}` }, ...r].slice(0, 8));
  });
  return (
    <ol className="vlog live-checks">
      {rows.length === 0 && <li className="vlog-wait faint small">Waiting for the next check…</li>}
      {rows.map((c) => (
        <li key={c.k} className={`fresh ${c.passed ? 'pass' : 'fail'}`}>
          <span className="vlog-mark" aria-label={c.passed ? 'Passed' : 'Failed'}>
            <Icon name={c.passed ? 'check' : 'flagged'} size={12} />
          </span>
          <div className="vlog-main">
            <span className="mono">{c.model_id}</span>
            {names[c.node_id] && <span className="faint xs">{names[c.node_id]}</span>}
          </div>
          <time className="num faint xs">{clock(c.ts)}</time>
          <Badge state={badgeOf(c.state, c.method)} size="sm" />
        </li>
      ))}
    </ol>
  );
}

export default function Trust() {
  const net = useNetwork();
  const flagged = net.listings.filter((l) => badgeOf(l.verification) === 'flagged');
  return (
    <main className="wrap page trust-page">
      <header className="page-head trust-head">
        <p className="eyebrow">Verification</p>
        <h1 className="h1">How we know a seller runs what they list.</h1>
        <p className="lede">Anyone can claim their GPU runs a big model. So we check, quietly and often, with test jobs no seller can tell apart from real ones.</p>
      </header>

      <section className="glance" aria-label="Badges">
        {['verified', 'consistent', 'new', 'flagged'].map((k) => (
          <div key={k} className={`glance-item g-${k}`}>
            <Badge state={k} size="lg" withTip={false} />
            <p>{BADGE_COPY[k].tip}</p>
          </div>
        ))}
      </section>

      <section className="trust-block">
        <div className="trust-copy">
          <p className="eyebrow">The check</p>
          <h2 className="h2">Guess the next word</h2>
          <p>
            Two honest GPUs rarely write the same paragraph word for word, so comparing whole answers would fail honest sellers. Instead we take a reference answer, cut it off at 8
            places, and ask the seller&apos;s GPU for just the <b>next word</b>.
          </p>
          <p className="muted">
            The same half-finished text goes to a reference GPU too. A GPU running the model it claims agrees almost every time. A smaller model wearing the same label
            doesn&apos;t.
          </p>
          <Measured />
        </div>
        <Agreement />
      </section>

      <section className="methods">
        <div>
          <h3 className="h3">Decisions</h3>
          <p>
            We replay about 1 in 10 real requests on a reference GPU. Every probability must land within <b>0.05</b>.
          </p>
        </div>
        <div>
          <h3 className="h3">Embeddings</h3>
          <p>
            The same text must produce nearly the same vector: cosine similarity of at least <b>0.99</b>.
          </p>
        </div>
        <div>
          <h3 className="h3">Private models</h3>
          <p>
            Nobody else has the weights, so there is nothing to compare with. We check the model answers the same way twice and stays up. Badge: <b>Consistent</b>.
          </p>
        </div>
        <div>
          <h3 className="h3">Check-in</h3>
          <p>When a GPU connects, the model files&apos; fingerprint must match the published one. That proves a consistent claim; the test jobs prove the truth.</p>
        </div>
      </section>

      <section className="refs">
        <h2 className="h3">What we compare against</h2>
        <ol className="ref-flow">
          <li>
            <b>Trusted reference</b>
            <span>A GPU we run ourselves serves the same model.</span>
          </li>
          <li>
            <b>Peer majority</b>
            <span>Otherwise, test jobs go to two or more sellers. The one that disagrees fails.</span>
          </li>
          <li>
            <b>Consistent only</b>
            <span>Nobody else serves it yet. We say so: “Not independently verified yet.”</span>
          </li>
        </ol>
      </section>

      <section className="honest">
        <div className="honest-statement">
          <Icon name="eye" size={28} />
          <p>
            Runs on a seller&apos;s GPU. <br />
            <b>The seller can see your prompt.</b>
          </p>
        </div>
        <div className="honest-copy">
          <p>
            Inspections prove which model answered, not what happens to your words. We show this line next to every chat box, and we&apos;d rather you knew. Don&apos;t send passwords, keys,
            or anything you wouldn&apos;t say out loud.
          </p>
          <p>
            Turn on <b>Verified only</b> in any chat, or send <code>{'"moonlight": {"verified_only": true}'}</code>, to route only to GPUs that passed their checks.
          </p>
        </div>
      </section>

      <section className="flagged-now">
        <header className="block-head">
          <div>
            <p className="eyebrow">Suspended</p>
            <h2 className="h2">Flagged right now</h2>
          </div>
          <p className="muted small">Two failures in the last ten checks: suspended, earnings held, badge turns red.</p>
        </header>
        {flagged.length === 0 ? (
          <p className="empty">Nobody is flagged right now.</p>
        ) : (
          <ul className="flag-list">
            {flagged.map((l) => (
              <li key={l.listing_id} className="flag-card">
                <Machine flagged size={44} />
                <div className="flag-body">
                  <h3>{l.node.name}</h3>
                  <p className="muted small">
                    {l.seller.name} · listed <Link to={modelPath(l.model_id)}>{l.model_id}</Link>
                  </p>
                  <p>
                    Failed its checks: its next words matched a different model, not the one on the label.{l.held_microusd ? <> <b>{usd(l.held_microusd)}</b> held.</> : ' Earnings held.'}
                  </p>
                </div>
                <Badge state="flagged" size="lg" withTip={false} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="trust-live">
        <header className="block-head">
          <h2 className="h3">Recent checks</h2>
        </header>
        <LiveChecks names={Object.fromEntries(net.nodes.map((n) => [n.node_id, n.name]))} />
      </section>
    </main>
  );
}
