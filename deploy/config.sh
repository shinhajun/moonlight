# Shared settings for the deploy scripts.
PROJECT=vada-so
REGION=us-east1
ZONE=us-east1-b
VM=moonlight-gw
IP_NAME=moonlight-ip
MACHINE=e2-micro
DOMAIN=moonlight.hajunshin.com
SSH_USER=moonlight-deploy
SSH_KEY="$HOME/.ssh/moonlight_deploy"
# Gateway secrets (trusted seller tokens, admin token). Never committed; copied to the VM as /etc/moonlight/gateway.env.
SECRETS_FILE="$HOME/.config/moonlight/gateway.env"
