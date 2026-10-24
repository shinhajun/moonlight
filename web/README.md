# web

Moonlight's marketplace, chat, playgrounds and dashboards. React + Vite, no other runtime dependencies.

```sh
npm install
npm run dev                                            # mock gateway in mock/, live fake traffic
MOONLIGHT_API=https://moonlight.hajunshin.com npm run dev   # proxy /api, /v1 to a real gateway
npm run build                                          # → dist/, served by the gateway
node scripts/shots.mjs --base=http://localhost:5173    # light/dark × desktop/mobile → .e2e/
```

- Mock login: `demo@moonlight.dev` / `moonlight` (a seller with two computers); `cheat@moonlight.dev` is the flagged seller.
- Mock-only chat triggers: put `#queue`, `#warm`, `#failover` or `#lost` in a message.
- `/add` shows a mock-only button that stands in for the `moonlight` CLI's pairing request.
- Routes are paths (`/models/qwen3.5:35b-a3b`, `/me/sell`, `/pair/ABCD-1234`, `/chat`), so the gateway serves `index.html` for unknown GETs.
