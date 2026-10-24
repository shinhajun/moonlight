#!/usr/bin/env bash
# One-time infra: static IP, firewall for 80/443, the VM. Safe to re-run; existing resources are kept.
set -euo pipefail
cd "$(dirname "$0")"
source ./config.sh
g() { gcloud --project "$PROJECT" "$@"; }

g compute addresses describe "$IP_NAME" --region "$REGION" >/dev/null 2>&1 ||
  g compute addresses create "$IP_NAME" --region "$REGION"
IP=$(g compute addresses describe "$IP_NAME" --region "$REGION" --format='value(address)')

g compute firewall-rules describe moonlight-web >/dev/null 2>&1 ||
  g compute firewall-rules create moonlight-web --network default --allow tcp:80,tcp:443 --target-tags moonlight --source-ranges 0.0.0.0/0

g compute instances describe "$VM" --zone "$ZONE" >/dev/null 2>&1 ||
  g compute instances create "$VM" --zone "$ZONE" --machine-type "$MACHINE" \
    --image-family debian-12 --image-project debian-cloud --boot-disk-size 20GB --boot-disk-type pd-standard \
    --address "$IP" --tags moonlight --metadata enable-oslogin=FALSE

echo "$IP"
