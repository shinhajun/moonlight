"""Trust scene, for real: a second agent ("Demo Cheater") lists qwen2.5:1.5b but serves qwen2.5:0.5b (--cheat-serve,
a demo flag). After a few real buyer jobs, the operator's admin helper runs verification checks on its listing until
the gateway flags it. Writes out/assets/rec/cheater.cast and out/assets/rec/checks.json (each check's printed result);
record-trust-web.mjs films the model page and the cheater's verification log through out/tmp/sync.

    python3 scripts/record-cheater.py      (run record-trust-web.mjs alongside it)
"""
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.request

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'lib'))
from termrec import Term  # noqa: E402
from importlib import import_module  # noqa: E402

seller_rec = import_module('record-seller')
ROOT = seller_rec.ROOT
B = seller_rec.B
SYNC = seller_rec.SYNC
HOME = '/tmp/mlv/cheater'
GATEWAY = os.path.expanduser('~/projects/moonlight-gateway')
PROMPT = r'vada-ai ~ \$ $'
MODEL = 'qwen2.5:1.5b'


def admin(*args):
    r = subprocess.run(['deploy/admin.sh', *args], cwd=GATEWAY, capture_output=True, text=True, timeout=180)
    out = (r.stdout + r.stderr).strip()
    print('admin', ' '.join(args), '->', out, flush=True)
    return out


def listing_state(listing_id):
    with urllib.request.urlopen(f'{B}/api/models/{MODEL}') as r:
        for l in json.load(r)['listings']:
            if l['listing_id'] == listing_id:
                return l['verification']['state']
    return None


def main():
    accounts = seller_rec.ACCOUNTS
    shutil.rmtree(HOME, ignore_errors=True)
    os.makedirs(f'{HOME}/.local/bin')
    shutil.copy2('/tmp/mlv/seller/.local/bin/moonlight', f'{HOME}/.local/bin/moonlight')   # installed earlier with curl | sh
    shutil.rmtree(SYNC, ignore_errors=True)
    os.makedirs(SYNC)
    cheater = seller_rec.session(accounts['cheater'])
    buyer = seller_rec.session(accounts['buyer'])
    key = seller_rec.post(buyer, '/api/me/keys', {'name': 'cheater-demo-traffic'})

    env = {
        'HOME': HOME, 'PATH': f'{HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin', 'TERM': 'xterm-256color',
        'COLORTERM': 'truecolor', 'LANG': 'C.UTF-8', 'HISTFILE': '/dev/null',
        'PS1': r'\[\e[90m\]\h\[\e[0m\] \[\e[1m\]\w\[\e[0m\] \$ ',
    }
    t = Term(os.path.join(ROOT, 'out/assets/rec/cheater.cast'), cols=112, rows=26, env=env, cwd=HOME)
    checks = []
    try:
        t.wait_for(PROMPT, 10)
        t.sleep(1.0)
        t.mark('run')
        c = t.cursor()
        t.type(f'moonlight --name "Too-good-to-be-true GPU" --models {MODEL} --cheat-serve qwen2.5:0.5b')
        t.enter()
        code = t.wait_for(r'\b([A-Z0-9]{4}-[A-Z0-9]{4})\b', 60, since=c).group(1)
        time.sleep(1.5)
        seller_rec.post(cheater, f'/api/devices/{code}/approve', {})
        t.wait_for(r'Press any key', 60, since=c)
        t.sleep(1.0)
        t.send(' ')
        t.wait_for(r'● online', 30, since=c)
        t.mark('dashboard')
        # A few real buyer jobs: the cheater earns from them, quietly serving the smaller model.
        seller_rec.traffic(key['secret'], accounts['cheater']['id'], 3, 1.5)
        line = next(l for l in admin('listings', MODEL).splitlines() if 'Demo Cheater' in l)
        listing = line.split()[0]
        admin('verify-rate', listing, '1')
        sync_listing = os.path.join(SYNC, 'cheater_live')
        open(sync_listing, 'w').write(listing)
        seller_rec.sync_wait('model_rec', 60)
        t.sleep(3.0)
        t.mark('checks')
        for i in range(4):
            started = time.time()
            out = admin('check', listing)
            checks.append({'epoch_start': started, 'epoch_end': time.time(), 'result': out})
            t.mark(f'check{i + 1}')
            if listing_state(listing) == 'flagged':
                break
            time.sleep(1.0)
        t.mark('flagged')
        t.sleep(10.0)                       # the model page refreshes every 8 s
        seller_rec.sync_write('checks_done')
        seller_rec.sync_wait('web_done', 120)
        t.mark('quit')
        t.send('q')
        t.wait_for(PROMPT, 60, since=t.cursor())
        t.sleep(1.0)
    finally:
        t.close()
        json.dump({'checks': checks}, open(os.path.join(ROOT, 'out/assets/rec/checks.json'), 'w'), indent=2)
        try:
            seller_rec.post(buyer, f"/api/me/keys/{key['key']['id']}", None, method='DELETE')
        except Exception as e:  # noqa: BLE001
            print('could not delete traffic key', e)


if __name__ == '__main__':
    main()
