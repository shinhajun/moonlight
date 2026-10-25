"""A scripted terminal session, recorded as an asciicast v2 file (real commands in a real pty).

    t = Term('out/assets/rec/seller.cast', cols=112, rows=26, env={...})
    t.type('moonlight'); t.enter(); t.wait_for(r'[A-Z0-9]{4}-[A-Z0-9]{4}'); t.mark('code'); t.close()

Typing is paced like a person; `mark` stores named wall-clock moments in the cast (as "m" events) so the
browser recordings can be lined up with it.
"""
import json
import os
import pty
import random
import re
import select
import signal
import struct
import fcntl
import termios
import threading
import time

ANSI = re.compile(r'\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[=>()][0-9A-Za-z]?')


class Term:
    def __init__(self, path, cols=112, rows=26, env=None, cwd=None, shell=('bash', '--noprofile', '--norc', '-i')):
        self.path, self.cols, self.rows = path, cols, rows
        self.start = time.time()
        self.events = []
        self.text = ''           # everything printed, without escape codes, for wait_for
        self.lock = threading.Lock()
        pid, fd = pty.fork()
        if pid == 0:
            os.chdir(cwd or os.getcwd())
            os.execvpe(shell[0], list(shell), env or os.environ)
        self.pid, self.fd = pid, fd
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
        self.alive = True
        self.reader = threading.Thread(target=self._read, daemon=True)
        self.reader.start()

    def now(self):
        return time.time() - self.start

    def _read(self):
        while self.alive:
            r, _, _ = select.select([self.fd], [], [], 0.1)
            if not r:
                continue
            try:
                data = os.read(self.fd, 65536)
            except OSError:
                break
            if not data:
                break
            s = data.decode('utf-8', 'replace')
            with self.lock:
                self.events.append([round(self.now(), 4), 'o', s])
                self.text += ANSI.sub('', s)

    def send(self, s):
        os.write(self.fd, s.encode())

    def type(self, s, cps=22, jitter=0.45):
        for ch in s:
            self.send(ch)
            time.sleep(max(0.012, random.gauss(1 / cps, jitter / cps)))

    def enter(self, pause=0.25):
        time.sleep(pause)
        self.send('\r')

    def sleep(self, s):
        time.sleep(s)

    def mark(self, name):
        with self.lock:
            self.events.append([round(self.now(), 4), 'm', name])
        print(f'[{self.now():7.2f}] mark {name}', flush=True)

    def wait_for(self, pattern, timeout=120, since=None):
        """Waits until the output (escape codes removed) matches; returns the match. `since` skips earlier output."""
        rx = re.compile(pattern)
        start = len(self.text) if since == 'now' else (since or 0)
        end = time.time() + timeout
        while time.time() < end:
            with self.lock:
                m = rx.search(self.text, start)
            if m:
                return m
            time.sleep(0.05)
        raise TimeoutError(f'waited {timeout}s for {pattern!r}; last output: {self.text[-400:]!r}')

    def cursor(self):
        return len(self.text)

    def close(self, keep=0.5):
        time.sleep(keep)
        self.alive = False
        try:
            os.kill(self.pid, signal.SIGHUP)
        except ProcessLookupError:
            pass
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        head = {'version': 2, 'width': self.cols, 'height': self.rows, 'timestamp': self.start,
                'env': {'TERM': 'xterm-256color', 'SHELL': '/bin/bash'}}
        with open(self.path, 'w') as f:
            f.write(json.dumps(head) + '\n')
            for e in self.events:
                f.write(json.dumps(e) + '\n')
        print('wrote', self.path, f'{self.now():.1f}s', flush=True)
