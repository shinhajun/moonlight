"""Studio preview renders of the GPU built by build_gpu.py (Cycles).

    ~/opt/blender/blender -b --factory-startup --python assets/3d/render_previews.py -- \
        [--views hero,front,exploded,closeup] [--themes dark,light] [--samples 128] [--res 1600x1000] [--out DIR]

Camera angle, card rotation, light directions and explode offsets mirror the web hero
(rotation.y -0.60 / rotation.x 0.20; exploded rotation.y -1.0 / rotation.x 0.30), converted
from glTF Y-up (x, y, z) to Blender Z-up (x, -z, y).
"""
import math
import os
import subprocess
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_gpu as B  # noqa: E402

CARD_UNIT = None  # metres per web unit (card X length / 4.4); set after build

THEMES = {
    #        backdrop albedo, world strength, light scale, exposure
    'dark': ('#0a0b0d', 0.010, 1.0, 0.35),
    'light': ('#d9dbe0', 0.30, 0.9, 0.0),
}


def gl(x, y, z):
    """glTF direction -> Blender."""
    return Vector((x, -z, y))


def setup_render(samples, w, h, transparent=False):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'OPTIX'
    prefs.get_devices()
    for d in prefs.devices:
        d.use = d.type == 'OPTIX'
    sc.cycles.device = 'GPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.cycles.denoiser = 'OPTIX'
    sc.cycles.max_bounces = 8
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = w, h, 100
    sc.render.film_transparent = transparent
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'AgX - Medium High Contrast'
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA' if transparent else 'RGB'


def area_light(name, direction, dist, size, color, power, target=(0, 0, 0), only=None):
    ld = bpy.data.lights.new(name, 'AREA')
    ld.shape, ld.size, ld.energy = 'DISK', size, power
    ld.color = B.srgb(color)
    ob = bpy.data.objects.new(name, ld)
    pos = Vector(target) + direction.normalized() * dist
    ob.location = pos
    ob.rotation_euler = (Vector(target) - pos).to_track_quat('-Z', 'Y').to_euler()
    if only is not None:
        ob.light_linking.receiver_collection = only     # Cycles light linking: light the card, not the set
    bpy.context.scene.collection.objects.link(ob)
    return ob


def card_collection(parts):
    coll = bpy.data.collections.new('card_receivers')
    for ob in parts:
        coll.objects.link(ob)
    return coll


def backdrop(color, floor_z):
    """Seamless cyclorama: floor -> curved cove -> wall behind the card."""
    y0, R = 0.55, 0.6
    prof = [(-3.0, floor_z), (y0, floor_z)]
    for k in range(1, 17):
        a = math.pi / 2 * k / 16
        prof.append((y0 + R * math.sin(a), floor_z + R * (1 - math.cos(a))))
    prof.append((y0 + R, 3.0))
    verts, faces = [], []
    for x in (-4.0, 4.0):
        verts += [(x, y, z) for y, z in prof]
    n = len(prof)
    faces = [(i, i + 1, n + i + 1, n + i) for i in range(n - 1)]
    me = bpy.data.meshes.new('backdrop')
    me.from_pydata(verts, [], faces)
    me.shade_smooth()
    m = bpy.data.materials.new('backdrop')
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*B.srgb(color), 1)
    b.inputs['Roughness'].default_value = 0.85
    b.inputs['Specular IOR Level'].default_value = 0.2
    me.materials.append(m)
    ob = bpy.data.objects.new('backdrop', me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def world(strength, color='#9aa3b5'):
    w = bpy.data.worlds.new('studio')
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (*B.srgb(color), 1)
    bg.inputs['Strength'].default_value = strength
    bpy.context.scene.world = w


def studio(theme, parts):
    col, wstr, k, exposure = THEMES[theme]
    world(wstr)
    bpy.context.scene.view_settings.exposure = exposure
    card = card_collection(parts)
    # web hero lights: key, cool rim, gold kick, fill (glTF directions); rim/kick/top only touch the card
    area_light('key', gl(4, 5, 6), 1.4, 0.9, '#fff4e6', 140 * k)
    area_light('rim', gl(4, 2, -5), 1.2, 0.35, '#a9c8ff', 280 * k, only=card)
    area_light('rim_top', gl(0.5, 6, -3), 1.2, 0.5, '#b8d0ff', 160 * k, only=card)
    area_light('kick', gl(-6, 1.5, -2), 1.2, 0.35, '#f2c56b', 45 * k, only=card)
    area_light('fill', gl(-3, -2, 4), 1.4, 1.2, '#dfe3ea', 18 * k)
    # soft top strip for long highlights on the shroud and fins
    area_light('top', Vector((0.2, -0.4, 1.0)), 1.0, 1.4, '#ffffff', 40 * k, only=card)
    # weak light along the view axis so the fin stack reads through the fan openings
    area_light('axis', Vector((0.05, -1.0, 0.15)), 1.0, 0.5, '#ffffff', 10 * k, only=card)
    backdrop(col, -0.17)


def camera(loc, look_at, lens=None, fov_v=None):
    cd = bpy.data.cameras.new('cam')
    cd.sensor_fit = 'VERTICAL'
    if fov_v:
        cd.angle_y = math.radians(fov_v)
    if lens:
        cd.lens = lens
    cd.clip_start = 0.01
    ob = bpy.data.objects.new('cam', cd)
    ob.location = loc
    ob.rotation_euler = (Vector(look_at) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.scene.camera = ob
    return ob


def pose(root, rx, rz, lift=0.0, scale=1.0):
    root.rotation_mode = 'ZXY'
    root.rotation_euler = (rx, 0.0, rz)
    root.location = (0, 0, lift)
    root.scale = (scale,) * 3


def explode(parts):
    u = CARD_UNIT
    offsets = {'fan_0': 2.15, 'fan_1': 2.15, 'fan_2': 2.15, 'fan_frame': 2.15, 'shroud': 1.5,
               'heatsink_fins': 0.78, 'heatpipes': 0.78, 'backplate': -0.75}
    pcb_y = bpy.data.objects['pcb'].location.y
    for ob in parts:
        dz = offsets.get(ob.name)
        if ob.name.startswith('accent_'):
            dz = 1.5 if ob.location.y < pcb_y else -0.75
        if dz is not None:
            ob.location.y -= dz * u          # glTF +Z == Blender -Y
        if ob.name == 'io_bracket':
            ob.location.x -= 0.6 * u


def glow(names, strength):
    for ob in bpy.data.objects:
        if ob.type == 'MESH' and any(ob.name.startswith(n) for n in names):
            for m in ob.data.materials:
                if 'glow' in m:
                    m.node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value = strength


def render(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def to_jpg(png, jpg, quality=90):
    subprocess.run(['python3', '-c', (
        'import sys; from PIL import Image; im = Image.open(sys.argv[1]).convert("RGB"); '
        'im.save(sys.argv[2], quality=int(sys.argv[3]), optimize=True, progressive=True)'),
        png, jpg, str(quality)], check=True)


def to_webp(png, webp, max_bytes):
    """Highest WebP quality (with alpha) that fits under max_bytes."""
    subprocess.run(['python3', '-c', (
        'import io, sys; from PIL import Image; im = Image.open(sys.argv[1]); cap = int(sys.argv[3])\n'
        'for q in range(92, 30, -4):\n'
        '    b = io.BytesIO(); im.save(b, "WEBP", quality=q, method=6, alpha_quality=80)\n'
        '    if b.tell() <= cap: break\n'
        'open(sys.argv[2], "wb").write(b.getvalue()); print("still webp q", q, b.tell(), "bytes")'),
        png, webp, str(max_bytes)], check=True)


def main(argv):
    global CARD_UNIT
    args = argv[argv.index('--') + 1:] if '--' in argv else []
    opt = dict(zip(args[::2], args[1::2]))
    views = opt.get('--views', 'hero,front,exploded,closeup').split(',')
    themes = opt.get('--themes', 'dark,light').split(',')
    samples = int(opt.get('--samples', 128))
    w, h = map(int, opt.get('--res', '1600x1000').split('x'))
    out = os.path.abspath(opt.get('--out', os.path.join(HERE, 'previews')))
    tmp = opt.get('--tmp', '/tmp')
    os.makedirs(out, exist_ok=True)

    for theme in themes:
        for view in views:
            root, parts = B.build()
            xs = [ob.location.x + v.co.x for ob in parts for v in ob.data.vertices]
            CARD_UNIT = (max(xs) - min(xs)) / 4.4
            studio(theme, parts)
            setup_render(samples, w, h)
            if view == 'hero':
                pose(root, 0.20, -0.60, lift=0.012)
                camera((0, -0.56, 0.035), (0, 0, 0.012), fov_v=30)
                glow(['accent_'], 3.0)
            elif view == 'front':
                pose(root, 0.0, 0.0)
                camera((0, -1.35, 0.0), (0, 0, 0.0), lens=135)
            elif view == 'exploded':
                pose(root, 0.38, -0.78, lift=0.0, scale=0.84)
                explode(parts)
                camera((0.0, -0.62, 0.13), (-0.005, 0.0, 0.002), fov_v=30)
                glow(['vram_', 'accent_'], 2.5)
            elif view == 'still':
                # web hero framing (aspect 0.96, fov 30, card lifted 0.42 units), transparent background
                bpy.data.objects['backdrop'].hide_render = True
                setup_render(samples, 1536, 1600, transparent=True)
                pose(root, 0.20, -0.60, lift=0.42 * CARD_UNIT)
                camera((0, -10.69 * CARD_UNIT, 0.25 * CARD_UNIT), (0, 0, 0.25 * CARD_UNIT), fov_v=30)
                glow(['accent_'], 3.0)
            elif view == 'closeup':
                pose(root, 0.20, -0.60, lift=0.0)
                camera((0.055, -0.20, 0.135), (0.012, 0.0, 0.040), lens=60)
                bpy.context.scene.camera.data.dof.use_dof = True
                bpy.context.scene.camera.data.dof.focus_distance = 0.19
                bpy.context.scene.camera.data.dof.aperture_fstop = 5.6
                glow(['accent_'], 3.0)
            png = os.path.join(tmp, f'{view}_{theme}.png')
            render(png)
            if view == 'still':
                to_webp(png, os.path.join(out, 'gpu-still.webp'), 120_000)
            else:
                to_jpg(png, os.path.join(out, f'{view}_{theme}.jpg'))
            print('rendered', view, theme)


if __name__ == '__main__':
    main(sys.argv)
