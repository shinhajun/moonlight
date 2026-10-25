import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

// The chat composer as a pill that springs open on focus: a tools row (model, effort, images) slides in under
// the text, image thumbs ride in a tab behind the card, and dictation fills the text while bars show mic levels.
// Controlled: the caller owns the text (drafts, editing a sent message). Styles live in ui.css (.prompt-*); the
// card reuses .composer for its glass, focus ring and busy ring.

export interface PromptModel {
  id: string;
  label: string;
}

export interface PromptMeta {
  model?: string;
  effort: string;
  attachments: File[];
}

interface Attachment {
  id: string;
  file: File;
  url: string;
  w: number;
  h: number;
}

export interface PromptInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string, meta: PromptMeta) => void;
  onStop?: () => void;
  busy?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  // Without models the model menu is hidden (a page that serves one fixed model).
  models?: PromptModel[];
  model?: string;
  onModel?: (id: string) => void;
  efforts?: string[];
  maxAttachments?: number;
}

const SpeechRecognition = typeof window === 'undefined' ? null : (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
const BANDS = 5;
const quiet = () => new Array(BANDS).fill(0);

const ArrowUp = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
    <path d="M7 12V2M7 2L2.5 6.5M7 2L11.5 6.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const Mic = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
    <rect x="5" y="1" width="4" height="7" rx="2" stroke="currentColor" strokeWidth="1.5" />
    <path d="M2.75 6.5V7a4.25 4.25 0 0 0 8.5 0v-.5M7 11.25V13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);
const Plus = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
    <path d="M7 2.5V11.5M2.5 7H11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);
const Close = ({ size = 9 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden>
    <path d="M2.5 2.5L11.5 11.5M11.5 2.5L2.5 11.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);
// Effort as three bars, lit up to the chosen level.
const Bars = ({ level }: { level: number }) => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden className="prompt-bars">
    <rect x="1.5" y="8" width="2.5" height="4.5" rx="1" fill="currentColor" />
    <rect x="5.75" y="5" width="2.5" height="7.5" rx="1" fill="currentColor" opacity={level >= 1 ? 1 : 0.3} />
    <rect x="10" y="2" width="2.5" height="10.5" rx="1" fill="currentColor" opacity={level >= 2 ? 1 : 0.3} />
  </svg>
);

// The opened image grows out of its thumbnail and shrinks back into it (FLIP on box geometry, so nothing stretches).
function Preview({ a, from, onClose }: { a: Attachment; from: DOMRect; onClose: () => void }) {
  const img = useRef<HTMLImageElement>(null);
  const bg = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  const scale = Math.min(Math.min(innerWidth * 0.86, 560) / a.w, Math.min(innerHeight * 0.78, 720) / a.h, 1.6);
  const to = { width: a.w * scale, height: a.h * scale, left: (innerWidth - a.w * scale) / 2, top: (innerHeight - a.h * scale) / 2 };
  const start = { width: from.width, height: from.height, left: from.left, top: from.top, borderRadius: '12px' };
  const end = { ...to, borderRadius: '20px' };
  const ms = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1;
  const px = (k: Record<string, number | string>) => Object.fromEntries(Object.entries(k).map(([p, v]) => [p, typeof v === 'number' ? `${v}px` : v]));

  useLayoutEffect(() => {
    img.current?.animate([px(start), px(end)], { duration: 450 * ms, easing: 'cubic-bezier(0.175, 0.885, 0.32, 1.275)' });
    bg.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 350 * ms });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => {
    if (closing.current) return;
    closing.current = true;
    bg.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 280 * ms, fill: 'forwards' });
    const anim = img.current?.animate([px(end), px(start)], { duration: 280 * ms, easing: 'ease-out', fill: 'forwards' });
    if (anim) anim.onfinish = onClose;
    else onClose();
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // Portaled: the card's backdrop-filter would otherwise make it the box for position: fixed.
  return createPortal(
    <div className="prompt-preview" role="dialog" aria-modal="true" aria-label={a.file.name} onClick={close}>
      <div ref={bg} className="prompt-preview-bg" />
      <img ref={img} src={a.url} alt={a.file.name} style={px(end)} draggable={false} onClick={(e) => e.stopPropagation()} />
      <button type="button" className="prompt-preview-close" onClick={close} aria-label="Close preview" autoFocus>
        <Close size={12} />
      </button>
    </div>,
    document.body,
  );
}

function ModelMenu({ models, model, onModel, open, setOpen }: { models: PromptModel[]; model?: string; onModel?: (id: string) => void; open: boolean; setOpen: (o: boolean) => void }) {
  const [hover, setHover] = useState(-1);
  return (
    <div className={`prompt-menu ${open ? 'on' : ''}`} role="listbox" aria-label="Model" onMouseLeave={() => setHover(-1)}>
      <span className="prompt-hover" style={{ opacity: hover < 0 ? 0 : 1, transform: `translateY(${Math.max(0, hover) * 34}px)` }} aria-hidden />
      {models.map((m, i) => (
        <button
          key={m.id}
          type="button"
          role="option"
          aria-selected={m.id === model}
          tabIndex={open ? 0 : -1}
          className="prompt-opt"
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => setHover(i)}
          onClick={() => {
            onModel?.(m.id);
            setOpen(false);
          }}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

export function PromptInput({
  value,
  onChange,
  onSubmit,
  onStop,
  busy = false,
  disabled = false,
  autoFocus,
  placeholder = 'Ask anything',
  inputRef,
  models,
  model,
  onModel,
  efforts = ['Low', 'Medium', 'Max effort'],
  maxAttachments = 6,
}: PromptInputProps) {
  const own = useRef<HTMLTextAreaElement>(null);
  const ta = inputRef ?? own;
  const wrap = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [menu, setMenu] = useState(false);
  const [effort, setEffort] = useState(1);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [preview, setPreview] = useState<{ a: Attachment; from: DOMRect } | null>(null);
  const [recording, setRecording] = useState(false);
  const [levels, setLevels] = useState(quiet);
  const voice = useRef<{ rec?: any; stream?: MediaStream; ctx?: AudioContext; raf?: number }>({});
  const live = useRef({ value, attachments });
  live.current = { value, attachments };

  const hasText = value.trim() !== '';
  const open = focused || hasText || attachments.length > 0 || recording;
  const current = models?.find((m) => m.id === model);

  // Grows with the text up to 200px, then scrolls.
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(200, el.scrollHeight)}px`;
  }, [value, ta]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menu]);

  const stopVoice = () => {
    const v = voice.current;
    v.rec?.abort();
    if (v.raf) cancelAnimationFrame(v.raf);
    v.stream?.getTracks().forEach((t) => t.stop());
    v.ctx?.close();
    voice.current = {};
    setRecording(false);
    setLevels(quiet());
  };
  // Mic and object URLs are released when the composer goes away.
  useEffect(
    () => () => {
      stopVoice();
      live.current.attachments.forEach((a) => URL.revokeObjectURL(a.url));
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const startVoice = async () => {
    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language;
    const base = live.current.value.trim();
    rec.onresult = (e: any) => {
      const said = Array.from(e.results as ArrayLike<any>, (r) => r[0].transcript).join('').trim();
      onChange(base && said ? `${base} ${said}` : base || said);
    };
    rec.onend = stopVoice;
    rec.onerror = stopVoice;
    voice.current = { rec };
    setRecording(true);
    rec.start();
    // Levels for the bars; dictation still works if the analyser can't get the mic.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (voice.current.rec !== rec) return stream.getTracks().forEach((t) => t.stop());
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const bins = new Uint8Array(analyser.frequencyBinCount);
      const step = Math.floor(bins.length / BANDS);
      const tick = () => {
        analyser.getByteFrequencyData(bins);
        setLevels(Array.from({ length: BANDS }, (_, i) => bins.slice(i * step, (i + 1) * step).reduce((s, b) => s + b, 0) / step / 255));
        voice.current.raf = requestAnimationFrame(tick);
      };
      voice.current = { ...voice.current, stream, ctx };
      tick();
    } catch {
      /* no analyser: the bars stay flat */
    }
  };

  const clearAttachments = () => {
    attachments.forEach((a) => URL.revokeObjectURL(a.url));
    setAttachments([]);
  };
  const submit = () => {
    if (busy || disabled || !hasText) return;
    if (recording) stopVoice();
    onSubmit(value, { model, effort: efforts[effort], attachments: attachments.map((a) => a.file) });
    clearAttachments();
    setMenu(false);
  };

  const addFiles = (files: File[]) => {
    files
      .filter((f) => f.type.startsWith('image/'))
      .slice(0, Math.max(0, maxAttachments - attachments.length))
      .forEach((f) => {
        const url = URL.createObjectURL(f);
        const img = new Image();
        const add = (w: number, h: number) => setAttachments((prev) => [...prev, { id: `${f.name}-${f.lastModified}-${Math.random().toString(36).slice(2, 8)}`, file: f, url, w, h }]);
        img.onload = () => add(img.naturalWidth, img.naturalHeight);
        img.onerror = () => add(800, 600);
        img.src = url;
      });
  };
  const remove = (id: string) =>
    setAttachments((prev) => {
      const gone = prev.find((a) => a.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return prev.filter((a) => a.id !== id);
    });

  // One round button: stop the answer, stop dictating, send, or start dictating.
  const action = busy ? 'stop' : recording ? 'listening' : hasText || !SpeechRecognition ? 'send' : 'mic';
  const icon = (name: string, child: ReactNode) => <span className={`prompt-icon ${action === name ? 'on' : ''}`}>{child}</span>;

  return (
    <div
      ref={wrap}
      className={`prompt-wrap ${open ? 'is-open' : ''} ${recording ? 'is-recording' : ''}`}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (wrap.current?.contains(e.relatedTarget as Node)) return;
        setFocused(false);
        setMenu(false);
      }}
    >
      <input
        ref={file}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          addFiles(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
      <div className={`prompt-tray-slot ${attachments.length && open ? 'on' : ''}`} aria-hidden={!attachments.length}>
        <div>
          <div className="prompt-tray">
            {attachments.map((a, i) => (
              <span key={a.id} className="prompt-thumb-wrap" style={{ animationDelay: `${i * 35}ms` }}>
                <button type="button" className="prompt-thumb" onClick={(e) => setPreview({ a, from: e.currentTarget.getBoundingClientRect() })} aria-label={`Preview ${a.file.name}`}>
                  <img src={a.url} alt="" draggable={false} />
                </button>
                <button type="button" className="prompt-thumb-x" onClick={() => remove(a.id)} aria-label={`Remove ${a.file.name}`}>
                  <Close />
                </button>
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className={`composer prompt ${busy ? 'is-busy' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && (e.preventDefault(), ta.current?.focus())}>
        <textarea
          ref={ta}
          className="composer-input"
          rows={1}
          value={value}
          autoFocus={autoFocus}
          placeholder={placeholder}
          disabled={disabled}
          readOnly={recording}
          onChange={(e) => onChange(e.target.value)}
          onPaste={(e) => {
            const images = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'));
            if (images.length) {
              e.preventDefault();
              addFiles(images);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
            if (e.key === 'Escape' && menu) setMenu(false);
          }}
          aria-label="Message"
        />

        <div className="prompt-tools" aria-hidden={!open || recording}>
          <div>
            <div className="prompt-tools-row">
              {models && (
                <button type="button" className="prompt-tool" aria-haspopup="listbox" aria-expanded={menu} tabIndex={open ? 0 : -1} onMouseDown={(e) => e.preventDefault()} onClick={() => setMenu((m) => !m)}>
                  <span key={current?.label} className="prompt-tool-label">
                    {current?.label ?? model ?? 'Model'}
                  </span>
                  <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden>
                    <path d="M2.5 7.5L6 4l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
                  </svg>
                </button>
              )}
              <button
                type="button"
                className="prompt-tool"
                tabIndex={open ? 0 : -1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setEffort((i) => (i + 1) % efforts.length)}
                aria-label={`Effort: ${efforts[effort]}. Change effort`}
              >
                <Bars level={effort} />
                <span key={effort} className="prompt-tool-label">
                  {efforts[effort]}
                </span>
              </button>
              <button
                type="button"
                className="prompt-tool prompt-add"
                tabIndex={open ? 0 : -1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => file.current?.click()}
                disabled={attachments.length >= maxAttachments}
                aria-label="Attach images"
                title="Attach images (they stay in the composer; models here read text only)"
              >
                <Plus />
              </button>
            </div>
          </div>
        </div>

        {models && <ModelMenu models={models} model={model} onModel={onModel} open={menu && open} setOpen={setMenu} />}

        <div className="prompt-levels" aria-hidden>
          {levels.map((v, i) => (
            <i key={i} style={{ height: `${4 + v * 20}px` }} />
          ))}
        </div>

        <button
          type="button"
          className={`composer-btn prompt-action ${busy ? 'stop' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => (action === 'stop' ? onStop?.() : action === 'listening' ? stopVoice() : action === 'mic' ? startVoice() : submit())}
          disabled={action === 'send' && (disabled || !hasText)}
          aria-label={{ stop: 'Stop', listening: 'Stop dictation', send: 'Send', mic: 'Dictate' }[action]}
        >
          {icon('send', <ArrowUp />)}
          {icon('mic', <Mic />)}
          {icon('listening', <span className="stop-square" />)}
          {icon('stop', <span className="stop-square" />)}
        </button>
      </div>

      {preview && <Preview a={preview.a} from={preview.from} onClose={() => setPreview(null)} />}
    </div>
  );
}
