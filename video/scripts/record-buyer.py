"""Buyer's first API call: the key created on camera (out/tmp/sync/api_key, from record-buyer-web.mjs) and the
OpenAI Python SDK pointed at Moonlight's base URL. → out/assets/rec/buyer.cast

    python3 scripts/record-buyer.py     (needs /tmp/mlv/venv with `openai` installed)
"""
import os
import shutil
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'lib'))
from termrec import Term  # noqa: E402

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..'))
HOME = '/tmp/mlv/buyer'
VENV = '/tmp/mlv/venv'
PROMPT = r'vada-ai ~ \$ $'
ASK = '''from openai import OpenAI

client = OpenAI(base_url="https://moonlight.hajunshin.com/v1")
reply = client.chat.completions.create(
    model="auto/chat-small",
    messages=[{"role": "user", "content": "Say hello to SBUHacks in one short sentence."}],
)
print(reply.model, "->", reply.choices[0].message.content)
'''


def main():
    key = open(os.path.join(ROOT, 'out/tmp/sync/api_key')).read().strip()
    shutil.rmtree(HOME, ignore_errors=True)
    os.makedirs(HOME)
    open(os.path.join(HOME, 'ask.py'), 'w').write(ASK)
    env = {
        'HOME': HOME, 'PATH': f'{VENV}/bin:/usr/local/bin:/usr/bin:/bin', 'TERM': 'xterm-256color', 'COLORTERM': 'truecolor',
        'LANG': 'C.UTF-8', 'HISTFILE': '/dev/null', 'PS1': r'\[\e[90m\]\h\[\e[0m\] \[\e[1m\]\w\[\e[0m\] \$ ',
    }
    t = Term(os.path.join(ROOT, 'out/assets/rec/buyer.cast'), cols=112, rows=26, env=env, cwd=HOME)
    try:
        t.wait_for(PROMPT, 10)
        t.sleep(1.0)
        t.mark('key')
        t.type('export OPENAI_API_KEY=')
        t.sleep(0.3)
        t.send(key)                      # pasted, as you would from the Copy button
        t.enter(0.5)
        t.wait_for(PROMPT, 10, since=t.cursor() - 2)
        t.sleep(0.8)
        t.mark('cat')
        c = t.cursor()
        t.type('cat ask.py')
        t.enter()
        t.wait_for(PROMPT, 10, since=c + 5)
        t.sleep(1.5)
        t.mark('run')
        c = t.cursor()
        t.type('python3 ask.py')
        t.enter()
        t.wait_for(r'->', 90, since=c)
        t.mark('answer')
        t.wait_for(PROMPT, 30, since=c + 5)
        t.sleep(3.0)
    finally:
        t.close()


if __name__ == '__main__':
    main()
