// The site's look (web/src/styles/tokens.css, dark): Geist and Geist Mono, one gold accent.
import { loadFont as loadGeist } from '@remotion/google-fonts/Geist';
import { loadFont as loadGeistMono } from '@remotion/google-fonts/GeistMono';

export const sans = loadGeist('normal', { weights: ['400', '500', '600', '700'], subsets: ['latin'] }).fontFamily;
export const mono = loadGeistMono('normal', { weights: ['400', '500', '600'], subsets: ['latin'] }).fontFamily;

export const C = {
  bg: '#090a0c',
  bg1: '#0e0f12',
  bg2: '#141619',
  bg3: '#060608',
  fg: '#f4f5f7',
  fg2: '#aeb1b6',
  fg3: '#7d8086',
  accent: '#f6c159',
  accent2: '#f7db98',
  accentInk: '#1f1306',
  ok: '#59d38c',
  bad: '#fa6863',
  line: 'rgba(255,255,255,0.08)',
  line2: 'rgba(255,255,255,0.14)',
  line3: 'rgba(255,255,255,0.24)',
};

export const FPS = 30;

// The site's moon mark (web/src/App.jsx Logo).
export const Logo = ({ size = 64 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24">
    <defs>
      <linearGradient id="logo-g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor={C.accent2} />
        <stop offset="1" stopColor={C.accent} />
      </linearGradient>
    </defs>
    <path d="M15.4 2.4A10 10 0 1 0 21.6 16.9 8 8 0 0 1 15.4 2.4z" fill="url(#logo-g)" />
  </svg>
);
