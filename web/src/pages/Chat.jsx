import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { listOf, useApi, useMe, usd, priceLabel, ms, AUTO_MODELS, ago } from '../api.js';
import { Link, navigate } from '../router.jsx';
import { useChat, Message, Composer, PrivacyLine } from '../components/ChatCore.jsx';
import { loginPath } from './Login.jsx';
import { Machine, ShareBar, Icon } from '../components/ui.jsx';

const STORE = 'ml-chats';
const load = () => {
  try {
    return JSON.parse(localStorage.getItem(STORE) || '[]');
  } catch {
    return [];
  }
};
const save = (chats) => {
  try {
    localStorage.setItem(STORE, JSON.stringify(chats.slice(0, 50)));
  } catch {
    /* storage full or blocked */
  }
};
const newChat = (model) => ({ id: Math.random().toString(36).slice(2, 10), title: '', model, messages: [], updated: Date.now() });

const SUGGESTIONS = [
  ['chat', 'Explain', 'Explain embeddings to a new engineer in three sentences'],
  ['code', 'Code', 'Write a SQL query that finds duplicate emails'],
  ['bolt', 'Learn', 'What does 4-bit quantization trade away?'],
  ['pencil', 'Write', 'Draft a short, friendly payment reminder'],
];

// The crescent from the wordmark, ringed by slow orbits.
function MoonMark() {
  return (
    <span className="chat-moon" aria-hidden>
      <span className="moon-orbit" />
      <span className="moon-orbit moon-orbit-2" />
      <svg width="34" height="34" viewBox="0 0 24 24">
        <defs>
          <linearGradient id="chat-moon-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--accent-2)" />
            <stop offset="1" stopColor="var(--accent)" />
          </linearGradient>
        </defs>
        <path d="M15.4 2.4A10 10 0 1 0 21.6 16.9 8 8 0 0 1 15.4 2.4z" fill="url(#chat-moon-g)" />
      </svg>
    </span>
  );
}

// Live status for the chosen model: GPUs serving it right now and its median latency.
function LiveLine({ model, current, models, ready }) {
  if (!ready) return <span className="live-line skeleton" style={{ width: 220, height: 28 }} />;
  const auto = AUTO_MODELS.find((a) => a.id === model);
  const gpus = auto ? models.reduce((n, m) => n + m.sellers_online, 0) : (current?.sellers_online ?? 0);
  const live = auto ? models.filter((m) => m.sellers_online > 0).length : 0;
  return (
    <span className={`live-line ${gpus ? '' : 'off'}`}>
      <i className="live-dot" />
      <b className="num">{gpus}</b> {gpus === 1 ? 'GPU' : 'GPUs'} online
      <span className="live-sep" />
      {auto ? (
        <>
          <b className="num">{live}</b> {live === 1 ? 'model' : 'models'} live
        </>
      ) : (
        <>
          <span className="mono">{model}</span>
          {current?.p50_ms != null && <span className="faint num"> · p50 {ms(current.p50_ms)}</span>}
        </>
      )}
    </span>
  );
}

// Points the card's light at the cursor.
const spotlight = (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
};

const DAY = 86_400_000;
// Sidebar sections by last activity, newest first.
function groupByDay(chats, now = Date.now()) {
  const today = new Date(now).setHours(0, 0, 0, 0);
  const label = (t) => (t >= today ? 'Today' : t >= today - DAY ? 'Yesterday' : t >= today - 7 * DAY ? 'Previous 7 days' : 'Older');
  const groups = [];
  for (const c of chats) {
    const l = label(c.updated);
    if (groups.at(-1)?.[0] !== l) groups.push([l, []]);
    groups.at(-1)[1].push(c);
  }
  return groups;
}

// Until the catalog arrives the picker is a placeholder, so the default model never flashes and changes.
function PickerSkeleton() {
  return (
    <div className="picker" aria-busy="true" aria-label="Loading models">
      <span className="picker-btn picker-skeleton">
        <span className="skeleton" style={{ width: 128, height: 16 }} />
        <span className="skeleton" style={{ width: 92, height: 10 }} />
      </span>
    </div>
  );
}

function ModelPicker({ value, onChange, models }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const auto = AUTO_MODELS.find((a) => a.id === value);
  const current = models.find((m) => m.id === value);
  const choose = (id) => {
    onChange(id);
    setOpen(false);
  };
  return (
    <div className="picker" ref={ref}>
      <button type="button" className="picker-btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="picker-label">{auto ? auto.label : value}</span>
        <span className="picker-sub">{auto ? auto.hint : current ? `${current.sellers_online} ${current.sellers_online === 1 ? 'GPU' : 'GPUs'} online` : 'Not online'}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
          <path d="M2.5 4.5L6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </button>
      {open && (
        <div className="picker-pop" role="listbox" aria-label="Model">
          <p className="picker-group">Automatic</p>
          {AUTO_MODELS.filter((a) => a.kind === 'chat').map((a) => (
            <button key={a.id} type="button" role="option" aria-selected={value === a.id} className="picker-opt" onClick={() => choose(a.id)}>
              <span className="opt-name">{a.label}</span>
              <span className="opt-meta">{a.hint}</span>
            </button>
          ))}
          <p className="picker-group">Choose a model</p>
          {models.map((m) => {
            const price = priceLabel(m.price_from, m.kind);
            return (
              <button key={m.id} type="button" role="option" aria-selected={value === m.id} className="picker-opt" onClick={() => choose(m.id)} disabled={!m.sellers_online}>
                <span className="opt-name">
                  {m.id}
                  {m.thinking && <span className="tag">thinks</span>}
                </span>
                <span className="opt-meta num">
                  <Machine online={m.sellers_online > 0} size={12} /> {m.sellers_online} · from {price.amount} {price.unit} · {ms(m.p50_ms)}
                </span>
                <ShareBar share={m.verified_share} total={m.sellers_online} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ChatWindow({ chat, onUpdate, models, ready, me }) {
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [model, setModel] = useState(chat.model);
  const { messages, send, retry, edit, stop, busy } = useChat({
    model,
    verifiedOnly,
    messages: chat.messages.map((m) => (['waiting', 'queued', 'dispatched', 'thinking', 'streaming'].includes(m.status) ? { ...m, status: m.content ? 'stopped' : 'cancelled' } : m)),
    onChange: (msgs) => onUpdate({ ...chat, model, messages: msgs, title: chat.title || msgs.find((x) => x.role === 'user')?.content.slice(0, 60) || '', updated: Date.now() }),
  });
  // A fresh chat on "any large model" falls back to small ones when no large model is online.
  // Layout effect: the switch lands before the first paint with the catalog.
  useLayoutEffect(() => {
    if (messages.length || model !== 'auto/chat-large' || !models.length) return;
    if (!models.some((m) => m.sellers_online > 0 && (m.params_b ?? 0) > 9)) setModel('auto/chat-small');
  }, [models]); // eslint-disable-line react-hooks/exhaustive-deps
  const scroller = useRef(null);
  const stick = useRef(true);
  const [away, setAway] = useState(false);
  const [seed, setSeed] = useState(null);
  useEffect(() => {
    const el = scroller.current;
    // An empty chat stays at the top so the greeting is never scrolled away on short screens.
    if (el && stick.current && messages.length) el.scrollTop = el.scrollHeight;
  }, [messages]);
  const toBottom = () => {
    const el = scroller.current;
    stick.current = true;
    el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };
  // Esc stops an answer; "/" jumps to the composer from anywhere outside a text field.
  useEffect(() => {
    const key = (e) => {
      if (e.key === 'Escape' && busy) stop();
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.target.closest('input, textarea, select, [contenteditable]')) {
        e.preventDefault();
        document.querySelector('.chat-foot .composer-input')?.focus();
      }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [busy, stop]);
  const current = models.find((m) => m.id === model);
  // The composer's model menu: the automatic choices, then every model with a GPU online.
  const composerModels = [
    ...AUTO_MODELS.filter((a) => a.kind === 'chat').map((a) => ({ id: a.id, label: a.label })),
    ...models.filter((m) => m.sellers_online > 0).map((m) => ({ id: m.id, label: m.id })),
  ];
  return (
    <section className={`chat-main ${messages.length ? '' : 'is-empty'}`}>
      <header className="chat-bar">
        {ready ? <ModelPicker value={model} onChange={setModel} models={models} /> : <PickerSkeleton />}
        {me && (
          <span className="chat-balance" title="Your balance">
            Balance <b className="num">{usd(me.balance_microusd, 6)}</b>
          </span>
        )}
      </header>
      <div
        className="chat-scroll"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          setAway(!stick.current);
        }}
      >
        <div className="chat-col">
          {messages.length === 0 ? (
            <div className="chat-empty">
              <span className="chat-orb" aria-hidden />
              <MoonMark />
              <LiveLine model={model} current={current} models={models} ready={ready} />
              <h1 className="chat-hello">What do you want to run?</h1>
              <p className="chat-sub">Ask anything. Moonlight sends it to a verified GPU that&apos;s free right now.</p>
              {models.length > 0 && !models.some((m) => m.sellers_online > 0) && (
                <p className="notice">
                  No GPU is online right now, so messages can&apos;t be served yet. <Link to="/add">Add your GPU</Link> to be the first.
                </p>
              )}
              <div className="suggest">
                {SUGGESTIONS.map(([icon, title, s], i) => (
                  <button
                    key={s}
                    type="button"
                    className="suggest-card"
                    style={{ animationDelay: `${160 + i * 70}ms` }}
                    onPointerMove={spotlight}
                    onClick={() => (me ? send(s) : navigate(loginPath('/chat')))}
                  >
                    <span className="suggest-icon">
                      <Icon name={icon} size={15} />
                    </span>
                    <span className="suggest-title">{title}</span>
                    <Icon name="arrow" size={14} className="suggest-go" />
                    <span className="suggest-text">{s}</span>
                  </button>
                ))}
              </div>
              <p className="chat-keys" aria-label="Keyboard shortcuts">
                <span>
                  <kbd>↵</kbd> send
                </span>
                <span>
                  <kbd>⇧</kbd>
                  <kbd>↵</kbd> new line
                </span>
                <span>
                  <kbd>/</kbd> focus
                </span>
                <span>
                  <kbd>Esc</kbd> stop
                </span>
              </p>
            </div>
          ) : (
            messages.map((m, i) => (
              <Message
                key={m.id}
                m={m}
                last={i === messages.length - 1}
                onEdit={busy ? null : (id) => setSeed({ text: edit(id) })}
                onRetry={(id) => retry(id)}
                onSuggest={(id, s) => {
                  setModel(s);
                  retry(id, s);
                }}
              />
            ))
          )}
        </div>
      </div>
      <footer className="chat-foot">
        {away && messages.length > 0 && (
          <button type="button" className="to-bottom" onClick={toBottom} aria-label="Jump to the latest message">
            <Icon name="down" size={15} />
          </button>
        )}
        <div className="chat-col">
          {me ? (
            <Composer
              onSend={(t) => {
                stick.current = true;
                send(t);
              }}
              onStop={stop}
              busy={busy}
              autoFocus
              draftKey={`ml-draft-${chat.id}`}
              seed={seed}
              models={ready ? composerModels : undefined}
              model={model}
              onModel={setModel}
              placeholder={ready ? `Message ${AUTO_MODELS.find((a) => a.id === model)?.label.toLowerCase() || model}` : 'Message'}
            />
          ) : (
            me === null && (
              <Link to={loginPath('/chat')} className="composer composer-cta">
                <span>Sign in to chat</span>
                <span className="composer-btn" aria-hidden>
                  <svg width="18" height="18" viewBox="0 0 16 16">
                    <path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              </Link>
            )
          )}
          <PrivacyLine verifiedOnly={verifiedOnly} setVerifiedOnly={setVerifiedOnly} />
        </div>
      </footer>
    </section>
  );
}

export default function Chat() {
  const { me } = useMe();
  const { data } = useApi('/api/models', { interval: 30_000 });
  const models = useMemo(
    () => listOf(data, 'models').filter((m) => m.kind === 'chat' && !m.auto).sort((a, b) => b.sellers_online - a.sellers_online),
    [data],
  );
  const initialModel = new URLSearchParams(location.search).get('model') || 'auto/chat-large';
  const [chats, setChats] = useState(() => {
    const saved = load();
    return saved.length ? saved : [newChat(initialModel)];
  });
  const [currentId, setCurrentId] = useState(() => {
    const q = new URLSearchParams(location.search).get('model');
    return q ? null : chats[0]?.id;
  });
  const [drawer, setDrawer] = useState(false);
  const [query, setQuery] = useState('');

  // Arriving with ?model= starts a fresh conversation on that model.
  useEffect(() => {
    if (currentId) return;
    const c = newChat(initialModel);
    setChats((cs) => [c, ...cs]);
    setCurrentId(c.id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => save(chats.filter((c) => c.messages.length)), [chats]);
  const current = chats.find((c) => c.id === currentId) || chats[0];

  const start = () => {
    const empty = chats.find((c) => !c.messages.length);
    if (empty) setCurrentId(empty.id);
    else {
      const c = newChat(current?.model || 'auto/chat-large');
      setChats((cs) => [c, ...cs]);
      setCurrentId(c.id);
    }
    setDrawer(false);
  };
  const remove = (id) => {
    setChats((cs) => {
      const rest = cs.filter((c) => c.id !== id);
      return rest.length ? rest : [newChat('auto/chat-large')];
    });
    if (id === currentId) setCurrentId(null);
  };
  useEffect(() => {
    if (!chats.some((c) => c.id === currentId)) setCurrentId(chats[0]?.id);
  }, [chats, currentId]);

  const saved = chats.filter((c) => c.messages.length).sort((a, b) => b.updated - a.updated);
  // The query only applies while the search box shows, so deleting down to 4 chats can't leave a hidden filter.
  const q = saved.length > 4 ? query.trim().toLowerCase() : '';
  // ponytail: scans every message of up to 50 saved chats per keystroke; fine at this size.
  const shown = q ? saved.filter((c) => c.title.toLowerCase().includes(q) || c.messages.some((m) => m.content?.toLowerCase().includes(q))) : saved;

  return (
    <main className={`chat-page ${drawer ? 'drawer-open' : ''}`}>
      <aside className="chat-side" aria-label="Conversations">
        <button type="button" className="btn btn-small btn-primary new-chat" onClick={start}>
          <span className="new-chat-plus" aria-hidden>
            +
          </span>
          New chat
        </button>
        {saved.length === 0 && (
          <div className="chat-side-empty">
            <span className="chat-side-empty-icon">
              <Icon name="chat" size={16} />
            </span>
            <b>No chats yet</b>
            <span className="faint small">Your conversations will show up here.</span>
          </div>
        )}
        {saved.length > 4 && (
          <label className="chat-search">
            <Icon name="search" size={14} />
            <input type="search" placeholder="Search chats" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search chats" />
          </label>
        )}
        {q && shown.length === 0 && <p className="faint small chat-none">No chats match “{query}”.</p>}
        {groupByDay(shown).map(([label, group]) => (
          <section key={label} className="chat-group">
            <h2 className="chat-group-label">{label}</h2>
            <ol className="chat-list">
              {group.map((c) => (
                <li key={c.id} className={c.id === current?.id ? 'on' : ''}>
                  <button
                    type="button"
                    className="chat-item"
                    onClick={() => {
                      setCurrentId(c.id);
                      setDrawer(false);
                    }}
                  >
                    <span className="chat-item-title">{c.title || 'New chat'}</span>
                    <span className="chat-item-meta">
                      {c.model.replace('auto/', 'auto · ')} · {ago(c.updated)}
                    </span>
                  </button>
                  <button type="button" className="chat-del" onClick={() => remove(c.id)} aria-label={`Delete “${c.title}”`}>
                    ×
                  </button>
                </li>
              ))}
            </ol>
          </section>
        ))}
        <p className="chat-side-note faint small">
          <Icon name="shield" size={13} /> Conversations stay in this browser.
        </p>
        <Link to="/models" className="chat-side-link">
          <Icon name="gpu" size={14} /> Browse all models <Icon name="arrow" size={12} className="chat-side-link-go" />
        </Link>
      </aside>
      <button type="button" className="drawer-btn ghost" onClick={() => setDrawer((d) => !d)} aria-expanded={drawer}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
          <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.6" />
        </svg>
        Chats
      </button>
      {current && (
        <ChatWindow key={current.id} chat={current} models={models} ready={!!data} me={me} onUpdate={(c) => setChats((cs) => cs.map((x) => (x.id === c.id ? c : x)))} />
      )}
      <div className="drawer-scrim" onClick={() => setDrawer(false)} aria-hidden />
    </main>
  );
}

