import { useEffect, useState } from 'react';
import { api, friendly, hardware, osLabel, useApi, useMe, refreshMe } from '../api.js';
import { Link, navigate } from '../router.jsx';
import { loginPath } from './Login.jsx';
import { formatCode } from './AddComputer.jsx';
import ModelsReview from '../components/ModelsReview.jsx';
import { Icon, Machine } from '../components/ui.jsx';

function CodeTiles({ code }) {
  return (
    <div className="code-tiles mono" aria-label={`Code ${code}`}>
      {code.split('').map((ch, i) =>
        ch === '-' ? (
          <span key={i} className="code-dash" aria-hidden>
            –
          </span>
        ) : (
          <span key={i} className="code-tile" style={{ animationDelay: `${i * 40}ms` }} aria-hidden>
            {ch}
          </span>
        ),
      )}
    </div>
  );
}

function ComputerCard({ node, lit }) {
  return (
    <div className={`computer-card ${lit ? 'lit' : ''}`}>
      <Machine online={lit} size={56} />
      <div className="computer-spec">
        <h2 className="computer-name">{node.name}</h2>
        <dl>
          <div>
            <dt>Graphics</dt>
            <dd>{hardware(node)}</dd>
          </div>
          <div>
            <dt>Processor</dt>
            <dd>{node.cpu}</dd>
          </div>
          <div>
            <dt>Memory</dt>
            <dd>{node.ram_gb} GB</dd>
          </div>
          <div>
            <dt>System</dt>
            <dd>
              {osLabel(node.os)} · {node.arch}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

// After approval: wait for the agent to connect and report what it found.
function Discovery({ nodeId, name }) {
  const { data } = useApi('/api/me/nodes', { interval: 1500 });
  const node = data?.nodes?.find((n) => n.node_id === nodeId);
  const ready = node?.online && node.models.length > 0;
  return (
    <div className="discovery">
      {!ready ? (
        <div className="discovery-wait">
          <span className="spinner" aria-hidden />
          <div>
            <h3 className="h3">Connecting to {name}…</h3>
            <p className="muted">Your terminal will say “Approved”. We&apos;re asking it which models it has.</p>
          </div>
        </div>
      ) : (
        <>
          <ModelsReview node={node} models={node.models} showEarnings={false} />
          <div className="discovery-next">
            <p className="muted">Live models start taking jobs now. You can change prices or pause anything later.</p>
            <Link to="/me/sell" className="btn btn-primary">
              Go to your dashboard <Icon name="arrow" />
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

export default function Pair({ code }) {
  const valid = /^[A-Z]{4}-\d{4}$/.test(code);
  const { me } = useMe();
  const { data, error, loading, reload } = useApi(valid ? `/api/devices/${code}` : null);
  const [approved, setApproved] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [retry, setRetry] = useState('');

  useEffect(() => {
    if (approved) window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [approved]);
  useEffect(() => {
    if (me === null && valid) navigate(loginPath(`/pair/${code}`), { replace: true });
  }, [me, valid, code]);

  const approve = async () => {
    setBusy(true);
    setErr(null);
    try {
      setApproved(await api(`/api/devices/${code}/approve`, { method: 'POST' }));
      refreshMe();
    } catch (e) {
      setErr(friendly(e, 'pair'));
      reload();
    } finally {
      setBusy(false);
    }
  };

  if (!valid || error?.status === 404) {
    return (
      <main className="wrap page narrow-page">
        <p className="eyebrow">Add a GPU</p>
        <h1 className="h2">That code doesn&apos;t match a computer.</h1>
        <p className="muted">Check the code your terminal shows. Codes look like ABCD-1234 and expire after 10 minutes.</p>
        <form
          className="code-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (/^[A-Z]{4}-\d{4}$/.test(retry)) navigate(`/pair/${retry}`);
          }}
        >
          <input className="input code-input" value={retry} onChange={(e) => setRetry(formatCode(e.target.value))} placeholder="ABCD-1234" aria-label="Pair code" />
          <button className="btn btn-primary">Try again</button>
        </form>
      </main>
    );
  }

  if (loading || !data) {
    return (
      <main className="wrap page pair-page">
        <div className="skeleton" style={{ height: 320 }} />
      </main>
    );
  }

  const node = data.node;
  const status = approved ? 'approved-now' : data.status;

  return (
    <main className="wrap page pair-page">
      <div className={`pair-card ${status}`}>
        <div className="pair-top">
          <p className="eyebrow">{status === 'approved-now' ? 'Approved' : 'Add a GPU'}</p>
          <CodeTiles code={code} />
          {status === 'pending' && <p className="faint small">Check that this matches the code in your terminal.</p>}
        </div>

        <ComputerCard node={node} lit={status === 'approved-now' || status === 'approved'} />

        {status === 'pending' && (
          <div className="pair-action">
            {me ? (
              <>
                <h1 className="pair-q">
                  Approve <span>{node.name}</span>?
                </h1>
                <p className="muted">
                  It will sell the models it can run under your account, <b>{me.account.email}</b>. Earnings go to your balance.
                </p>
                {err && <p className="form-error">{err}</p>}
                <div className="pair-buttons">
                  <button type="button" className="btn btn-primary" onClick={approve} disabled={busy}>
                    {busy ? 'Approving…' : 'Approve'}
                  </button>
                  <Link to="/" className="ghost">
                    This isn&apos;t my computer
                  </Link>
                </div>
              </>
            ) : null}
          </div>
        )}

        {status === 'expired' && (
          <div className="pair-action">
            <h1 className="pair-q">This code has expired.</h1>
            <p className="muted">
              Run <code>moonlight</code> again for a new code.
            </p>
          </div>
        )}

        {status === 'approved' && (
          <div className="pair-action">
            <h1 className="pair-q">{node.name} is already approved.</h1>
            <Link to="/me/sell" className="btn btn-secondary">
              Open your dashboard
            </Link>
          </div>
        )}

        {status === 'approved-now' && (
          <div className="pair-action pair-done">
            <h1 className="pair-q">
              <span>{approved.name}</span> is connected.
            </h1>
          </div>
        )}
      </div>

      {approved && <Discovery nodeId={approved.node_id} name={approved.name} />}
    </main>
  );
}
