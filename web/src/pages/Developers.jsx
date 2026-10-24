import { useState } from 'react';
import { api, ago, refreshMe, useMe, AUTO_MODELS } from '../api.js';
import { Link } from '../router.jsx';
import { AuthForm } from './Login.jsx';
import CodeTabs from '../components/CodeTabs.jsx';
import { CopyBox, Icon } from '../components/ui.jsx';
import { BASE, snippets } from '../snippets.js';

function Keys({ me }) {
  const [fresh, setFresh] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const create = async () => {
    setBusy(true);
    try {
      setFresh(await api('/api/me/keys', { method: 'POST', body: {} }));
      refreshMe();
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (id) => {
    await api(`/api/me/keys/${id}`, { method: 'DELETE' });
    setConfirm(null);
    refreshMe();
  };
  return (
    <div className="keys">
      {fresh && (
        <div className="key-once" role="status">
          <p className="kicker">New key · shown once</p>
          <CopyBox code={fresh.secret} lang="key" />
          <p className="small">Copy it now and keep it somewhere safe. We store only a hash, so this is the last time you&apos;ll see it.</p>
          <button type="button" className="btn btn-small btn-secondary" onClick={() => setFresh(null)}>
            I&apos;ve saved it
          </button>
        </div>
      )}
      <div className="table-scroll keys-scroll">
      <table className="ledger keys-table">
        <thead>
          <tr>
            <th>Key</th>
            <th>Created</th>
            <th>Last used</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {me.keys.map((k) => (
            <tr key={k.id}>
              <td className="mono">{k.prefix}••••••••••••</td>
              <td className="faint">{ago(k.created_at)}</td>
              <td className="faint">{k.last_used ? ago(k.last_used) : 'never'}</td>
              <td className="r">
                {confirm === k.id ? (
                  <span className="confirm">
                    Revoke?{' '}
                    <button type="button" className="btn btn-small btn-danger" onClick={() => revoke(k.id)}>
                      Revoke
                    </button>{' '}
                    <button type="button" className="ghost" onClick={() => setConfirm(null)}>
                      Keep
                    </button>
                  </span>
                ) : (
                  <button type="button" className="ghost" onClick={() => setConfirm(k.id)}>
                    Revoke
                  </button>
                )}
              </td>
            </tr>
          ))}
          {me.keys.length === 0 && (
            <tr>
              <td colSpan={4} className="faint">
                No keys yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
      <button type="button" className="btn btn-primary" onClick={create} disabled={busy}>
        {busy ? 'Creating…' : 'Create API key'}
      </button>
    </div>
  );
}

export default function Developers() {
  const { me } = useMe();
  const [kind, setKind] = useState('chat');
  const example = { chat: 'auto/chat-large', embedding: 'auto/embedding', decision: 'auto/decision' }[kind];
  return (
    <main className="wrap page dev-page">
      <header className="page-head dev-head">
        <div>
          <p className="kicker">Developers</p>
          <h1 className="title-xl">One key. Every model.</h1>
          <p className="lede">Moonlight speaks the OpenAI API. Point your SDK at our base URL, and the <code>model</code> field picks who answers.</p>
        </div>
        <div className="base-url">
          <span className="kicker">Base URL</span>
          <CopyBox code={BASE} lang="url" compact />
        </div>
      </header>

      <div className="dev-grid">
        <section className="dev-keys">
          <h2 className="title-md">API keys</h2>
          {me ? (
            <Keys me={me} />
          ) : me === null ? (
            <div className="panel pad">
              <p className="muted small">Sign in to create a key. One key works for every model.</p>
              <AuthForm compact />
            </div>
          ) : (
            <div className="skeleton" style={{ height: 160 }} />
          )}
          <div className="dev-notes">
            <h3 className="title-md">Choosing a model</h3>
            <table className="ledger">
              <tbody>
                {AUTO_MODELS.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <code>{a.id}</code>
                    </td>
                    <td className="muted">{a.hint}</td>
                  </tr>
                ))}
                <tr>
                  <td>
                    <code>qwen3.5:35b-a3b</code>
                  </td>
                  <td className="muted">
                    Any id from the <Link to="/models">catalog</Link>
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="small muted">
              The response&apos;s <code>model</code> names the model that actually answered.
            </p>
          </div>
        </section>

        <section className="dev-code">
          <div className="chips" role="group" aria-label="API">
            {[
              ['chat', 'Chat completions'],
              ['embedding', 'Embeddings'],
              ['decision', 'Decisions'],
            ].map(([k, l]) => (
              <button key={k} type="button" className="chip" aria-pressed={kind === k} onClick={() => setKind(k)}>
                {l}
              </button>
            ))}
          </div>
          <CodeTabs key={kind} tabs={snippets(kind, example, { verified: kind === 'chat' })} />

          <div className="dev-ref">
            <div>
              <h3 className="title-md">Moonlight options</h3>
              <p className="small muted">
                Add a <code>moonlight</code> object to any request (Python: <code>extra_body</code>).
              </p>
              <dl className="params">
                <div>
                  <dt>
                    <code>verified_only</code>
                  </dt>
                  <dd>Only computers that passed inspection.</dd>
                </div>
                <div>
                  <dt>
                    <code>max_price_out_per_m</code>
                  </dt>
                  <dd>Cap the price, in micro-dollars per million output tokens.</dd>
                </div>
                <div>
                  <dt>
                    <code>seller</code>
                  </dt>
                  <dd>Pin one seller by id.</dd>
                </div>
                <div>
                  <dt>
                    <code>max_wait_s</code>
                  </dt>
                  <dd>How long to wait in line when every computer is busy (default 30, up to 120).</dd>
                </div>
              </dl>
            </div>
            <div>
              <h3 className="title-md">When it&apos;s busy</h3>
              <dl className="params">
                <div>
                  <dt>Queued</dt>
                  <dd>
                    Streams get <code>: queued position=2 eta_s=8</code> comments while they wait. SDKs ignore them; queued time is never billed.
                  </dd>
                </div>
                <div>
                  <dt>503 no_capacity</dt>
                  <dd>
                    Nobody free in time. <code>moonlight.suggestions</code> lists similar live models, including an <code>auto/*</code> alias.
                  </dd>
                </div>
                <div>
                  <dt>Failover</dt>
                  <dd>
                    If a computer drops mid-answer, another continues it. The final chunk lists <code>moonlight.failovers</code>.
                  </dd>
                </div>
                <div>
                  <dt>402</dt>
                  <dd>Balance too low.</dd>
                </div>
              </dl>
            </div>
          </div>
          <p className="notice">
            <Icon name="eye" />
            <span>
              Requests run on community computers, and the seller can see your prompt. Don&apos;t send secrets. <Link to="/trust">How we check sellers</Link>
            </span>
          </p>
        </section>
      </div>
    </main>
  );
}
