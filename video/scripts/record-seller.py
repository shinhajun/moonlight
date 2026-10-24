"""Seller flow, for real: a fresh HOME installs the agent with curl | sh, pairs it to "Demo Seller", serves a few real
buyer requests, then yields when a GPU render starts. Writes out/assets/rec/seller.cast; record-seller-web.mjs films
the browser side (approve, then the web dashboard) through the marker files in out/tmp/sync.

    python3 scripts/record-seller.py        (run record-seller-web.mjs alongside it)
"""
import http.cookiejar
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'lib'))
from termrec import Term  # noqa: E402

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..'))
B = 'https://moonlight.hajunshin.com'
SYNC = os.path.join(ROOT, 'out/tmp/sync')
HOME = '/tmp/mlv/seller'          # short on purpose: the agent prints its config path
ACCOUNTS = json.load(open(os.path.join(ROOT, 'out/tmp/accounts.json')))
PROMPT = r'vada-ai ~ \$ $'


def sync_write(name, value=''):
    open(os.path.join(SYNC, name), 'w').write(value)


def sync_wait(name, timeout=300):
    end = time.time() + timeout
    while time.time() < end:
        if os.path.exists(os.path.join(SYNC, name)):
            return
        time.sleep(0.2)
    raise TimeoutError(name)


def session(acct):
    jar = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    req = urllib.request.Request(f'{B}/api/auth/login', json.dumps({'email': acct['email'], 'password': acct['password']}).encode(),
                                 {'content-type': 'application/json'})
    op.open(req).read()
    return op


def post(op_or_key, path, body, method='POST'):
    headers = {'content-type': 'application/json'}
    if isinstance(op_or_key, str):
        headers['authorization'] = f'Bearer {op_or_key}'
        op = urllib.request.build_opener()
    else:
        op = op_or_key
    req = urllib.request.Request(f'{B}{path}', json.dumps(body).encode() if body is not None else None, headers, method=method)
    with op.open(req, timeout=120) as r:
        return json.loads(r.read() or b'null')


# Real buyer traffic for the new seller, so its dashboard shows jobs and earnings.
QUESTIONS = ['Give me one tip for writing clear commit messages.', 'What is a GPU heatsink for? One sentence.',
             'Name two uses for text embeddings.', 'Suggest a name for a moon-themed cafe.',
             'What does VRAM stand for?', 'Explain latency in one sentence.', 'Write a haiku about spare compute.',
             'What is a token in a language model? One sentence.']


def traffic(key, seller, n, gap):
    for i in range(n):
        q = QUESTIONS[i % len(QUESTIONS)]
        try:
            if i % 4 == 2:
                post(key, '/v1/embeddings', {'model': 'nomic-embed-text', 'input': [q], 'moonlight': {'seller': seller}})
            else:
                r = post(key, '/v1/chat/completions', {'model': 'qwen2.5:1.5b', 'max_tokens': 80, 'moonlight': {'seller': seller},
                                                      'messages': [{'role': 'user', 'content': q}]})
                print('  job ok', r['usage']['completion_tokens'], 'tok', flush=True)
        except Exception as e:  # noqa: BLE001
            print('  job failed', e, flush=True)
        time.sleep(gap)


def main():
    shutil.rmtree(HOME, ignore_errors=True)
    os.makedirs(HOME)
    shutil.rmtree(SYNC, ignore_errors=True)
    os.makedirs(SYNC)
    buyer = session(ACCOUNTS['buyer'])
    key = post(buyer, '/api/me/keys', {'name': 'seller-demo-traffic'})
    seller = ACCOUNTS['seller']['id']

    env = {
        'HOME': HOME, 'PATH': f'{HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin', 'TERM': 'xterm-256color',
        'COLORTERM': 'truecolor', 'LANG': 'C.UTF-8', 'HISTFILE': '/dev/null',
        'PS1': r'\[\e[90m\]\h\[\e[0m\] \[\e[1m\]\w\[\e[0m\] \$ ',
    }
    t = Term(os.path.join(ROOT, 'out/assets/rec/seller.cast'), cols=112, rows=26, env=env, cwd=HOME)
    try:
        t.wait_for(PROMPT, 10)
        t.sleep(1.2)
        t.mark('install')
        c = t.cursor()
        t.type('curl -fsSL https://moonlight.hajunshin.com/install.sh | sh')
        t.enter()
        t.wait_for(PROMPT, 180, since=c + 10)
        t.sleep(1.2)
        t.mark('run')
        c = t.cursor()
        t.type('moonlight --models qwen2.5:1.5b,nomic-embed-text --keep-alive 2m')
        t.enter()
        code = t.wait_for(r'\b([A-Z0-9]{4}-[A-Z0-9]{4})\b', 60, since=c).group(1)
        t.mark('code')
        sync_write('pair_code', code)
        t.wait_for(r'Approved\.', 300, since=c)
        t.mark('approved')
        t.wait_for(r'Press any key', 30, since=c)
        t.sleep(4.0)
        t.send(' ')
        t.mark('dashboard')
        t.wait_for(r'● online', 30, since=c)
        t.sleep(2.0)
        t.mark('traffic')
        traffic(key['secret'], seller, 6, 1.6)
        t.sleep(3.0)
        sync_write('web_dashboard')
        threading.Thread(target=traffic, args=(key['secret'], seller, 3, 3.0), daemon=True).start()
        sync_wait('web_done', 120)
        t.sleep(1.0)
        # The owner starts a GPU render of their own (Blender, Cycles): the agent sees the GPU busy and yields.
        t.mark('owner_render')
        load = subprocess.Popen([os.path.expanduser('~/opt/blender/blender'), '-b', '--factory-startup', '--python',
                                 os.path.join(ROOT, 'blender/gpu_anim.py'), '--', '--out', os.path.join(ROOT, 'out/tmp/load'),
                                 '--samples', '4096', '--frames', '400-401'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            t.wait_for(r'YIELDING TO YOU', 60, since=c)
            t.mark('yielding')
            t.sleep(9.0)
        finally:
            load.terminate()
            load.wait()
        t.mark('quit')
        t.send('q')
        t.wait_for(PROMPT, 60, since=t.cursor())
        t.sleep(1.5)
    finally:
        t.close()
        try:
            post(buyer, f"/api/me/keys/{key['key']['id']}", None, method='DELETE')
        except Exception as e:  # noqa: BLE001
            print('could not delete traffic key', e)


if __name__ == '__main__':
    main()
