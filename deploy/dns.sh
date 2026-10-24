#!/usr/bin/env bash
# Point $DOMAIN at the VM's static IP on Cloudflare, DNS only (proxied=false), so traffic goes straight to GCP.
# Touches only the A record for $DOMAIN. Uses the operator's scoped token (DNS Edit on the zone), read from a
# local file; it is never printed, committed, or copied to the VM.
set -euo pipefail
cd "$(dirname "$0")"
source ./config.sh
TOKEN_FILE="${CF_TOKEN_FILE:-$HOME/.config/cloudflare/roulette-pages-token}"
IP=$(gcloud --project "$PROJECT" compute addresses describe "$IP_NAME" --region "$REGION" --format='value(address)')
CF_TOKEN=$(tr -d '[:space:]' < "$TOKEN_FILE")
[ -n "$CF_TOKEN" ] || { echo "empty token file" >&2; exit 1; }

cf() { curl -fsS -H "Authorization: Bearer $CF_TOKEN" -H 'Content-Type: application/json' "$@"; }
API=https://api.cloudflare.com/client/v4
ZONE_NAME=${DOMAIN#*.}
ZONE_ID=$(cf "$API/zones?name=$ZONE_NAME" | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"][0]["id"])')
REC_ID=$(cf "$API/zones/$ZONE_ID/dns_records?type=A&name=$DOMAIN" | python3 -c 'import json,sys; r=json.load(sys.stdin)["result"]; print(r[0]["id"] if r else "")')
BODY=$(printf '{"type":"A","name":"%s","content":"%s","ttl":120,"proxied":false}' "$DOMAIN" "$IP")
if [ -n "$REC_ID" ]; then cf -X PUT "$API/zones/$ZONE_ID/dns_records/$REC_ID" --data "$BODY" >/dev/null; else cf -X POST "$API/zones/$ZONE_ID/dns_records" --data "$BODY" >/dev/null; fi
echo "$DOMAIN A $IP (DNS only)"
