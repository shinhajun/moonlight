# laya-runner

Serves [Laya](https://huggingface.co/convaiinnovations/laya) decision models on a TypeSafe Jev-compatible `POST /v1/systemone`, so the Moonlight agent can sell them. Laya is Apache-2.0: a non-autoregressive System-1 model that returns typed answers (`noul`, `choice`, `score`) with calibrated probabilities in one forward pass.

```sh
uv run laya-runner                      # from this directory; or `moonlight laya install`, then `laya-runner`
uv run laya-runner --models laya-base,laya-multilingual --port 8766
uv run laya-runner --private hajun/support-triage=./checkpoints/support-triage
```

- It picks the device automatically: CUDA, then Apple MPS, then CPU. Force one with `--device`.
- It binds `127.0.0.1:8765` by default, because the agent runs on the same computer.
- The first start downloads the weights from Hugging Face: 842 MB for `laya-base`, 644 MB for `laya-multilingual`.

| Device | 1 question | 3 questions |
|---|---|---|
| RTX 5090 | 7 ms | 8 ms |
| Ryzen 9950X CPU | 106 ms | 186 ms |

CPU and CUDA answers differ by at most 0.0023 in probability.

## API

`GET /health`:
```json
{"model_id": "laya-base", "digest": "891102d3…", "device": "mps",
 "models": [{"model_id": "laya-base", "digest": "891102d3…", "kind": "decision", "private": false}]}
```
`digest` is the sha256 of the checkpoint's `model.safetensors`. That is the reference Moonlight checks for public models.

`POST /v1/systemone` takes Jev's request shape and returns Jev's response shape (field names and order). Laya reports `output_tokens: 0`:
```json
{"model": "laya-base",
 "state": {"ticket": "I was charged twice, please refund"},
 "questions": {
   "billing": {"type": "noul", "instructions": "Is `ticket` about billing?"},
   "team": {"type": "choice", "instructions": "Which team?", "criteria": {"billing": "payments", "tech": "bugs"}},
   "urgency": {"type": "score", "instructions": "How urgent?", "criteria": ["low", "medium", "high"]}}}
```
```json
{"model": "laya-base",
 "answers": {
   "billing": {"type": "noul", "noul": 0.94},
   "team": {"type": "choice", "choice": "billing", "confidence": 0.98, "probabilities": {"billing": 0.99, "tech": 0.01}},
   "urgency": {"type": "score", "score": 1.7, "confidence": 0.56, "legend": {"0": "low", "1": "medium", "2": "high"},
               "probabilities": {"0": 0.05, "1": 0.19, "2": 0.76}}},
 "usage": {"input_tokens": 244, "output_tokens": 0}}
```
- `confidence` uses Jev's formula, so thresholds carry over from Jev.
- A malformed question gets a 422 that names the problem. As with Jev, `score` criteria must be a list.
- An unknown `model` gets a 404.
