"""Re-records only the seller's web dashboard (out/assets/rec/seller-web.mp4), with fresh demo accounts: a new
"Demo Buyer" (created first, so it gets the day's demo credit) and "Demo Seller". The agent is installed and paired
off camera, serves a few real jobs, and the dashboard is filmed by record-seller-web.mjs --dashboard-only.
The previous clip is kept as seller-web.v1.mp4. Delete both accounts afterwards (deploy/admin.sh delete-account).

    python3 scripts/record-dashboard.py
"""
import json
import os
import re
import secrets
import shutil
import signal
import subprocess
import sys
import threading
import time
import urllib.request

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..'))
B = 'https://moonlight.hajunshin.com'
HOME = '/tmp/mlv/dash'
REC = os.path.join(ROOT, 'out/assets/rec')
ACCOUNTS = os.path.join(ROOT, 'out/tmp/accounts.json')


def signup():
    """Creates whichever demo account is missing from accounts.json (the buyer first: it needs the day's credit)."""
    accounts = json.load(open(ACCOUNTS)) if os.path.exists(ACCOUNTS) else {}
    for role, name in [('buyer', 'Demo Buyer'), ('seller', 'Demo Seller')]:
        if role in accounts:
            continue
        email, password = f'moonlighters.demo2.{role}@example.com', secrets.token_urlsafe(16)
        req = urllib.request.Request(f'{B}/api/auth/signup', json.dumps({'email': email, 'password': password, 'name': name}).encode(),
                                     {'content-type': 'application/json'})
        d = json.load(urllib.request.urlopen(req))
        print(role, d['account']['id'], 'credit', d.get('demo_credit_microusd'), flush=True)
        accounts[role] = {'email': email, 'password': password, 'name': name, 'id': d['account']['id']}
    os.makedirs(os.path.dirname(ACCOUNTS), exist_ok=True)
    with open(ACCOUNTS, 'w') as f:
        json.dump(accounts, f, indent=2)
    os.chmod(ACCOUNTS, 0o600)
    return accounts


def main():
    signup()
    sys.path.insert(0, os.path.dirname(__file__))
    from importlib import import_module
    rs = import_module('record-seller')       # session, post, traffic helpers
    accounts = rs.ACCOUNTS
    buyer, seller = rs.session(accounts['buyer']), rs.session(accounts['seller'])

    shutil.rmtree(HOME, ignore_errors=True)
    os.makedirs(HOME)
    env = {'HOME': HOME, 'PATH': f'{HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin', 'LANG': 'C.UTF-8'}
    subprocess.run('curl -fsSL https://moonlight.hajunshin.com/install.sh | sh', shell=True, env=env, check=True, stdout=subprocess.DEVNULL)
    agent = subprocess.Popen(['moonlight', '--plain', '--no-browser', '--models', 'qwen2.5:1.5b,nomic-embed-text', '--keep-alive', '2m'],
                             env=env, cwd=HOME, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    key = None
    try:
        for line in agent.stdout:
            m = re.search(r'\b([A-Z0-9]{4}-[A-Z0-9]{4})\b', line)
            if m:
                rs.post(seller, f'/api/devices/{m.group(1)}/approve', {})
                break
        # Keep draining the agent's log so a full pipe never blocks it.
        threading.Thread(target=lambda: [print('  agent:', l.rstrip(), flush=True) for l in agent.stdout], daemon=True).start()
        # Wait until the node is online with its models live.
        end = time.time() + 90
        while time.time() < end:
            with rs.session(accounts['seller']).open(f'{B}/api/me/nodes') as r:
                nodes = json.load(r)['nodes']
            if nodes and nodes[0]['online'] and any(m['policy'] == 'live' for m in nodes[0]['models']):
                break
            time.sleep(2)
        else:
            raise TimeoutError('node did not come online')
        key = rs.post(buyer, '/api/me/keys', {'name': 'dashboard-demo-traffic'})
        rs.traffic(key['secret'], accounts['seller']['id'], 7, 1.2)
        for f in ('seller-web.mp4', 'seller-web.json'):
            v1 = os.path.join(REC, f.replace('seller-web', 'seller-web.v1'))
            if not os.path.exists(v1):
                shutil.copy2(os.path.join(REC, f), v1)
        os.makedirs(rs.SYNC, exist_ok=True)
        subprocess.run(['node', os.path.join(ROOT, 'scripts/record-seller-web.mjs'), '--dashboard-only'], cwd=ROOT, check=True)
    finally:
        agent.send_signal(signal.SIGINT)     # graceful: finishes jobs, tells the gateway
        try:
            agent.wait(45)
        except subprocess.TimeoutExpired:
            agent.kill()
        if key:
            rs.post(buyer, f"/api/me/keys/{key['key']['id']}", None, method='DELETE')
        shutil.rmtree(HOME, ignore_errors=True)


if __name__ == '__main__':
    main()
