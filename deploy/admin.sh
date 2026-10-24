#!/usr/bin/env bash
# Operator helpers for demos. Reads the admin token from $SECRETS_FILE; never prints it.
#   deploy/admin.sh listings <model_id>          listing ids, seller, node, state for a model
#   deploy/admin.sh verify-rate <listing_id> <0..1>
#   deploy/admin.sh check <listing_id>           run one verification check now, print the result
#   deploy/admin.sh delete-account <exact name>  delete non-operator accounts with that name and all their data
set -euo pipefail
SELF=$(realpath "$0")
cd "$(dirname "$0")"
source ./config.sh
B="https://$DOMAIN"
ADMIN=$(grep '^MOONLIGHT_ADMIN_TOKEN=' "$SECRETS_FILE" | cut -d= -f2)
admin() { curl -sS -H "authorization: Bearer $ADMIN" -H 'content-type: application/json' "$@"; }

case "${1:-}" in
  listings)
    curl -fsS "$B/api/models/$2" | python3 -c '
import json, sys
for l in json.load(sys.stdin)["listings"]:
    v = l["verification"]
    print(l["listing_id"], l["seller"]["name"], "|", l["node"]["name"], "| online" if l["node"]["online"] else "| offline",
          "|", v["state"], v["passed"], "passed", v["failed"], "failed", "| paused" if l.get("paused") else "")'
    ;;
  verify-rate)
    admin -X POST "$B/api/admin/listings/$2" -d "{\"verify_rate\": $3}" | python3 -c '
import json, sys
d = json.load(sys.stdin)
if "error" in d: sys.exit("error: " + d["error"]["message"])
print(d["listing_id"], d["model_id"], "verify_rate set; state", d["verification"]["state"])'
    ;;
  check)
    admin -X POST "$B/api/admin/verify/$2" | python3 -c '
import json, sys
d = json.load(sys.stdin)
if "error" in d: sys.exit("error: " + d["error"]["message"])
c = d["check"]
if c is None: print("inconclusive (no reference, node busy or offline)")
else: print("%s %s=%.3f threshold %s -> %s, state %s" % (c["method"], c["metric"], c["score"], c["threshold"], "PASS" if c["passed"] else "FAIL", c["state"]))'
    ;;
  delete-account)
    NAME=${2:?account name}
    [[ "$NAME" =~ ^[A-Za-z0-9\ ._-]+$ ]] || { echo "unsupported characters in name" >&2; exit 1; }
    ssh -i "$SSH_KEY" "$SSH_USER@$(dig +short "$DOMAIN" | tail -1)" "sudo -u moonlight sqlite3 /var/lib/moonlight/moonlight.sqlite" <<SQL
BEGIN;
CREATE TEMP TABLE gone AS SELECT id FROM accounts WHERE role = 'user' AND trusted = 0 AND name = '$NAME';
CREATE TEMP TABLE gone_nodes AS SELECT id FROM nodes WHERE seller_id IN (SELECT id FROM gone);
CREATE TEMP TABLE greq AS SELECT id FROM requests WHERE buyer_id IN (SELECT id FROM gone) OR seller_id IN (SELECT id FROM gone) OR node_id IN (SELECT id FROM gone_nodes);
UPDATE accounts SET balance = balance - (SELECT COALESCE(SUM(amount), 0) FROM ledger WHERE kind = 'fee' AND request_id IN (SELECT id FROM greq)) WHERE id = 'platform';
DELETE FROM ledger WHERE request_id IN (SELECT id FROM greq) OR account_id IN (SELECT id FROM gone);
DELETE FROM requests WHERE id IN (SELECT id FROM greq);
DELETE FROM checks WHERE listing_id IN (SELECT id FROM listings WHERE seller_id IN (SELECT id FROM gone)) OR node_id IN (SELECT id FROM gone_nodes);
DELETE FROM node_listings WHERE node_id IN (SELECT id FROM gone_nodes) OR listing_id IN (SELECT id FROM listings WHERE seller_id IN (SELECT id FROM gone));
DELETE FROM listings WHERE seller_id IN (SELECT id FROM gone);
DELETE FROM pairings WHERE account_id IN (SELECT id FROM gone) OR node_id IN (SELECT id FROM gone_nodes);
DELETE FROM nodes WHERE id IN (SELECT id FROM gone_nodes);
DELETE FROM keys WHERE account_id IN (SELECT id FROM gone);
DELETE FROM sessions WHERE account_id IN (SELECT id FROM gone);
SELECT 'deleting ' || COUNT(*) || ' account(s), ' || (SELECT COUNT(*) FROM gone_nodes) || ' node(s), ' || (SELECT COUNT(*) FROM greq) || ' request(s)' FROM gone;
DELETE FROM accounts WHERE id IN (SELECT id FROM gone);
COMMIT;
SELECT 'remaining accounts: ' || group_concat(name, ', ') FROM accounts;
SQL
    ;;
  *) sed -n '2,6p' "$SELF"; exit 1 ;;
esac
