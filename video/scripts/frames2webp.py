"""Blender's transparent PNG frames → WebP for Remotion (out/blender/frames → out/assets/gpu), about 10× smaller.

    python3 scripts/frames2webp.py
"""
import glob
import os
from multiprocessing import Pool

from PIL import Image

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(ROOT, 'out/assets/gpu')


def convert(path):
    Image.open(path).save(os.path.join(OUT, os.path.basename(path)[:-4] + '.webp'), 'WEBP', quality=92, method=4, alpha_quality=95)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    frames = sorted(glob.glob(os.path.join(ROOT, 'out/blender/frames/f*.png')))
    with Pool() as pool:
        pool.map(convert, frames)
    print(len(frames), 'frames →', OUT)
