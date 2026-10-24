#!/usr/bin/env bash
# Redeploy in one command: rsync gateway/, agent/agent.mjs, web/dist and the agent release files to the VM,
# install gateway deps when the lockfile changed, restart the service, reload Caddy, check health.
#   WEB_DIST=/path/to/web/dist RELEASE_DIR=/path/to/release deploy/deploy.sh
# Build web/dist elsewhere first; the VM never builds anything.
set -euo pipefail
cd "$(dirname "$0")"
source ./config.sh
ROOT=$(cd .. && pwd)
WEB_DIST=${WEB_DIST:-$ROOT/web/dist}
AGENT_FILE=${AGENT_FILE:-$ROOT/agent/agent.mjs}
RELEASE_DIR=${RELEASE_DIR:-$ROOT/agent/release}
IP=$(gcloud --project "$PROJECT" compute addresses describe "$IP_NAME" --region "$REGION" --format='value(address)')
HOST="$SSH_USER@$IP"
SSH="ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new"

# Gateway secrets live outside the repo; created once with fresh random values.
if [ ! -f "$SECRETS_FILE" ]; then
  mkdir -p "$(dirname "$SECRETS_FILE")"
  umask 077
  printf 'MOONLIGHT_TRUSTED_TOKENS=ml_st_%s\nMOONLIGHT_ADMIN_TOKEN=%s\n' "$(openssl rand -hex 16)" "$(openssl rand -hex 24)" > "$SECRETS_FILE"
  echo "created $SECRETS_FILE"
fi

sync() { rsync -az --delete -e "$SSH" "$@"; }
sync --exclude node_modules --exclude data --exclude test "$ROOT/gateway/" "$HOST:/opt/moonlight/gateway/"
if [ -f "$AGENT_FILE" ]; then $SSH "$HOST" mkdir -p /opt/moonlight/agent && sync "$AGENT_FILE" "$HOST:/opt/moonlight/agent/agent.mjs"; else echo "skip agent.mjs (none at $AGENT_FILE)"; fi
if [ -d "$WEB_DIST" ]; then $SSH "$HOST" mkdir -p /opt/moonlight/web && sync "$WEB_DIST/" "$HOST:/opt/moonlight/web/dist/"; else echo "skip web (no $WEB_DIST)"; fi
if [ -d "$RELEASE_DIR" ]; then sync "$RELEASE_DIR/" "$HOST:/opt/moonlight/release/"; else echo "skip release (no $RELEASE_DIR)"; fi
rsync -az -e "$SSH" Caddyfile moonlight-gateway.service "$HOST:/tmp/"
rsync -az -e "$SSH" --chmod=600 "$SECRETS_FILE" "$HOST:/tmp/gateway.env"

$SSH "$HOST" 'bash -s' <<'REMOTE'
set -euo pipefail
cd /opt/moonlight/gateway
if ! cmp -s package-lock.json .installed-lock 2>/dev/null; then
  npm ci --omit=dev --no-audit --no-fund --loglevel=error && cp package-lock.json .installed-lock
fi
sudo install -m 640 -o root -g moonlight /tmp/gateway.env /etc/moonlight/gateway.env && rm -f /tmp/gateway.env
sudo install -m 644 /tmp/moonlight-gateway.service /etc/systemd/system/moonlight-gateway.service
sudo install -m 644 /tmp/Caddyfile /etc/caddy/Caddyfile
sudo systemctl daemon-reload
sudo systemctl enable --now moonlight-gateway >/dev/null 2>&1
sudo systemctl restart moonlight-gateway
sudo systemctl reload caddy || sudo systemctl restart caddy
for i in $(seq 1 20); do curl -fsS localhost:8080/healthz >/dev/null 2>&1 && break; sleep 0.5; done
curl -fsS localhost:8080/healthz && echo
REMOTE
echo "deployed to https://$DOMAIN"
