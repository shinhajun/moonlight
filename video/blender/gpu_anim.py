"""Cold-open animation of our GPU model (assets/3d/build_gpu.py), rendered with Cycles on a transparent film.

    ~/opt/blender/blender -b --factory-startup --python video/blender/gpu_anim.py -- \
        [--out video/out/blender/frames] [--samples 64] [--res 1920x1080] [--frames 0-575] [--step 1]

One continuous 30 fps shot, timed to the narration (seconds):
  0.0-2.6  close, shallow-focus glide along the top edge; accents power on, fans spin up
  2.4-4.4  pull back to the whole card (the web hero's angle)
  3.4-6.4  layers lift off toward the viewer (fans, shroud, heatsink, backplate) and the card tilts open
  5.6-6.4  three VRAM chips light cool white: memory the owner's apps use; the other nine stay dark
  11.9-13.7 the nine dark chips light gold one by one: Moonlight using the spare memory
  6.4-19.2 slow drift around the open card
Lights, materials and poses come from assets/3d/render_previews.py; offsets are the web hero's, spread wider.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.normpath(os.path.join(HERE, '../../assets/3d'))
sys.path.insert(0, ASSETS)
import build_gpu as B  # noqa: E402
import render_previews as R  # noqa: E402

FPS = 30
DURATION = 19.2
APPS = (0, 1, 2)                       # chips lit by "your apps"
SPARE = tuple(i for i in range(12) if i not in APPS)
WHITE = '#dbe4f5'


def smooth(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def ease(a, b, x):
    """Quintic ease in-out: slower start and landing than smoothstep, for camera moves."""
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * t * (t * (6 * t - 15) + 10)


def lerp(a, b, t):
    return a + (b - a) * t


# Explode windows (s) and offsets (card length / 4.4 units). glTF +Z is Blender -Y.
EXPLODE = {
    'fans': ((3.4, 5.2), 3.0),
    'shroud': ((3.7, 5.5), 2.3),
    'sink': ((4.1, 5.9), 1.35),
    'back': ((4.4, 6.2), -1.0),
}
GROUP = {'fan_0': 'fans', 'fan_1': 'fans', 'fan_2': 'fans', 'fan_frame': 'fans', 'shroud': 'shroud',
         'heatsink_fins': 'sink', 'heatpipes': 'sink', 'backplate': 'back'}

# Shots: (time, camera, look-at, vertical fov, f-stop). Between keys everything eases.
CAM = [
    (0.0, (0.110, -0.205, 0.080), (0.045, 0.0, 0.024), 22.0, 4.5),
    (2.4, (0.055, -0.200, 0.088), (0.000, 0.0, 0.024), 22.0, 4.5),
    (4.4, (0.000, -0.560, 0.035), (0.000, 0.0, 0.012), 30.0, 22.0),
    (6.6, (0.010, -0.630, 0.105), (0.000, 0.0, -0.028), 30.0, 22.0),
    (DURATION, (-0.025, -0.595, 0.095), (-0.004, 0.0, -0.028), 30.0, 22.0),
]


def shot(t):
    for a, b in zip(CAM, CAM[1:]):
        if t <= b[0]:
            k = ease(a[0], b[0], t) if a[0] >= 2.4 else smooth(a[0], b[0], t) * 0.35 + (t - a[0]) / (b[0] - a[0]) * 0.65
            return (Vector(a[1]).lerp(Vector(b[1]), k), Vector(a[2]).lerp(Vector(b[2]), k),
                    lerp(a[3], b[3], k), math.exp(lerp(math.log(a[4]), math.log(b[4]), k)))
    z = CAM[-1]
    return Vector(z[1]), Vector(z[2]), z[3], z[4]


def set_emission(ob, strength, color=None):
    for m in ob.data.materials:
        if 'glow' in m:
            b = m.node_tree.nodes['Principled BSDF']
            b.inputs['Emission Strength'].default_value = strength
            if color:
                b.inputs['Emission Color'].default_value = (*B.srgb(color), 1)


def main(argv):
    args = argv[argv.index('--') + 1:] if '--' in argv else []
    opt = dict(zip(args[::2], args[1::2]))
    out = os.path.abspath(opt.get('--out', os.path.join(HERE, '../out/blender/frames')))
    samples = int(opt.get('--samples', 64))
    w, h = map(int, opt.get('--res', '1920x1080').split('x'))
    last = round(DURATION * FPS) - 1
    f0, f1 = map(int, opt.get('--frames', f'0-{last}').split('-'))
    step = int(opt.get('--step', 1))
    os.makedirs(out, exist_ok=True)

    root, parts = B.build()
    xs = [ob.location.x + v.co.x for ob in parts for v in ob.data.vertices]
    R.CARD_UNIT = unit = (max(xs) - min(xs)) / 4.4
    R.studio('dark', parts)
    bpy.data.objects['backdrop'].hide_render = True
    R.setup_render(samples, w, h, transparent=True)
    sc = bpy.context.scene
    sc.render.use_persistent_data = True
    sc.cycles.seed = 7
    cam = R.camera((0, -0.56, 0.035), (0, 0, 0.012), fov_v=30)
    cam.data.dof.use_dof = True

    obs = {ob.name: ob for ob in parts}
    base = {n: ob.location.copy() for n, ob in obs.items()}
    pcb_y = obs['pcb'].location.y
    for n in obs:
        if n.startswith('accent_'):
            GROUP[n] = 'shroud' if base[n].y < pcb_y else 'back'
    fans = [obs[f'fan_{k}'] for k in range(3)]
    fan_rot = [ob.rotation_euler.copy() for ob in fans]
    for i in APPS:
        set_emission(obs[f'vram_{i}'], 0.0, WHITE)

    for f in range(f0, f1 + 1, step):
        t = f / FPS
        # card pose: the web hero's angle, tilting open as the layers separate, then a slow turn
        k = ease(3.4, 6.6, t)
        R.pose(root, lerp(0.20, 0.42, k), lerp(-0.60, -0.64, k) - 0.10 * smooth(6.6, DURATION, t),
               lift=lerp(0.012, 0.0, k), scale=lerp(1.0, 0.80, k))
        for n, ob in obs.items():
            loc = base[n].copy()
            g = GROUP.get(n)
            if g:
                (a, b), d = EXPLODE[g]
                loc.y -= d * unit * smooth(a, b, t)
            if n == 'io_bracket':
                loc.x -= 0.8 * unit * smooth(4.3, 6.1, t)
            ob.location = loc
        # fans: spin up from rest to a slow, readable speed (negative = the blades' working direction)
        for j, ob in enumerate(fans):
            spin = 2 * math.pi * 0.45 * max(0.0, t - 0.3) * smooth(0.3, 2.2, t + 0.3)
            ob.rotation_euler = (fan_rot[j].x, fan_rot[j].y - spin, fan_rot[j].z)
        # light: accents power on; the apps' chips white; the spare chips gold, one by one
        for n, ob in obs.items():
            if n.startswith('accent_'):
                set_emission(ob, 3.0 * smooth(0.3, 1.6, t))
        for j, i in enumerate(APPS):
            set_emission(obs[f'vram_{i}'], 1.8 * smooth(5.6 + 0.25 * j, 5.95 + 0.25 * j, t))
        for j, i in enumerate(SPARE):
            s = 11.9 + 0.2 * j
            set_emission(obs[f'vram_{i}'], 2.6 * smooth(s, s + 0.35, t))
        loc, at, fov, fstop = shot(t)
        cam.location = loc
        cam.rotation_euler = (at - loc).to_track_quat('-Z', 'Y').to_euler()
        cam.data.angle_y = math.radians(fov)
        cam.data.dof.focus_distance = (at - loc).length
        cam.data.dof.aperture_fstop = fstop
        R.render(os.path.join(out, f'f{f:04d}.png'))
        print(f'frame {f}/{f1}', flush=True)


if __name__ == '__main__':
    main(sys.argv)
