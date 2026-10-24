import { useEffect, useRef, useState } from 'react';
import { api, ago, friendly, int, refreshMe, usd, useMe, AUTO_MODELS } from '../api.js';
import { Link } from '../router.jsx';
import { SignInCta } from './Login.jsx';
import CodeTabs from '../components/CodeTabs.jsx';
import { CopyBox, Icon } from '../components/ui.jsx';
import { BASE, snippets } from '../snippets.js';

// What a failed key request says. 409 is the per-account cap; 404 means the key is already gone.
function keyError(err, count) {
  if (err?.status === 409) return `You have ${count} keys, the most an account can have. Delete one you no longer use, then create a new one.`;
  if (err?.status === 429) return friendly(err);
  if (!err?.status || err.status >= 500) return "Couldn't reach Moonlight. Check your connection and try again.";
  return err.message;
}

const spend = (micro = 0) => (micro === 0 ? '$0.00' : usd(micro, micro < 10_000 ? 4 : 2));

// The key's name, renamed in place: Enter or leaving the field saves, Escape cancels. Empty means untitled.
function KeyName({ k, count }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const done = useRef(false);
  const start = () => {
    done.current = false;
    setValue(k.name || '');
    setError(null);
    setEditing(true);
  };
  const save = async () => {
    if (done.current) return;
    const next = value.trim().slice(0, 60) || null;
    if (next === (k.name ?? null)) {
      done.current = true;
      return setEditing(false);
    }
    setSaving(true);
    try {
      await api(`/api/me/keys/${k.id}`, { method: 'PATCH', body: { name: next ?? '' } });
      await refreshMe();
      done.current = true;
      setEditing(false);
    } catch (err) {
      setError(keyError(err, count));
    } finally {
      setSaving(false);
    }
  };
  if (editing) {
    return (
      <form
        className="key-rename"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <input
          className="input input-sm"
          value={value}
          maxLength={60}
          autoFocus
          disabled={saving}
          placeholder="Untitled key"
          aria-label="Key name"
          onChange={(e) => setValue(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return;
            done.current = true;
            setEditing(false);
          }}
        />
        {error && (
          <span className="form-error small" role="alert">
            {error}
          </span>
        )}
      </form>
    );
  }
  return (
    <button type="button" className="key-name" onClick={start} title="Rename">
      <span className={k.name ? '' : 'faint'}>{k.name || 'Untitled key'}</span>
      <Icon name="pencil" size={13} />
      <span className="sr-only">Rename</span>
    </button>
  );
}

// Confirms a delete, naming the key; the key stops working on its very next request.
function DeleteKey({ k, count, onClose }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => ref.current.showModal(), []);
  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/me/keys/${k.id}`, { method: 'DELETE' });
    } catch (err) {
      if (err.status !== 404) {
        setError(keyError(err, count));
        setBusy(false);
        return;
      }
    }
    await refreshMe();
    ref.current?.close();
  };
  return (
    <dialog ref={ref} className="dialog" aria-labelledby="delete-key-title" onClose={onClose} onClick={(e) => e.target === ref.current && ref.current.close()}>
      <div className="dialog-body">
        <h2 id="delete-key-title" className="h3">
          Delete {k.name ? `“${k.name}”` : 'this key'}?
        </h2>
        <p className="mono small faint">{k.prefix}</p>
        <p>Requests using this key will start failing immediately. This can&apos;t be undone.</p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={() => ref.current.close()} autoFocus>
            Cancel
          </button>
          <button type="button" className="btn btn-danger" onClick={remove} disabled={busy}>
            {busy ? 'Deleting…' : 'Delete key'}
          </button>
        </div>
      </div>
    </dialog>
  );
}

// API keys: create one (its secret shows once), rename in place, delete after a confirm. Requests and spend
// count successful calls made with each key.
function Keys({ me }) {
  const keys = me.keys || [];
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [doomed, setDoomed] = useState(null);
  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const made = await api('/api/me/keys', { method: 'POST', body: name.trim() ? { name: name.trim() } : {} });
      setFresh(made);
      setName('');
      await refreshMe();
    } catch (err) {
      setError(keyError(err, keys.length));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="keys">
      <form className="key-create" onSubmit={create}>
        <label className="field">
          <span>Name (optional)</span>
          <input className="input" value={name} maxLength={60} placeholder="e.g. laptop, staging, CI" onChange={(e) => setName(e.target.value)} />
        </label>
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Creating…' : 'Create key'}
        </button>
      </form>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {fresh && (
        <div className="key-once" role="status">
          <p className="key-once-head">
            <b>{fresh.key.name || 'New key'}</b> <span className="mono faint">{fresh.key.prefix}</span>
          </p>
          <CopyBox code={fresh.secret} lang="key" />
          <p className="small">
            <b>You won&apos;t see this key again.</b> Copy it now and keep it somewhere safe. Moonlight stores only a hash of it.
          </p>
          <button type="button" className="btn btn-sm" onClick={() => setFresh(null)}>
            Done
          </button>
        </div>
      )}

      {keys.length === 0 ? (
        <div className="keys-empty">
          <b>No API keys yet.</b>
          <p className="small muted">Create one to call Moonlight from your code. A key works with every model.</p>
        </div>
      ) : (
        <div className="table-scroll keys-scroll">
          <table className="ledger keys-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Key</th>
                <th>Created</th>
                <th>Last used</th>
                <th className="r">Requests</th>
                <th className="r">Spend</th>
                <th>
                  <span className="sr-only">Delete</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className={fresh?.key.id === k.id ? 'is-new' : ''}>
                  <td className="key-name-cell">
                    <KeyName k={k} count={keys.length} />
                  </td>
                  <td className="mono key-prefix" data-label="Key">
                    {k.prefix}
                  </td>
                  <td className="faint" data-label="Created">
                    {ago(k.created_at)}
                  </td>
                  <td className="faint" data-label="Last used">
                    {k.last_used ? ago(k.last_used) : 'Never'}
                  </td>
                  <td className="num r" data-label="Requests">
                    {int(k.requests ?? 0)}
                  </td>
                  <td className="num r" data-label="Spend">
                    {spend(k.spend_microusd)}
                  </td>
                  <td className="r key-actions">
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => setDoomed(k)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {doomed && <DeleteKey k={doomed} count={keys.length} onClose={() => setDoomed(null)} />}
    </div>
  );
}

export default function Docs() {
  const { me, error } = useMe();
  const [kind, setKind] = useState('chat');
  const example = { chat: 'auto/chat-large', embedding: 'auto/embedding', decision: 'auto/decision' }[kind];
  return (
    <main className="wrap page dev-page">
      <header className="page-head dev-head">
        <div>
          <p className="eyebrow">API</p>
          <h1 className="h1">One key. Every open model.</h1>
          <p className="lede">Moonlight speaks the OpenAI API. Point your SDK at our base URL, and the <code>model</code> field picks who answers.</p>
        </div>
        <div className="base-url">
          <span className="label">Base URL</span>
          <CopyBox code={BASE} lang="url" compact />
        </div>
      </header>

      <section className="dev-keys" aria-labelledby="keys-title">
        <div className="keys-head">
          <h2 id="keys-title" className="h2">
            API keys
          </h2>
          <p className="muted">One key works for every model. Requests and spend count the calls made with each key.</p>
        </div>
        {me ? (
          <Keys me={me} />
        ) : me === null ? (
          <SignInCta label="Sign in to create a key" note="One key works for every model." next="/docs" />
        ) : error ? (
          <div className="notice warn">
            <Icon name="flagged" />
            <div>
              Couldn&apos;t load your keys.{' '}
              <button type="button" className="link" onClick={refreshMe}>
                Try again
              </button>
            </div>
          </div>
        ) : (
          <div className="skeleton" style={{ height: 180 }} />
        )}
      </section>

      <div className="dev-grid">
        <section className="dev-side">
          <div className="dev-notes">
            <h3 className="h3">Choosing a model</h3>
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
              <h3 className="h3">Moonlight options</h3>
              <p className="small muted">
                Add a <code>moonlight</code> object to any request (Python: <code>extra_body</code>).
              </p>
              <dl className="params">
                <div>
                  <dt>
                    <code>verified_only</code>
                  </dt>
                  <dd>Only GPUs that passed verification.</dd>
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
                  <dd>How long to wait in line when every GPU is busy (default 30, up to 120).</dd>
                </div>
              </dl>
            </div>
            <div>
              <h3 className="h3">When it&apos;s busy</h3>
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
                    If a GPU drops mid-answer, another continues it. The final chunk lists <code>moonlight.failovers</code>.
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
              Requests run on sellers&apos; GPUs, and the seller can see your prompt. Don&apos;t send secrets. <Link to="/trust">How we check sellers</Link>
            </span>
          </p>
        </section>
      </div>
    </main>
  );
}
