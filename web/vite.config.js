import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import moonlightMock from './mock/plugin.js';

// `npm run dev` serves the mock gateway. MOONLIGHT_API=https://moonlight.hajunshin.com npm run dev
// proxies /api, /v1 and the install files to a real gateway instead.
const api = process.env.MOONLIGHT_API;
const proxied = { target: api, changeOrigin: true, secure: true };
const proxy = api ? Object.fromEntries(['/api', '/v1', '/agent.mjs', '/install.sh', '/install.ps1', '/dl'].map((p) => [p, proxied])) : undefined;

export default defineConfig(({ command }) => ({
  plugins: [react(), ...(api ? [] : [moonlightMock()])],
  // True only for the local mock; production builds never show mock-only controls.
  define: { __MOCK__: JSON.stringify(command === 'serve' && !api) },
  server: { host: true, proxy },
  preview: { proxy },
}));
