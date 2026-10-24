#!/bin/sh
# Operator only: runs this server's trusted reference agent against the live gateway.
# Reads the operator token from ~/.config/moonlight/gateway.env (MOONLIGHT_TRUSTED_TOKENS) and never prints it.
# Start laya-runner first (port 8765 is taken on vada-ai, so it runs on 8766):
#   cd laya-runner && uv run laya-runner --port 8766
set -eu
cd "$(dirname "$0")/.."
TOKEN=$(sed -n 's/^MOONLIGHT_TRUSTED_TOKENS=//p' "$HOME/.config/moonlight/gateway.env" | tr -d "\"'" | cut -d, -f1)
[ -n "$TOKEN" ] || { echo "MOONLIGHT_TRUSTED_TOKENS is missing from ~/.config/moonlight/gateway.env" >&2; exit 1; }
export MOONLIGHT_TOKEN="$TOKEN" MOONLIGHT_HOME="$HOME/.moonlight-reference"
exec node agent.mjs --trusted --name "${REF_NAME:-Moonlight reference (RTX 5090)}" --laya "${LAYA_URL:-http://127.0.0.1:8766}" \
  --models "${REF_MODELS:-qwen2.5:7b,qwen2.5:0.5b,qwen3.5:35b-a3b,gemma4:26b,glm-4.7-flash,bge-m3,nomic-embed-text,laya-base}" "$@"
