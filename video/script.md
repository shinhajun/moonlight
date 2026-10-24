# Moonlight demo: narration script (approved, with edits)

Target 2:20 at ~150 wpm. `[ ]` = what's on screen.

## 1. Cold open (0:00–0:09)
[Blender: slow turntable of our card, the layers lift apart, VRAM chips light up]

> This is a graphics card. Most of the time, a lot of its memory sits unused.

## 2. Problem / promise (0:09–0:24)
[Text cards over the dark, glowing card]

> Meanwhile, developers want open models without renting and running a server.
> Moonlight connects the two. Earn from your spare GPU. Use open models for less.

## 3. Landing hero (0:24–0:44)
[moonlight.hajunshin.com/?gpu=3d, scripted scroll through the four story beats]

> Sellers run one small agent. It finds the open models they already have, in Ollama, LM Studio, llama.cpp or vLLM,
> and serves them in the VRAM their own apps aren't using.
> Buyers get one OpenAI-compatible API, and pay only for the tokens they use.

## 4. Seller flow (0:44–1:24)
[Terminal: curl | sh install → `moonlight` → model list + pairing code → browser approve → first-run summary → live dashboard]
[Web: /me seller dashboard, GPU card VRAM bar and earnings]

> Here's a seller joining. One line installs the agent.
> Run moonlight. It lists the models on this machine and prints a pairing code.
> Approve the computer in the browser, and you're selling. No keys to copy, no ports to open.
> The terminal becomes a live dashboard: each model's status, jobs served, earnings,
> and how the GPU memory splits between your apps, Moonlight, and what's spare.
> And when your own apps need the GPU, Moonlight pauses, finishes what it's doing, and steps aside.
> On the web, the same computer shows its VRAM bar and earnings.
> Sellers keep ninety percent of every request, at the price they set.

## 5. Buyer flow (1:24–1:54)
[/chat, model "Any small model", a real question streams, receipt: GPU name, cost, Verified]
[/docs → create API key → terminal: 3-line OpenAI SDK call → real answer]

> Now the buyer. In Chat, pick "Any small model" and ask anything.
> The answer streams from a seller's GPU, and the receipt shows which GPU served it, what it cost, and that it's verified.
> For your own code, create an API key. Point the OpenAI SDK at Moonlight's base URL, and that's the whole integration.
> Or let Moonlight pick: auto/chat-small routes to the best available GPU.

## 6. Trust (1:54–2:14)
[Cheater agent terminal with the DEMO: CHEAT MODE banner → model page listing turns Flagged → verification log fails]

> But how do you know a seller runs the model they listed?
> Moonlight hides canary jobs among real requests. At eight points in a reference answer,
> the seller's next three words have to match what a trusted reference GPU says.
> This seller lists Qwen 2.5 1.5B but secretly serves the 0.5B. A few checks later, it's flagged,
> taken off the market, and its earnings are held.

## 7. Outro (2:14–2:22)
[Logo, tagline, moonlight.hajunshin.com, github.com/shinhajun/moonlight, "Moonlighters · SBUHacks 2026"]

> Moonlight. Earn from your spare GPU. Use open models for less.

---
Approved by the orchestrator with edits 1–5 applied. No figures in narration. On-screen titles carry only the narration's claims.
