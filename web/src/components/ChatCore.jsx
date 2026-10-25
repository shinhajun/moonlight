// Chat engine shared by the Chat page and model playgrounds: streaming, reasoning, queueing,
// capacity errors, failover notes, and a receipt per answer naming the GPU that served it.
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { api, requestError, streamChat, usd, ms, hardware, int, refreshMe, AUTO_MODELS, MAX_WAIT_S } from '../api.js';
import { Link } from '../router.jsx';
import { Badge, Machine, Icon, useNow, useCopied } from './ui.jsx';

const uid = () => Math.random().toString(36).slice(2, 10);

// Names for the ids in a final chunk: look the node up in the served model's listings.
const nodeCache = new Map();
export async function resolveNode(model_id, node_id) {
  if (!model_id || !node_id) return null;
  let entry = nodeCache.get(model_id);
  if (!entry || Date.now() - entry.at > 30_000) {
    entry = { at: Date.now(), p: api(`/api/models/${encodeURIComponent(model_id)}`).catch(() => ({ listings: [] })) };
    nodeCache.set(model_id, entry);
  }
  const d = await entry.p;
  return d.listings?.find((l) => l.node?.node_id === node_id) || null;
}

const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;

export function useChat({ model, verifiedOnly = false, seller, messages: initial = [], onChange }) {
  const [messages, setMessages] = useState(initial);
  const abort = useRef(null);
  const latest = useRef(messages);
  latest.current = messages;
  const busy = messages.some((m) => m.role === 'assistant' && ['queued', 'waiting', 'dispatched', 'thinking', 'streaming'].includes(m.status));

  useEffect(() => {
    onChange?.(messages);
  }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (id, fn) => setMessages((ms) => ms.map((m) => (m.id === id ? { ...m, ...fn(m) } : m)));

  const run = useCallback(
    async (history, useModel) => {
      const id = uid();
      const t0 = performance.now();
      setMessages((ms) => [...ms, { id, role: 'assistant', content: '', reasoning: '', status: 'waiting', model: useModel, t0: Date.now() }]);
      const ctrl = new AbortController();
      abort.current = ctrl;
      let first = null;
      let thinkStart = null;
      let thinkEnd = null;
      try {
        const body = {
          model: useModel,
          messages: history.map(({ role, content }) => ({ role, content })),
          moonlight: { max_wait_s: MAX_WAIT_S, ...(verifiedOnly ? { verified_only: true } : {}), ...(seller ? { seller } : {}) },
        };
        let final = null;
        await streamChat('/api/playground/chat', body, {
          signal: ctrl.signal,
          onQueue: (q) => update(id, () => ({ status: 'queued', queue: q })),
          // Dispatched to a GPU but no token yet: it may be loading the model into VRAM.
          onWaiting: (w) =>
            update(id, (m) => (m.content || m.reasoning ? {} : { status: 'dispatched', warm: { model: w.model, since: m.warm?.since ?? Date.now() - w.elapsed_s * 1000 } })),
          onChunk: (c) => {
            if (c.error) {
              final = { error: c.error, moonlight: c.moonlight };
              return;
            }
            const d = c.choices?.[0]?.delta || {};
            if (d.reasoning) {
              thinkStart ??= performance.now();
              update(id, (m) => ({ reasoning: m.reasoning + d.reasoning, status: 'thinking' }));
            }
            if (d.content) {
              if (thinkStart && !thinkEnd) thinkEnd = performance.now();
              first ??= performance.now();
              update(id, (m) => ({ content: m.content + d.content, status: 'streaming' }));
            }
            if (c.moonlight || c.usage) final = { ...c, served: c.model };
          },
        });
        if (final?.error) throw Object.assign(new Error(final.error.message), { code: final.error.code, body: final });
        const ml = final?.moonlight || {};
        const meta = {
          cost: ml.cost,
          seller: ml.seller,
          node: ml.node,
          verified: ml.verified,
          served_model: ml.served_model || final?.served || useModel,
          failovers: ml.failovers || [],
          first_ms: first ? first - t0 : null,
          total_ms: performance.now() - t0,
          think_ms: thinkStart ? (thinkEnd || first || performance.now()) - thinkStart : null,
          output_tokens: final?.usage?.completion_tokens,
        };
        update(id, () => ({ status: ml.error === 'seller_lost' ? 'lost' : 'done', meta: { ...meta, badge: ml.badge } }));
        refreshMe();
        const listing = await resolveNode(meta.served_model, meta.node);
        if (listing) update(id, (m) => ({ meta: { ...m.meta, node_name: listing.node.name, seller_name: listing.seller.name, hardware: hardware(listing.node), badge: m.meta.badge || listing.verification?.state } }));
      } catch (e) {
        if (e.name === 'AbortError') {
          update(id, (m) => ({ status: m.content ? 'stopped' : 'cancelled' }));
          return;
        }
        // Before the stream opened (a 503/402/429/5xx response) or in it (an error chunk): either way, say so now.
        update(id, () => ({
          status: e.code === 'no_capacity' ? 'no_capacity' : 'error',
          error: { message: e.message, code: e.code, status: e.status, retryAfter: e.retryAfter, reason: e.body?.moonlight?.reason, suggestions: e.body?.moonlight?.suggestions || [] },
        }));
      } finally {
        abort.current = null;
      }
    },
    [verifiedOnly, seller],
  );

  const send = (text, useModel = model) => {
    if (!text.trim() || busy) return;
    const user = { id: uid(), role: 'user', content: text.trim() };
    const history = [...latest.current.filter((m) => m.role === 'user' || m.status === 'done' || m.status === 'stopped'), user];
    setMessages((ms) => [...ms, user]);
    run(history, useModel);
  };

  // Re-asks the question an assistant message answered, optionally on another model.
  const retry = (assistantId, useModel = model) => {
    const all = latest.current;
    const i = all.findIndex((m) => m.id === assistantId);
    const kept = all.slice(0, i);
    setMessages(kept);
    run(kept.filter((m) => m.role === 'user' || m.status === 'done'), useModel);
  };

  // Drops a user message and everything after it, and hands back its text to edit and resend.
  const edit = (userId) => {
    const all = latest.current;
    const i = all.findIndex((m) => m.id === userId);
    if (i < 0 || busy) return '';
    setMessages(all.slice(0, i));
    return all[i].content;
  };

  const stop = () => abort.current?.abort();
  return { messages, setMessages, send, retry, edit, stop, busy };
}

// ---------------------------------------------------------------- tiny markdown

function inline(text, keyBase) {
  const out = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g;
  let last = 0;
  let m;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('`')) out.push(<code key={`${keyBase}-${k++}`}>{t.slice(1, -1)}</code>);
    else if (t.startsWith('**')) out.push(<strong key={`${keyBase}-${k++}`}>{t.slice(2, -2)}</strong>);
    else out.push(<em key={`${keyBase}-${k++}`}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function CodeBlock({ lang, code }) {
  const [copied, copy] = useCopied();
  return (
    <div className="md-code">
      <div className="md-code-head">
        <span>{lang || 'code'}</span>
        <button type="button" className="md-code-copy" onClick={() => copy(code)} aria-label={copied ? 'Copied' : 'Copy code'}>
          <Icon name={copied ? 'check' : 'copy'} size={13} /> {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function Action({ icon, label, onClick }) {
  return (
    <button type="button" className="msg-act" onClick={onClick} aria-label={label} title={label}>
      <Icon name={icon} size={14} />
    </button>
  );
}

function CopyAction({ text }) {
  const [copied, copy] = useCopied();
  return <Action icon={copied ? 'check' : 'copy'} label={copied ? 'Copied' : 'Copy'} onClick={() => copy(text)} />;
}

export function Markdown({ text }) {
  const parts = text.split(/```/);
  return (
    <div className="md">
      {parts.map((part, i) => {
        if (i % 2 === 1) {
          const nl = part.indexOf('\n');
          const lang = nl > 0 ? part.slice(0, nl).trim() : '';
          const code = nl >= 0 ? part.slice(nl + 1) : part;
          return <CodeBlock key={i} lang={lang} code={code.replace(/\n$/, '')} />;
        }
        return part
          .split(/\n{2,}/)
          .filter((b) => b.trim())
          .map((block, j) => {
            const lines = block.split('\n');
            if (lines.every((l) => /^\s*([-*]|\d+\.)\s+/.test(l))) {
              const ordered = /^\s*\d+\./.test(lines[0]);
              const L = ordered ? 'ol' : 'ul';
              return (
                <L key={`${i}-${j}`}>
                  {lines.map((l, k) => (
                    <li key={k}>{inline(l.replace(/^\s*([-*]|\d+\.)\s+/, ''), `${i}-${j}-${k}`)}</li>
                  ))}
                </L>
              );
            }
            return (
              <p key={`${i}-${j}`}>
                {lines.map((l, k) => (
                  <Fragment key={k}>
                    {k > 0 && <br />}
                    {inline(l, `${i}-${j}-${k}`)}
                  </Fragment>
                ))}
              </p>
            );
          });
      })}
    </div>
  );
}

// ---------------------------------------------------------------- message views

function Queue({ q }) {
  return (
    <div className="queue" role="status">
      <span className="queue-line" aria-hidden>
        {Array.from({ length: Math.min(5, q.position + 1) }, (_, i) => (
          <i key={i} className={i === q.position ? 'you' : ''} />
        ))}
      </span>
      <span>
        In line · <b>{ordinal(q.position)}</b>
        {q.eta_s != null && <> · ~{q.eta_s} s</>}
      </span>
    </div>
  );
}

// Before the stream opens: the request is on its way to a GPU. Counts up once it takes a while.
function Finding({ since }) {
  const now = useNow(1000);
  const s = Math.round((now - since) / 1000);
  return (
    <div className="waiting" role="status">
      <span className="dots" aria-hidden>
        <i />
        <i />
        <i />
      </span>
      Finding a free GPU…{s >= 3 && <span className="num faint"> {s} s</span>}
    </div>
  );
}

function Warming({ warm, model }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.round((now - warm.since) / 1000));
  if (s < 3) {
    return (
      <div className="waiting" role="status">
        <span className="dots" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        Sent to a seller&apos;s GPU…
      </div>
    );
  }
  return (
    <div className="warming" role="status">
      <div className="warming-row">
        <span>
          Loading {warm.model && warm.model !== model ? <span className="mono">{warm.model}</span> : 'the model'} on the seller&apos;s GPU…
        </span>
        <span className="num">{s} s</span>
      </div>
      <span className="warming-bar" aria-hidden />
      <p>The first request loads the model into VRAM. The next ones are fast.</p>
    </div>
  );
}

function Reasoning({ text, active, ms: thinkMs }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <div className={`reasoning ${active ? 'active' : ''}`}>
      <button type="button" className="reasoning-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open || active}>
        <span className="reasoning-dot" aria-hidden />
        {active ? 'Thinking…' : `Thought for ${thinkMs ? ms(thinkMs) : 'a moment'}`}
        {!active && <Icon name="arrow" size={11} className={open ? 'rot' : ''} />}
      </button>
      {(open || active) && <p className="reasoning-text">{active ? text.slice(-320) : text}</p>}
    </div>
  );
}

function Receipt({ meta, model }) {
  const name = meta.node_name;
  return (
    <div className="receipt">
      <span className="receipt-who">
        <Machine online size={14} />
        {name ? (
          <>
            <b>{name}</b>
            <span className="faint">{meta.hardware}</span>
          </>
        ) : (
          <span className="faint">a seller&apos;s GPU</span>
        )}
      </span>
      <span className="receipt-facts num">
        {meta.served_model && meta.served_model !== model && <span>{meta.served_model}</span>}
        {meta.first_ms != null && <span>first word {ms(meta.first_ms)}</span>}
        {meta.output_tokens != null && <span>{int(meta.output_tokens)} tokens</span>}
        {meta.cost != null && <b>{usd(meta.cost)}</b>}
      </span>
      {meta.badge && <Badge state={meta.badge} size="sm" />}
    </div>
  );
}

export function Message({ m, onRetry, onSuggest, onEdit, last }) {
  if (m.role === 'user') {
    return (
      <div className="msg msg-user">
        <div className="msg-slip">{m.content}</div>
        <div className="msg-acts">
          <CopyAction text={m.content} />
          {onEdit && <Action icon="pencil" label="Edit and resend" onClick={() => onEdit(m.id)} />}
        </div>
      </div>
    );
  }
  const streaming = ['thinking', 'streaming'].includes(m.status);
  return (
    <div className={`msg msg-bot status-${m.status}`}>
      {m.status === 'waiting' && <Finding since={m.t0} />}
      {m.status === 'queued' && m.queue && <Queue q={m.queue} />}
      {m.status === 'dispatched' && m.warm && <Warming warm={m.warm} model={m.model} />}
      <Reasoning text={m.reasoning} active={m.status === 'thinking'} ms={m.meta?.think_ms} />
      {m.content && (
        <div className={streaming ? 'is-streaming' : ''}>
          <Markdown text={m.content} />
        </div>
      )}
      {m.meta?.failovers?.length > 0 && (
        <p className="failover-note" title={m.meta.failovers.map((f) => `${f.from_node} → ${f.to_node} at token ${f.at_token}`).join('\n')}>
          <Icon name="arrow" size={12} /> Switched to another GPU mid-answer. Nothing was repeated or billed twice.
        </p>
      )}
      {m.status === 'lost' && (
        <div className="notice warn">
          <Icon name="flagged" />
          <div>
            The GPU answering this went offline and no other was free. You were billed only for the words above.{' '}
            <button type="button" className="link" onClick={() => onRetry(m.id)}>
              Retry
            </button>
          </div>
        </div>
      )}
      {m.status === 'no_capacity' && (
        <div className="capacity">
          <p>
            <b>{requestError(m.error, m.model)}</b>{' '}
            {m.error?.reason === 'busy' ? (
              <>
                <button type="button" className="link" onClick={() => onRetry(m.id)}>
                  Try again
                </button>{' '}
                or use one of these:
              </>
            ) : (
              'Try one of these:'
            )}
          </p>
          <div className="chips">
            {(m.error?.suggestions?.length ? m.error.suggestions : AUTO_MODELS.filter((a) => a.kind === 'chat').map((a) => a.id)).map((s) => (
              <button key={s} type="button" className="chip" onClick={() => onSuggest(m.id, s)}>
                {AUTO_MODELS.find((a) => a.id === s)?.label || s}
              </button>
            ))}
          </div>
        </div>
      )}
      {m.status === 'error' && (
        <div className="notice warn">
          <Icon name="flagged" />
          <div>
            {requestError(m.error, m.model)}{' '}
            {m.error?.status === 402 ? (
              <Link to="/me/buy" className="link">
                See your balance
              </Link>
            ) : (
              <button type="button" className="link" onClick={() => onRetry(m.id)}>
                Try again
              </button>
            )}
          </div>
        </div>
      )}
      {(m.status === 'done' || m.status === 'lost' || m.status === 'stopped') && m.meta && <Receipt meta={m.meta} model={m.model} />}
      {m.status === 'stopped' && <p className="faint small">Stopped.</p>}
      {['done', 'stopped', 'lost'].includes(m.status) && m.content && (
        <div className={`msg-acts ${last ? 'on' : ''}`}>
          <CopyAction text={m.content} />
          {last && <Action icon="retry" label="Regenerate" onClick={() => onRetry(m.id)} />}
        </div>
      )}
    </div>
  );
}

const readDraft = (key) => {
  try {
    return (key && sessionStorage.getItem(key)) || '';
  } catch {
    return '';
  }
};

// `draftKey` keeps unsent text per conversation for this tab; `seed` ({ text }) replaces the text, e.g. to edit a sent message.
export function Composer({ onSend, onStop, busy, disabled, placeholder = 'Ask anything…', autoFocus, draftKey, seed }) {
  const [text, setText] = useState(() => readDraft(draftKey));
  const ref = useRef(null);
  useEffect(() => {
    if (!draftKey) return;
    try {
      if (text) sessionStorage.setItem(draftKey, text);
      else sessionStorage.removeItem(draftKey);
    } catch {
      /* storage blocked */
    }
  }, [text, draftKey]);
  useEffect(() => {
    if (!seed) return;
    setText(seed.text);
    const el = ref.current;
    el?.focus();
    requestAnimationFrame(() => el?.setSelectionRange(seed.text.length, seed.text.length));
  }, [seed]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(220, el.scrollHeight)}px`;
  }, [text]);
  const submit = (e) => {
    e?.preventDefault();
    if (busy || disabled || !text.trim()) return;
    onSend(text);
    setText('');
  };
  return (
    <form className={`composer ${busy ? 'is-busy' : ''}`} onSubmit={submit}>
      <textarea
        ref={ref}
        className="composer-input"
        rows={1}
        value={text}
        autoFocus={autoFocus}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) submit(e);
        }}
        aria-label="Message"
      />
      {busy ? (
        <button type="button" className="composer-btn stop" onClick={onStop} aria-label="Stop">
          <span className="stop-square" />
        </button>
      ) : (
        <button className="composer-btn" disabled={disabled || !text.trim()} aria-label="Send">
          <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden>
            <path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </form>
  );
}

export function PrivacyLine({ verifiedOnly, setVerifiedOnly, disabledVerified }) {
  return (
    <div className="privacy">
      <span className="privacy-text">
        <Icon name="eye" size={14} /> Runs on a seller&apos;s GPU. The seller can see your prompt.
      </span>
      {setVerifiedOnly && (
        <button
          type="button"
          role="switch"
          aria-checked={verifiedOnly}
          className="switch"
          onClick={() => setVerifiedOnly(!verifiedOnly)}
          disabled={disabledVerified}
          title={disabledVerified ? 'Private models are checked for consistency only' : 'Only route to GPUs that passed verification'}
        >
          <span className="track" />
          Verified only
        </button>
      )}
    </div>
  );
}
