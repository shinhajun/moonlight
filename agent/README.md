# moonlight (seller agent)

`moonlight` puts the AI models running on your computer up for sale on [Moonlight](https://moonlight.hajunshin.com). It finds every model your machine can serve, connects out to the gateway (no open ports, no port forwarding), serves the jobs buyers send, and shows earnings and verification live in your terminal.

It is one file, `agent.mjs`, with no dependencies. You can run it with Node 22, or as the standalone `moonlight` binary, which needs nothing installed.

## Mac setup (about 10 minutes)

Works on Apple silicon (M1 or later) running macOS 14 or newer. Intel Macs can run the agent and Ollama, but not the optional Laya runner.

### 1. Ollama and a model

Install Ollama from [ollama.com/download](https://ollama.com/download) (or `brew install ollama`), start it, and pull a model:

```sh
ollama pull qwen2.5:7b          # Apache-2.0, about 4.7 GB; use qwen2.5:1.5b on an 8 GB Mac
ollama pull nomic-embed-text    # optional: lets you sell embeddings too (270 MB)
```

The agent lists every model it finds, and the gateway checks each one's license. For example, `qwen2.5:3b` is under the Qwen RESEARCH license (non-commercial), so it shows up as `blocked: license`. That is the policy working as intended, not an error.

### 2. Install the agent

```sh
curl -fsSL https://moonlight.hajunshin.com/install.sh | sh
```

This puts `moonlight` in `~/.local/bin`. If that directory isn't on your `PATH`, the script prints the line to add.

Without the binary, run it with Node 22 instead (`brew install node@22`, or install from [nodejs.org](https://nodejs.org)):

```sh
curl -fsSLO https://moonlight.hajunshin.com/agent.mjs
node agent.mjs            # use this wherever the steps below say `moonlight`
```

### 3. Optional: the Laya decision model

[Laya](https://huggingface.co/convaiinnovations/laya) is an open (Apache-2.0) System-1 decision model: it returns typed answers with probabilities, using the same API as TypeSafe Jev. It is a Python app, installed with [uv](https://docs.astral.sh/uv/), which brings its own Python:

```sh
moonlight laya install   # offers to install uv if it's missing, then installs laya-runner
```

From then on, `moonlight` starts laya-runner itself whenever nothing is answering on `127.0.0.1:8765`, and stops it when the agent stops. The runner logs to `~/.moonlight/laya-runner.log`, and its first start downloads the 840 MB model. It uses the Apple GPU (MPS) automatically.

To run it yourself instead, use `laya-runner` (or `cd laya-runner && uv run laya-runner` from a checkout of this repo). The agent finds it on `:8765` either way.

### 4. Connect your computer

```sh
moonlight
```

On the first run:
1. It lists the models it found.
2. It prints a pairing code like `ABCD-1234` and opens `moonlight.hajunshin.com/pair/ABCD-1234` in your browser.
3. Sign in, check that the code matches, and click **Approve**.
4. The terminal switches to the live dashboard: each model's status (live, needs your OK in the web, or blocked and why), jobs in flight, earnings and verification.

Keys: `p` pause/resume, `w` open your seller page, `q` stop.

The pairing token is saved in `~/.moonlight/config.json` (mode 0600), so later runs connect straight away. Prices default to the market price for each model's size; change them, pause a model, or approve a model with an unknown license on your seller page in the web.

To stop, press `q` or Ctrl-C, or run `moonlight stop` from another terminal. The agent tells the gateway it is leaving, finishes the jobs in flight (up to 30 s), then exits. Press Ctrl-C a second time to quit at once.

## Commands

| Command | What it does |
|---|---|
| `moonlight` | Pair this computer on the first run, then serve jobs |
| `moonlight scan` | List the models this computer can serve, then exit (`--json` for details) |
| `moonlight stop` | Ask the running agent to finish its jobs and stop |
| `moonlight logout` | Forget this computer's token (also remove the computer in the web) |
| `moonlight laya install` | Install laya-runner with uv (and uv itself, if you say yes); `moonlight` then starts it when needed |

| Option | |
|---|---|
| `--name <text>` | Name buyers see (default: your computer's name) |
| `--models a,b` | List only these models (default: everything found) |
| `--price-out <usd>` / `--price-in <usd>` / `--price-call <usd>` | Your price per 1M output tokens / per 1M input tokens / per decision call |
| `--concurrency <n>` | Jobs at once (default: `OLLAMA_NUM_PARALLEL`, else 1) |
| `--endpoint <url>` | Also serve an OpenAI-compatible server, e.g. `http://127.0.0.1:9000/v1` (repeatable) |
| `--ollama <url>` / `--laya <url>` | Where Ollama / laya-runner listen (defaults `127.0.0.1:11434` / `127.0.0.1:8765`) |
| `--token <token>` | Use a token instead of pairing (`ml_nt_…` node token or `ml_st_…` seller token) |
| `--gateway <url>` | Default `wss://moonlight.hajunshin.com/agent` |
| `--no-browser` / `--plain` | Don't open a browser / print log lines instead of the dashboard |

Environment variables: `MOONLIGHT_TOKEN`, `MOONLIGHT_GATEWAY`, `MOONLIGHT_HOME` (default `~/.moonlight`), `OLLAMA_HOST`, `NO_COLOR`.

### What it finds

Every probe gives up after 300 ms, and the agent rescans every 60 s, telling the gateway when the list changes.

| Runtime | Where | Kinds |
|---|---|---|
| Ollama | `:11434`: names, digests, family, size, quantization, context and license from `/api/show` | chat, embedding |
| laya-runner | `:8765` | decision |
| LM Studio | `:1234` | chat, embedding |
| llama.cpp server / LocalAI | `:8080` | chat, embedding |
| vLLM | `:8000` | chat, embedding |
| Jan | `:1337` | chat, embedding |
| KoboldCpp | `:5001` | chat |
| Anything OpenAI-compatible | `--endpoint` | chat, embedding |

### What it sends

- **Hardware summary:** computer name, OS, CPU, RAM, GPU and VRAM.
- **For each model:** its name, kind, size, quantization, context length, license id and digest. The digest proves which public weights you run; a private model's weights never leave your machine.
- **Job output:** answers to the jobs the gateway sends, and nothing else.

No files, prompts or other data leave your computer.

## Demo recipes

**A dishonest seller gets caught.** `--cheat-serve` is a demo-only flag. It advertises one model but secretly serves another, while reporting the real digest, so only behavior verification can catch it. Run it as a second agent with its own home folder (it pairs separately):

```sh
ollama pull qwen2.5:0.5b
MOONLIGHT_HOME=~/.moonlight-cheat moonlight --name "Too-good-to-be-true GPU" \
  --models qwen2.5:7b --cheat-serve qwen2.5:0.5b
```

Its qwen2.5:7b listing passes the digest check, then fails the gateway's teacher-forced canaries: the first 3 words after a prefilled prefix must match the reference node's, at 6 of 8 points. It is flagged after about two checks, and its earnings are held. The dashboard shows a red `DEMO: CHEAT MODE` banner the whole time.

**A model whose weights never leave your machine.** Serve a private Laya checkpoint next to the public one. The name must be `<your-handle>/<name>`, using your Moonlight handle:

```sh
laya-runner --private hajun/support-triage=/path/to/checkpoints/support-triage
```

Private listings can't be compared with a reference, so they get the "Consistent" badge (self-consistency and uptime) instead of "Verified".

**Operator reference node** (not for sellers): `--trusted` marks an agent run with an operator token as a reference node, which answers verification replays. See `scripts/reference-node.sh`.

## Troubleshooting

- **"cannot be opened because the developer cannot be verified"**: macOS quarantines files downloaded with a browser. The `curl | sh` install isn't affected. Otherwise run `xattr -d com.apple.quarantine ~/.local/bin/moonlight`, or right-click the file in Finder and choose Open.
- **No models found**: start Ollama (open the app, or run `ollama serve`), then `ollama list`. The agent rescans every minute, so it picks models up without a restart.
- **Port 8765 is taken**: run `laya-runner --port 8766`, then `moonlight --laya http://127.0.0.1:8766`.
- **"Another Moonlight agent is already running"**: run `moonlight stop`. Run only one agent per computer, unless each has its own `MOONLIGHT_HOME` and token.
- **"The gateway rejected this computer's token"**: the computer was removed in the web. Run `moonlight logout`, then `moonlight` to pair again.

## Development

```sh
node agent.mjs scan                                   # what this machine can serve
node test/stub-gateway.mjs --traffic                  # a stand-in gateway on :8787, sending demo traffic
node agent.mjs --gateway ws://127.0.0.1:8787/agent    # pairing auto-approves on the stub
node --test test/e2e.test.mjs                         # end-to-end, against the local Ollama (needs qwen2.5:0.5b)
AGENT_BIN=release/moonlight-linux-x64 node --test test/e2e.test.mjs   # the same tests against a built binary
./build.sh                                            # binaries for 5 platforms + install scripts into release/
```

Test environment variables:
- `LAYA_URL`: a running laya-runner; the decision test is skipped without one.
- `TEST_BIG_MODEL`: the model for the cheat test, default `qwen2.5:7b`; skipped if it isn't pulled.
- `OLLAMA_URL`: a non-default Ollama address.

`build.sh` needs [Bun](https://bun.sh) (it cross-compiles every target from one machine) and [rcodesign](https://github.com/indygreg/apple-platform-rs) to ad-hoc sign the macOS builds. Bun's cross-compiled darwin-x64 binary otherwise carries a signature that no longer matches its pages, and macOS kills it.
