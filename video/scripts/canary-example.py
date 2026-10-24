"""A real teacher-forced next-words check, run locally for the trust explainer graphic (PROTOCOL.md, Verification):
the reference model's greedy answer is cut at 8 word boundaries; at each one the prefix is sent back as a trailing
assistant message, and the first 3 words that follow are compared between the reference (qwen2.5:1.5b) and a smaller
model posing as it (qwen2.5:0.5b). → out/assets/canary.json

    python3 scripts/canary-example.py ["prompt"]
"""
import json
import os
import re
import sys
import urllib.request

OLLAMA = 'http://127.0.0.1:11434/v1/chat/completions'
REF, CHEAT = 'qwen2.5:1.5b', 'qwen2.5:0.5b'
PROMPT = sys.argv[1] if len(sys.argv) > 1 else 'In one sentence, why is the sky blue?'
WORDS = re.compile(r"\w+|[^\w\s]")
OUT = os.path.join(os.path.dirname(__file__), '../out/assets/canary.json')


def chat(model, prefix=None, max_tokens=120):
    msgs = [{'role': 'user', 'content': PROMPT}] + ([{'role': 'assistant', 'content': prefix}] if prefix else [])
    body = {'model': model, 'messages': msgs, 'temperature': 0, 'seed': 42, 'max_tokens': max_tokens, 'keep_alive': '2m'}
    req = urllib.request.Request(OLLAMA, json.dumps(body).encode(), {'content-type': 'application/json'})
    return json.load(urllib.request.urlopen(req, timeout=120))['choices'][0]['message']['content']


answer = chat(REF)
spaces = [m.start() for m in re.finditer(r' ', answer)]
# 8 boundaries spread over the answer, skipping the first one
picks = [spaces[round((i + 1) * (len(spaces) - 1) / 9)] for i in range(8)]
points = []
for at in picks:
    prefix = answer[:at]
    ref = WORDS.findall(chat(REF, prefix, 8).lower())[:3]
    cheat = WORDS.findall(chat(CHEAT, prefix, 8).lower())[:3]
    points.append({'at': at, 'reference': ref, 'cheater': cheat, 'match': ref == cheat})
    print(f'{at:4d} ref={ref} cheat={cheat} {"OK" if ref == cheat else "x"}')
res = {'prompt': PROMPT, 'answer': answer, 'reference_model': REF, 'cheater_model': CHEAT, 'points': points,
       'matched': sum(p['match'] for p in points), 'needed': 5}
json.dump(res, open(OUT, 'w'), indent=2)
print(answer)
print('matched', res['matched'], 'of 8')
