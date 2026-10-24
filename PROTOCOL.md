# Moonlight protocol (v0)

Moonlight lets anyone sell the models running on their own computer. Buyers call one API. The gateway routes each call to a seller's machine, meters it, pays the seller, and checks that the seller really runs the model they listed.

This file is the contract between `gateway/`, `agent/`, `laya-runner/`, and `web/`. Change it only through the orchestrator.

## Topology

```
buyer ──HTTPS──▶ gateway (GCE VM, https://moonlight.hajunshin.com) ◀──WSS (outbound from home)── agent ──▶ Ollama :11434
                    │                                                                          └──▶ laya-runner :8765
web (static, served by gateway) ── /api/* + SSE /api/events
```

One origin serves everything:
- `/` is the web app (static build of `web/`).
- `/v1/*` is the buyer API.
- `/api/*` is the web app's JSON API.
- `/agent` is the seller WebSocket.
- `/agent.mjs` serves the single-file agent for download.

## Ids, money, time

- Money is integer **micro-USD** (`1 USD = 1_000_000`) everywhere in storage and on the wire. The UI formats it.
- Times are epoch ms.
- Ids are short random strings with a prefix: `slr_`, `byr_`, `nod_`, `lst_`, `req_`, `job_`.
- Secrets:
  - buyer API key `ml_sk_<32 hex>`
  - seller token `ml_st_<32 hex>`
  - Only hashes are stored server-side.

## Models

`model_id` names a model in the catalog.
- **Public model:** an Ollama tag (`qwen3.5:35b-a3b`, `gemma4:26b`, `qwen2.5:3b`) or `laya-base` / `laya-multilingual`. A public model has a reference digest: the Ollama manifest digest, or the sha256 of the Laya weights.
- **Private model:** `<seller-handle>/<name>`, e.g. `hajun/support-triage`. The weights never leave the seller's machine, so there is no reference.
- `kind` is `chat` (OpenAI chat completions) or `decision` (System-1 / `systemone`: typed answers with probabilities, as in Jev and Laya).
- An operator allowlist decides which public tags may be listed. The gateway rejects any other public tag, and uncensored/abliterated variants are never allowed.

## Buyer API

Auth: `Authorization: Bearer ml_sk_...`. Errors use OpenAI's shape `{error:{message,type,code}}` with status 401, 402 (balance too low), 404 (no such model), or 503 (no seller online).

### `GET /v1/models`
OpenAI-compatible list. Each item adds `moonlight: {kind, sellers_online, price_from, verified}`.

### `POST /v1/chat/completions`
- OpenAI-compatible, including `stream: true` (SSE `data: {chunk}` … `data: [DONE]`).
- The final chunk (or the non-stream body) carries `usage: {prompt_tokens, completion_tokens, total_tokens}`.
- Optional extension field: `moonlight: {verified_only?: bool, max_price_out_per_m?: int, seller?: "slr_..."}`.
- Response headers: `x-moonlight-request`, `x-moonlight-seller`, `x-moonlight-node`, `x-moonlight-cost-microusd` (non-stream). For streams, cost appears in the final chunk as `moonlight: {cost, seller, node, verified}`.

### `POST /v1/systemone`
- Decision API with the same request/response shape as TypeSafe Jev.
- Request: `{model, state, questions:{name:{type:"noul"|"choice"|"score", instructions, criteria?}}}`. The response mirrors Jev's, plus `usage.input_tokens`.
- Copy Jev's exact field names from `/home/hajunshin/projects/picky/extension/jev.js` and `background.js`, and from one live Jev call (`TYPESAFE_API_KEY` in `.env`).
- The laya-runner must return this same shape.

## Agent ⇄ gateway WebSocket `wss://…/agent`

JSON text frames, one object per frame, each with a `t` field.

| dir | t | fields |
|---|---|---|
| A→G | `hello` | `token, agent_version, node:{name, os, arch, cpu, ram_gb, gpu, vram_gb}, models:[{model_id, kind, runtime:"ollama"\|"laya", digest, size_bytes, quant?, private:bool, price:{in_per_m, out_per_m} \| {per_call}}]` |
| G→A | `welcome` | `node_id, seller_id, listings:[{listing_id, model_id, status:"live"\|"rejected", reason?}]` |
| G→A | `job` | `job_id, kind, model_id, body` (OpenAI chat body with `stream:true`, or a systemone body)`, deadline_ms` |
| A→G | `chunk` | `job_id, data` (one OpenAI stream chunk object, verbatim from Ollama's OpenAI endpoint) |
| A→G | `done` | `job_id, usage:{input_tokens, output_tokens}, result?` (the full systemone response for decision jobs)`, timing:{first_ms, total_ms}` |
| A→G | `error` | `job_id, code, message` |
| G→A | `cancel` | `job_id` |
| A→G | `status` | `paused:bool, inflight:int` |
| G→A | `stats` | `earned_microusd, requests, verification:{passed, failed, state}` (pushed after each job, for the CLI display) |
| both | `ping`/`pong` | `ts`. Ping every 15 s; the gateway marks a node offline after 45 s with no frame. |

Rules:
- Verification jobs are byte-for-byte indistinguishable from buyer jobs. There is no flag, and the agent must never be able to tell them apart.
- The agent reconnects with backoff (1 s → 15 s) and re-sends `hello`. Listings are keyed by `(seller, model_id)`, so a reconnect reuses them.
- The gateway is the billing source of truth. It counts output tokens itself (chunks/characters) and clamps agent-reported usage to within ±20% of its own estimate.

## Routing

- **Choosing a listing:** The candidates are live listings of the requested `model_id` that pass the buyer's filters. Each gets `score = w_price·price + w_lat·p50_latency + w_load·inflight − w_rep·reputation`, and the lowest score wins.
- **Retries:** If a node errors or times out before its first chunk, the gateway retries the next candidate. The buyer never sees that.
- **Mid-stream failover:** If a node drops after streaming has started, the gateway re-issues the job to the next candidate with the partial output appended as a trailing `assistant` message (prefill) and keeps streaming to the buyer seamlessly. The agent worker confirms that Ollama continues a trailing assistant message. If it doesn't, fall back to restarting from scratch and emit nothing duplicated.

## Verification

- **Digest check at `hello`:** A public listing whose digest differs from the catalog reference is rejected (`reason: "digest_mismatch"`).
- **Reference nodes:** These are operator-owned agents started with `--trusted`, in the demo the vada-ai server. They serve normal traffic and also answer verification replays.
- **Decision models:** The gateway re-runs a sample of real buyer jobs (default 10%) on a reference node. It passes if `max |Δp| ≤ 0.05` across all answers.
- **Chat models:** The gateway sends canary jobs at random times. These are generated prompts with `temperature:0`, `seed:42`, and `max_tokens:48`. Each answer is compared to the reference node's answer for the same canary using a token-level similarity score; it passes at ≥ 0.85, a tolerance chosen because GPUs differ.
- **Private models:** These can't be compared to a reference. Instead, the gateway runs a consistency probe (the same canary twice gives the same answer) and tracks latency and uptime. The badge reads "Consistent", not "Verified".
- **States per listing:**
  - `new`: fewer than 3 checks
  - `verified`: 3 or more passes and no failure in the last 10 checks
  - `flagged`: 2 or more failures in the last 10 checks. The listing is suspended, its earnings are held, and the buyer-facing badge turns red.
- **Reputation:** 0–100, computed from pass rate, uptime, and latency stability.
- **Demo:** `agent --cheat-serve <other-tag>` advertises one model but serves another, and must get flagged within about 5 checks. The demo can set the verification rate per listing to 100%.

## Money

- New buyers start with demo credit of $5 (`5_000_000`).
- Sellers set their own price. The platform fee is 10%.
- Each request writes ledger rows: a buyer debit, a seller credit (90%), and a platform fee (10%).
- Earnings on flagged listings go to `held`.
- There are no real payments. Stripe Connect payouts are roadmap only.

## Web API (`/api/*`, same origin)

- Accounts are lightweight: `POST /api/accounts {name, role:"buyer"|"seller"}` returns the account and its secret (an API key or seller token), shown once. The web app keeps the secret in localStorage and sends it as a Bearer token.
- Endpoints:
  - `GET /api/stats` returns `{nodes_online, sellers_online, models_live, requests_per_min, paid_to_sellers_microusd, verifications_last_hour}`.
  - `GET /api/models` lists the catalog with per-model `sellers_online, price_from, p50_ms, verified_share`.
  - `GET /api/models/:id` returns the model plus its listings: seller, node hardware, price, p50, reputation, and verification state.
  - `GET /api/me` returns the buyer view (balance, keys, recent requests) or the seller view (nodes, listings, earnings `{total, today, held}`, recent jobs, verification log).
  - `PATCH /api/listings/:id {price}` and `POST /api/listings/:id/pause`.
  - `POST /api/playground/chat` and `POST /api/playground/systemone` behave like `/v1/*` but authenticate with the logged-in buyer.
- `GET /api/events` is SSE pushing these events:
  - `request` (model, seller, cost, latency)
  - `node` (online/offline)
  - `verification` (listing, pass/fail, state)
  - `earning` (seller, amount)

## Agent CLI

```
node agent.mjs --token ml_st_... [--gateway wss://moonlight.hajunshin.com/agent]
               [--name "Hajun's MacBook"] [--price-out 0.20] [--models qwen2.5:3b,laya-base]
               [--trusted] [--cheat-serve <tag>]
```

- Single file, zero dependencies (Node ≥ 22 has a global WebSocket).
- Auto-detects Ollama at `:11434` (`/api/tags` for names and digests) and the laya-runner at `:8765`.
- Prints a live terminal status: listings, jobs served, earnings, and verification state.

## laya-runner

- `python -m laya_runner` (uv-managed) serves `POST /v1/systemone` on `:8765`. It loads `convaiinnovations/laya` from Hugging Face on CPU, MPS, or CUDA.
- `GET /health` returns `{model_id, digest, device}`.
- It also serves a private fine-tuned checkpoint for the demo (`hajun/support-triage`) if one is built.
