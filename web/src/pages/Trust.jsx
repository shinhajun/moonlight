import { useState } from 'react';
import { badgeOf, useEvents, usd, clock } from '../api.js';
import { useNetwork } from '../network.js';
import { Link, modelPath } from '../router.jsx';
import { Badge, Machine, Icon, BADGE_COPY } from '../components/ui.jsx';

// A real-shaped canary: the reference's greedy answer, cut at 8 word boundaries (the very first is skipped).
// At each cut both GPUs continue the same text, and the next 3 words must all match.
const ANSWER = 'Yeast feeds on the sugars in the flour and gives off carbon dioxide. The gas gets trapped in a stretchy web of gluten, so the dough puffs up. Heat in the oven makes the bubbles expand even more before the crust sets.'.split(' ');
// Cut position → what each seller's GPU wrote next, where it differs from the reference.
const GATES = {
  1: { cheat: 'eats the sugars' },
  5: {},
  9: {},
  14: { cheat: 'gas makes the' },
  19: { cheat: 'stretchy gluten network' },
  24: { cheat: 'the dough rises' },
  29: {},
  34: { honest: 'bubbles expand further', cheat: 'dough rise more' },
};
// PROTOCOL's measurement on qwen2.5:7b, 3 words at a time.
const MEASURED = [
  ['Honest CPU vs GPU', 0.9, 'pass'],
  ['0.5B model posing as 7B', 0.33, 'fail'],
];
const PASS = 0.625;

function Agreement() {
  const [who, setWho] = useState('honest');
  const gates = Object.keys(GATES).map(Number);
  const next = (i) => ANSWER.slice(i, i + 3).join(' ');
  const agree = gates.filter((i) => (GATES[i][who] ?? next(i)) === next(i)).length;
  const pass = agree >= 5;
  const text = [];
  for (let i = 0; i < ANSWER.length; i++) {
    if (!(i in GATES)) {
      text.push(<span key={i}>{ANSWER[i]} </span>);
      continue;
    }
    const ref = next(i).split(' ');
    const home = (GATES[i][who] ?? next(i)).split(' ');
    const ok = home.every((w, j) => w === ref[j]);
    text.push(
      <span key={`${i}-${who}`} className={`gate ${ok ? 'ok' : 'miss'}`} style={{ animationDelay: `${gates.indexOf(i) * 70}ms` }}>
        {ref.map((w, j) => (
          <span key={`r${j}`} className="gate-ref">
            {w}
          </span>
        ))}
        {home.map((w, j) => (
          <span key={`h${j}`} className={`gate-home${w === ref[j] ? '' : ' diff'}`}>
            {w}
          </span>
        ))}
        <span className="gate-mark" aria-label={ok ? 'agrees' : 'disagrees'}>
          {ok ? '✓' : '✕'}
        </span>
      </span>,
      ' ',
    );
    i += 2;
  }
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
        <span className="label">Test job</span> Why does bread dough rise?
      </p>
      <p className="agree-text">{text}</p>
      <div className="agree-legend small">
        <span>
          <i className="lg-ref" /> the reference&apos;s next 3 words
        </span>
        <span>
          <i className="lg-home" /> the seller&apos;s next 3 words
        </span>
      </div>
      <div className={`agree-result ${pass ? 'pass' : 'fail'}`}>
        <b className="num">{agree} of 8</b> match all 3 words
        <span>{pass ? 'Passes (needs 5 of 8)' : 'Fails (needs 5 of 8)'}</span>
        <Badge state={pass ? 'verified' : 'flagged'} size="lg" withTip={false} />
      </div>
    </div>
  );
}

// Measured agreement scores as bars on a 0–1 scale, with the 5-of-8 pass line.
function Measured() {
  const pos = (v) => `${v * 100}%`;
  return (
    <figure className="measured">
      <figcaption className="label">Measured agreement, 3 words at a time</figcaption>
      {MEASURED.map(([label, v, k]) => (
        <div key={label} className={`m-row ${k}`}>
          <span className="m-label">{label}</span>
          <span className="m-track">
            <span className="m-fill" style={{ width: pos(v) }} />
            <span className="m-pass" style={{ left: pos(PASS) }} aria-hidden />
          </span>
          <b className="num">{v.toFixed(2)}</b>
        </div>
      ))}
      <div className="m-row m-scale num" aria-hidden>
        <span className="m-track">
          <span style={{ left: 0 }}>0</span>
          <span className="m-pass-label" style={{ left: pos(PASS) }}>
            pass {PASS}
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
          <h2 className="h2">Guess the next three words</h2>
          <p>
            Two honest GPUs rarely write the same paragraph word for word, so comparing whole answers would fail honest sellers. Instead we take a reference answer, cut it off at 8
            places, and ask the seller&apos;s GPU for just the <b>next three words</b> at each.
          </p>
          <p className="muted">
            The same half-finished text goes to a reference GPU too. A place counts only if all three words match, and passing takes 5&nbsp;of&nbsp;8. A GPU running the model it claims
            clears that easily. A smaller model wearing the same label doesn&apos;t.
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
