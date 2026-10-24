#!/usr/bin/env bash
# One-time VM setup, run as root on the VM by deploy/provision-remote.sh: Node 22, Caddy, a swap file,
# the moonlight user and directories. Safe to re-run.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
DEPLOY_USER=${1:-moonlight-deploy}

if ! swapon --show | grep -q /swapfile; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q /swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

apt-get update -qq
apt-get install -y -qq curl gnupg ca-certificates debian-keyring debian-archive-keyring apt-transport-https rsync sqlite3 >/dev/null

if ! node --version 2>/dev/null | grep -q '^v22'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi

if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi

id moonlight >/dev/null 2>&1 || useradd --system --home /var/lib/moonlight --shell /usr/sbin/nologin moonlight
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 755 /opt/moonlight
install -d -o moonlight -g moonlight -m 750 /var/lib/moonlight
install -d -o root -g moonlight -m 750 /etc/moonlight
echo "node $(node --version), caddy $(caddy version | cut -d' ' -f1)"
