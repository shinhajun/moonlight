# Moonlight protocol (v0.4)

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
- `kind` is one of:
  - `chat`: OpenAI chat completions
  - `embedding`: OpenAI `/v1/embeddings`
  - `decision`: System-1 / `systemone`, typed answers with probabilities, as in Jev and Laya
- There is **no allowlist**. Any model a seller's machine can run may be listed, subject to the listing policy under "Public sellers". The catalog is dynamic: a model exists when at least one seller lists it.

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
- **Mid-stream failover:** If a node drops after streaming has started, the gateway re-issues the job to the next candidate with the partial output appended as a trailing `assistant` message (prefill) and keeps streaming to the buyer seamlessly.
  - Some models continue from the prefill (qwen2.5, qwen3.5 with reasoning off). Others restart from scratch (gemma4, glm-4.7-flash).
  - So the gateway buffers the new node's output until it either diverges from the already-sent partial text or passes it, drops any repeated prefix, and forwards only new text. The buyer never sees duplicated text.

## Verification

- **Digest check at `hello`:** Each public tag has a *set* of accepted digests, because Ollama tags are mutable and republished tags change digest. The set is:
  - the registry's current manifest digest: `sha256` of `GET https://registry.ollama.ai/v2/library/<name>/manifests/<tag>`, fetched and cached for 1 h
  - every digest a trusted node has reported for that tag
  - for Laya, the sha256 of `model.safetensors`:
    - `laya-base` `891102d372688fc2a094dac56a384bc537b87c63f21f9f3dac0be2b7cbc8d86c`
    - `laya-multilingual` `9d628fd971b700382ac6f65920a86f149777b2e748e0c955fb3b19695aa8f204`

  A digest outside the set is rejected (`reason: "digest_mismatch"`). Digests only prove a consistent claim; a cheater can report the real digest. The behavior checks below are the real proof.
- **Reference nodes:** These are operator-owned agents started with `--trusted`, in the demo the vada-ai server. They serve normal traffic and also answer verification replays.
- **Decision models:** The gateway re-runs a sample of real buyer jobs (default 10%) on a reference node. It passes if `max |Δp| ≤ 0.05` across all answers.
- **Chat models (teacher-forced next-word agreement):** Free generation diverges across hardware: honest CPU vs GPU averaged only 0.66 similarity. So the gateway sends canary jobs at random times instead, built like this:
  1. Take a canary prompt and the reference node's greedy answer for it, with `temperature:0`, `seed:42`, and `reasoning_effort:"none"`.
  2. At about 6 word boundaries in that answer, send the prompt plus the reference prefix as a trailing `assistant` message (prefill), with `max_tokens:4`.
  3. Run the same prefilled boundary job on the reference node too, and compare the target's first next word with the *reference node's* next word for that same input, not with the word in the reference answer. This works for models that continue a prefill and for ones that restart (gemma4, glm).
  4. Use 8 boundaries (a config knob), skipping the very first boundary of the answer. Each prefilled boundary job uses `max_tokens: 8`.
  5. Compare the first **3 words** (tokens matched by `/\w+|[^\w\s]/`, lowercased) of the target's continuation with the reference node's continuation for the same input. A boundary agrees only if all 3 match. Passing takes ≥ 6 of 8.

  Measured on qwen2.5:7b over 42 positions. One-word agreement is too weak, because a small model of the same family guesses the big model's next word too well:

  | Check | Honest CPU vs GPU | Cheater (0.5b serving 7b) | Cheater passes | Honest fails |
  |---|---|---|---|---|
  | 1-word, 7/8 | 0.93 | 0.69 | ~24% | ~10% |
  | 3-word, 6/8 | 0.90 | 0.33 | ~2% | ~3% |

  Canary jobs look like ordinary short buyer jobs.
- **Thinking models** (qwen3.5, gemma4, glm-4.7-flash) put output into `delta.reasoning`:
  - Canaries always send `reasoning_effort:"none"`.
  - Metering counts reasoning tokens as output.
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
- `GET /health` returns `{model_id, digest, device, models:[{model_id, digest, kind, private}]}`. The top-level fields describe the primary model; `models` lists everything the runner serves.
- Laya returns `output_tokens: 0`. Jev rejects `score` criteria given as a dict (422); criteria must be a list, and the runner accepts the same.
- It also serves a private fine-tuned checkpoint for the demo (`hajun/support-triage`) if one is built.

## Public sellers (v0.2)

Moonlight is a real product, not a scripted demo. Anyone can visit the site, register their computer, and sell every model it can run.

### Accounts
- Accounts use email + password, with the password hashed by Node `crypto.scrypt`. Sessions are HttpOnly cookies.
- One account can both buy and sell. The API keys (`ml_sk_`) belong to the account.
- This replaces the throwaway `POST /api/accounts` from v0. Keep that endpoint only for the demo seed script.

### Adding a computer (device pairing, like `gh auth login`)
1. The user installs the agent with one line from the site:
   - macOS/Linux: `curl -fsSL https://moonlight.hajunshin.com/install.sh | sh`
   - Windows: `irm https://moonlight.hajunshin.com/install.ps1 | iex`

   That downloads a standalone `moonlight` binary for darwin-arm64/x64, linux-x64/arm64, or windows-x64, so no Node install is needed.
2. `moonlight` (first run) → `POST /api/devices/pair` `{node:{name, os, arch, cpu, ram_gb, gpu, vram_gb}}` → `{pair_code:"ABCD-1234", verify_url, poll_token, expires_at}`.
   - The CLI prints the code and opens `verify_url` in the browser.
3. The logged-in user sees "Approve Hajun's MacBook?" with the hardware, and approves.
4. The agent polls `POST /api/devices/pair/poll {poll_token}` and receives a node token `ml_nt_<32 hex>`. It stores the token in its config dir (`~/.moonlight/config.json`, mode 0600).
5. `--token` still works for scripts and for the demo's trusted node.

### Discovery: the agent finds everything it can serve
- Probe these runtimes, skipping any that don't answer within 300 ms:
  - Ollama `:11434` (`/api/tags`, plus `/api/show` for family, params, quant, context, and license text)
  - LM Studio `:1234`
  - llama.cpp server `:8080`
  - vLLM `:8000`
  - Jan `:1337`
  - LocalAI
  - KoboldCpp `:5001`
  - any `--endpoint http://host:port/v1` the user adds
  - laya-runner `:8765`
- The OpenAI-compatible runtimes are listed through `/v1/models`.
- Classify each model as `chat`, `embedding`, or `decision`.
- `hello.models[]` gains these fields: `runtime` (`ollama|lmstudio|llamacpp|vllm|jan|localai|kobold|openai|laya`), `family`, `params_b`, `quant`, `context`, `license:{id, text_sha256?, source}`, and `source:{registry:"ollama"|"hf"|"local", ref}`.
- Re-scan every 60 s, and send `t:"models"` with the full list when it changes.

### Listing policy (the gateway decides per model; the web shows why)
- **Licenses:**
  - Permissive or commercial-OK (Apache-2.0, MIT, Llama/Gemma/Qwen community terms, and so on) → listable.
  - Non-commercial or research-only (CC-BY-NC, Codestral's MNPL, Command-R NC, and so on) → `blocked:license`.
  - Unknown license → listable only after the seller ticks "I have the right to sell access to this model" in the web.
- **Uncensored, abliterated, or "heretic" variants** (matched by name/tag patterns and HF tags) → `blocked:policy`.
- **Default for listable models:** they go live immediately with a suggested price, which the seller can pause or edit in the web. The suggested price comes from `params_b`, quant, and kind (embedding < small chat < large chat), and is shown as "market" vs "yours".

### Verification for an open catalog
- **Digest sources:**
  - the Ollama registry manifest digest
  - the Hugging Face file sha256 (LFS oid) for `hf.co/...` GGUF tags and HF repos
  - trusted-node digests
- **Behavior reference, chosen in this order:**
  1. a trusted node serving the model
  2. otherwise **peer cross-checks**: canaries go to 2+ sellers of the same model, and a seller that disagrees with the peer majority fails
  3. otherwise there's no reference. The listing gets the `consistent` badge (self-consistency + uptime) and the UI says "Not independently verified yet".
- **Embeddings:** cosine ≥ 0.99 with the reference or peer embedding for the same canary text.

### New endpoints
- `POST /v1/embeddings`: OpenAI-compatible.
- `POST /api/devices/pair`, `POST /api/devices/pair/poll`, `POST /api/devices/:code/approve`.
- `GET /api/me/nodes` lists the nodes with their discovered models and each one's policy result: live, paused, needs_attestation, blocked:license, or blocked:policy.
- `PATCH /api/me/listings/:id {price?, paused?, attest?}`.
- `GET /install.sh`, `GET /install.ps1`, and `GET /dl/moonlight-<os>-<arch>[.exe]`.

## Using models, availability, and queueing (v0.3)

### How buyers use models
- **One API key for every model.** The `ml_sk_` key belongs to the account, and the `model` field picks the model, as with OpenAI or OpenRouter.
- **The site itself:** a full **Chat** page (ChatGPT-style, with a model picker and conversation history in localStorage), plus the decision and embedding playgrounds. Both bill the account's credits.
- **Auto models**, for availability:
  - `auto/chat-small` (≤ 9B)
  - `auto/chat-large` (> 9B)
  - `auto/embedding`
  - `auto/decision`

  Each routes to any live, verified (or else best-reputation) listing of that class. The response's `model` field and `moonlight.served_model` name the model actually used.

### Capacity
- `hello.node.max_concurrency` comes from the agent. Ollama defaults to 1 unless `OLLAMA_NUM_PARALLEL` is set. `--concurrency N` overrides it.
- The gateway never exceeds a node's limit.

### Queueing (when every seller of the model is busy or none is online)
- **Per-model queue.** Jobs are served in fair order: round-robin across buyers, FIFO within a buyer.
- **Waiting:** A request waits up to `moonlight.max_wait_s`, which defaults to 30 and caps at 120.
  - Streaming requests receive SSE comment keepalives while queued (`: queued position=2 eta_s=8`). OpenAI SDKs ignore comment lines. The web Chat shows the queue position.
  - A seller coming online for that model drains the queue immediately.
- **On timeout:** 503 `{error:{code:"no_capacity"}, moonlight:{suggestions:[model_id…]}}` with `Retry-After`. The suggestions are other live models of the same kind and similar size, including the matching `auto/*` alias.
- Queued time is never billed.

### Sellers leaving
- **Graceful shutdown** (Ctrl-C, `moonlight stop`, system sleep notice if detectable):
  1. The agent sends `t:"drain"`.
  2. The gateway routes no new jobs to that node.
  3. In-flight jobs finish, for up to 30 s.
  4. The agent then disconnects.
- **Abrupt loss** (crash, lid closed, network drop): this falls back to the routing rules above.
  - Before the first chunk, the job is retried on another seller.
  - Mid-stream, it fails over with prefill and dedupe.
  - The final chunk carries `moonlight.failovers:[{from_node, to_node, at_token}]`, and the web Chat shows a small "Switched to another computer" note.
- **No other seller at all:** the job joins the queue under the same rules. If the stream had already started and the wait times out, the buyer gets the partial answer plus a final chunk with `finish_reason:"length"`, `moonlight.error:"seller_lost"`, and billing for delivered tokens only.

## Web API shapes (v0.3, agreed with web)

These are the exact shapes; the gateway implements them as written.

### Auth
The session cookie is `ml_session` (HttpOnly, SameSite=Lax).
- `POST /api/auth/signup {email, password, name}` → 201 `{account}`.
- `POST /api/auth/login {email, password}` → `{account}`. Bad credentials → 401 `{error:{message, code:"bad_credentials"}}`.
- `POST /api/auth/logout` → 204.
- `GET /api/me` → 401 when signed out. Otherwise one combined view:
  - `account:{id, email, name, handle, created_at}`
  - `balance_microusd`
  - `keys:[{id, prefix, created_at, last_used}]`
  - `requests:[{request_id, ts, model_id, kind, seller:{id, name}, node:{id, name}, verification, input_tokens, output_tokens, latency_ms, cost_microusd}]`
  - `earnings:{total, today, held}`
  - `jobs:[{job_id, ts, listing_id, model_id, kind, node_id, input_tokens, output_tokens, latency_ms, earned_microusd}]`
  - `verification_log:[{ts, listing_id, model_id, method:"canary"|"replay"|"peer"|"consistency", passed, metric:"agreement"|"max_dp"|"cosine"|"match", score, threshold, state_after}]`
- `POST /api/me/keys {name?}` → `{key:{id, prefix, created_at}, secret:"ml_sk_…"}`. The secret is shown once.
- `DELETE /api/me/keys/:id` → 204.

### Pairing
- `GET /api/devices/:code` → `{pair_code, status:"pending"|"approved"|"expired", expires_at, node:{name, os, arch, cpu, ram_gb, gpu, vram_gb}}`.
- `POST /api/devices/:code/approve` (needs a session) → `{node_id, name}`.
- Poll response: `{status:"pending"}` or `{status:"approved", node_token:"ml_nt_…"}`.
- `verify_url` is `https://moonlight.hajunshin.com/pair/ABCD-1234` (web route `/pair/:code`).

### Nodes and listings
- `GET /api/me/nodes` → `{nodes:[node]}`. Each node has:
  - `node_id, name, os, arch, cpu, ram_gb, gpu, vram_gb, online, last_seen, agent_version`
  - `earnings:{total, today}`
  - `models:[model]`
- Each model in a node's `models` has:
  - `listing_id, model_id, kind, runtime, family, params_b, quant, size_bytes, context, dims?`
  - `license:{id, source}`
  - `policy`: `"live"|"paused"|"needs_attestation"|"blocked:license"|"blocked:policy"|"blocked:digest"`, plus a human-readable `reason?` (e.g. "Model files differ from the published version. Run `ollama pull <tag>` to update."). A blocked license wins over a digest mismatch.
  - `price, market_price`
  - `verify_method`: `"trusted"|"peer"|"consistent"`
  - `verification:{state, badge, passed, failed, recent:[bool…] oldest→newest, last_check}` (the same object appears on each listing in `GET /api/models/:id`, together with `held_microusd`)
  - `reputation, requests, earned_microusd`
- `PATCH /api/me/listings/:id {price?, paused?, attest?}` → that model row.

### Playground and prices
- `POST /api/playground/embeddings` needs a session and behaves like `/v1/embeddings`.
- Embedding prices are `{in_per_m}`.
- `/api/models` `price_from` is the cheapest of:
  - `out_per_m` for chat
  - `per_call` for decision
  - `in_per_m` for embedding

### SSE `/api/events`
Named events, e.g. `event: request\ndata: {...}`:
- `request {ts, model_id, kind, seller_id, seller_name, node_id, node_name, cost_microusd, latency_ms}`
- `node {ts, node_id, node_name, seller_id, online}`
- `verification {ts, listing_id, model_id, seller_id, seller_name, node_id, node_name, passed, state, method, score}`
- `earning {ts, seller_id, listing_id, amount_microusd, held}`
- `queue {ts, model_id, depth}`

### Static
The web uses path routes, e.g. `/models/qwen3.5:35b-a3b`, `/me/sell`, `/pair/ABCD-1234`, `/chat`. The gateway serves `index.html` (SPA fallback) for any GET outside `/api`, `/v1`, `/agent`, `/agent.mjs`, `/install.*`, and `/dl`.

## Google sign-in (v0.4)

Google sign-in goes through Firebase Auth in GCP project `vada-so`. Its Google provider is already enabled, and `moonlight.hajunshin.com` is an authorized domain (added 2026-10-25).

- **Web:**
  1. Lazy-load the Firebase modular SDK (`firebase/app` + `firebase/auth` only) on the login page.
  2. Call `signInWithPopup(GoogleAuthProvider)` (fall back to redirect on mobile or when popups are blocked).
  3. Take `user.getIdToken()` and send it to `POST /api/auth/google {id_token}`.

  The Firebase web config holds public client values. It's in the vault note `resources/credentials/자격증명 (Credentials).md` under "Firebase (vada-so) - 테스트용 › Web App 설정". Copy the needed fields into `web/src/firebase.js`.
- **Gateway: `POST /api/auth/google {id_token}`.** It verifies the Firebase ID token itself, with no SDK:
  - The signature is RS256 against `https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com`, keyed by `kid` and cached per `Cache-Control: max-age`.
  - Required claims:
    - `aud` = `vada-so`
    - `iss` = `https://securetoken.google.com/vada-so`
    - `exp` in the future, `iat` and `auth_time` in the past
    - `sub` non-empty
    - `email_verified` = true
    - `firebase.sign_in_provider` = `google.com`
- **Account resolution:**
  1. An existing `google_sub` signs into that account.
  2. Otherwise, an existing account with the same verified email gets `google_sub` linked.
  3. Otherwise, a new account is created (name from the token, password null).

  The response is the same as login (`{account}`, plus `demo_credit_microusd` and `notice?` when the account is new) and sets the `ml_session` cookie. The same per-IP limits and once-a-day demo credit apply.
- **Signed-out behavior:** No page embeds an auth form. Pages that need an account redirect to `/login?next=<path>`, and login returns there afterwards:
  - `/me/*`
  - `/developers` key actions
  - `/pair/:code`, which keeps the code
  - sending a chat message

  `/chat` signed out keeps its normal empty state and model picker. Its composer is replaced by a single "Sign in to chat" call to action that links to `/login?next=/chat`.
