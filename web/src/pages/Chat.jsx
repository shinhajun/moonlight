import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { listOf, useApi, useMe, usd, priceLabel, ms, AUTO_MODELS, ago } from '../api.js';
import { Link, navigate } from '../router.jsx';
import { useChat, Message, Composer, PrivacyLine } from '../components/ChatCore.jsx';
import { loginPath } from './Login.jsx';
import { House, VerifiedRivets } from '../components/ui.jsx';

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
  'Explain the putting-out system in three sentences',
  'Write a haiku about a laptop that never sleeps',
  'Draft a Python function that formats micro-dollars',
  'What should I ask a model running on a stranger’s computer?',
];

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
        <span className="picker-sub">{auto ? auto.hint : current ? `${current.sellers_online} ${current.sellers_online === 1 ? 'computer' : 'computers'} online` : 'Not online'}</span>
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
                  <House lit={m.sellers_online > 0} size={12} /> {m.sellers_online} · from {price.amount} {price.unit} · {ms(m.p50_ms)}
                </span>
                <VerifiedRivets share={m.verified_share} total={m.sellers_online} />
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
  const { messages, send, retry, stop, busy } = useChat({
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
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);
  const current = models.find((m) => m.id === model);
  return (
    <section className="chat-main">
      <header className="chat-bar">
        {ready ? <ModelPicker value={model} onChange={setModel} models={models} /> : <PickerSkeleton />}
        <span className="chat-balance num" title="Your balance">
          {me ? usd(me.balance_microusd, 6) : ''}
        </span>
      </header>
      <div
        className="chat-scroll"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        <div className="chat-col">
          {messages.length === 0 ? (
            <div className="chat-empty">
              <p className="kicker">Night shift</p>
              <h1 className="chat-hello">What should tonight&apos;s shift work on?</h1>
              {models.length > 0 && !models.some((m) => m.sellers_online > 0) && (
                <p className="notice">
                  No computer is online right now. Messages wait in line for up to 30 seconds. <Link to="/add">Sell your computer</Link> to light the first lamp.
                </p>
              )}
              <p className="muted">
                {AUTO_MODELS.some((a) => a.id === model)
                  ? 'Moonlight picks whichever verified computer is free.'
                  : current
                    ? `${current.sellers_online} home ${current.sellers_online === 1 ? 'computer is' : 'computers are'} serving ${model} right now.`
                    : ''}
              </p>
              <div className="chips">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" className="chip" onClick={() => (me ? send(s) : navigate(loginPath('/chat')))}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m) => (
              <Message
                key={m.id}
                m={m}
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
        <div className="chat-col">
          {me ? (
            <Composer
              onSend={(t) => send(t)}
              onStop={stop}
              busy={busy}
              autoFocus
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

  return (
    <main className={`chat-page ${drawer ? 'drawer-open' : ''}`}>
      <aside className="chat-side" aria-label="Conversations">
        <button type="button" className="btn btn-small btn-primary new-chat" onClick={start}>
          + New chat
        </button>
        <ol className="chat-list">
          {chats
            .filter((c) => c.messages.length)
            .sort((a, b) => b.updated - a.updated)
            .map((c) => (
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
        <p className="chat-side-note faint small">Conversations stay in this browser.</p>
        <Link to="/models" className="ghost">
          Browse all models
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

