"""Procedural triple-fan graphics card for the Moonlight landing hero.

    ~/opt/blender/blender -b --factory-startup --python assets/3d/build_gpu.py -- [--glb PATH] [--blend PATH]

Everything (geometry, materials, PCB / brushed-metal textures) is generated here, so the
output is reproducible. Modelled in Blender's Z-up frame: card length along X, height along Z,
fans facing -Y. The glTF exporter converts to Y-up, which gives the web contract:
Y up, fans facing +Z, length along X, origin at the card's bounding-box centre, metres.
"""
import math
import os
import sys
import tempfile

import bpy
import bmesh
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
DEFAULT_GLB = os.path.join(REPO, 'web', 'public', 'models', 'gpu.glb')

# ---------------------------------------------------------------- layout (Blender frame, metres)
SX0, SX1, SZ0, SZ1 = -0.146, 0.150, -0.050, 0.060      # shroud / backplate outline
CORNER = 0.010
FRONT_Y = -0.035                                       # shroud front face
SKIRT_Y1 = -0.013                                      # back edge of the shroud skirt / fan frame
FAN_X = (-0.094, 0.002, 0.098)
FAN_Z, FAN_Y = 0.005, -0.0262                          # hub centre (Y = blade mid-plane)
FAN_R, HOLE_R = 0.0405, 0.0435
FIN_X0, FIN_X1, FIN_Z0, FIN_Z1 = -0.140, 0.146, -0.047, 0.057
FIN_Y0, FIN_Y1, FIN_Y1_FLOW = -0.0125, 0.0100, 0.0170
FLOW_X = 0.080                                         # past the PCB the fins run to the backplate
COLD_Y0, COLD_Y1 = 0.0100, 0.0130
PCB_Y0, PCB_Y1 = 0.0150, 0.0166
PCB_X0, PCB_X1, PCB_Z0, PCB_Z1 = -0.1475, 0.074, -0.0505, 0.0555
FINGER_X0, FINGER_X1, FINGER_Z0 = -0.1245, -0.0355, -0.0585
BP_Y0, BP_Y1 = 0.0175, 0.0200
DIE_X, DIE_Z = -0.040, 0.004
BRACKET_X = -0.1504
PIPE_R = 0.0028

# columns of components on the PCB front (component side faces -Y)
VRM_R_CHOKE_X, VRM_R_STAGE_X = (0.0125, 0.0215), 0.0295
VRM_L_CHOKE_X, VRM_L_STAGE_X = -0.0955, -0.1045
CAP_R_X, CAP_L_X = (0.052, 0.059), (-0.115, -0.122)


def vram_layout():
    """12 chips clockwise from top-left: top row, right column, bottom row, left column."""
    out = []
    top, bot, left, right = DIE_Z + 0.033, DIE_Z - 0.033, DIE_X - 0.033, DIE_X + 0.033
    for d in (-0.0165, 0.0, 0.0165):
        out.append((DIE_X + d, top, 0.014, 0.012))
    for d in (0.0165, 0.0, -0.0165):
        out.append((right, DIE_Z + d, 0.012, 0.014))
    for d in (0.0165, 0.0, -0.0165):
        out.append((DIE_X + d, bot, 0.014, 0.012))
    for d in (-0.0165, 0.0, 0.0165):
        out.append((left, DIE_Z + d, 0.012, 0.014))
    return out


def mount_holes():
    return [(DIE_X + sx * 0.031, DIE_Z + sz * 0.031) for sx in (-1, 1) for sz in (-1, 1)]


def choke_rows(left):
    if left:
        return [-0.030 + k * 0.0093 for k in range(8)]
    return [-0.040 + k * 0.0093 for k in range(10)]


def cap_rows(left):
    return [-0.028 + k * 0.0082 for k in range(8)] if left else [-0.038 + k * 0.0082 for k in range(10)]


# plane mappings: world = M @ (u, v, w) + t ; local +w is the plate's front normal
M_XZ_FRONT = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], float)   # u->X, v->Z, w->-Y
M_YZ = np.array([[0, 0, 1], [1, 0, 0], [0, 1, 0]], float)          # u->Y, v->Z, w->X
M_XY = np.eye(3)                                                   # u->X, v->Y, w->Z


# ---------------------------------------------------------------- small geometry helpers
def srgb(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def rrect(cx, cy, w, h, r, inset=0.0, seg=10):
    w, h, r = w - 2 * inset, h - 2 * inset, max(r - inset, 1e-5)
    pts = []
    for qx, qy, a0 in ((1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)):
        ccx, ccy = cx + qx * (w / 2 - r), cy + qy * (h / 2 - r)
        for k in range(seg + 1):
            a = math.radians(a0 + 90 * k / seg)
            pts.append((ccx + r * math.cos(a), ccy + r * math.sin(a)))
    return pts


def circle(cx, cy, r, n=64, phase=0.0):
    return [(cx + r * math.cos(phase + 2 * math.pi * k / n), cy + r * math.sin(phase + 2 * math.pi * k / n))
            for k in range(n)]


def chamfer_poly(pts, c):
    """Cut every corner of a closed polygon by c (keeps silhouettes crisp but not razor sharp)."""
    out = []
    n = len(pts)
    for i in range(n):
        p, a, b = np.array(pts[i]), np.array(pts[i - 1]), np.array(pts[(i + 1) % n])
        da, db = a - p, b - p
        ca, cb = min(c, 0.45 * np.linalg.norm(da)), min(c, 0.45 * np.linalg.norm(db))
        out.append(tuple(p + da / np.linalg.norm(da) * ca))
        out.append(tuple(p + db / np.linalg.norm(db) * cb))
    return out


def plate(loops, thick, bevel, res=3):
    """Filled 2D curve (outer loop + holes) extruded to `thick` with round edges, in local XY.

    Blender grows outer loops / shrinks holes by `bevel`; callers pass loops already inset.
    """
    cu = bpy.data.curves.new('tmp', 'CURVE')
    cu.dimensions, cu.fill_mode = '2D', 'BOTH'
    cu.bevel_mode, cu.bevel_depth, cu.bevel_resolution = 'ROUND', bevel, res
    cu.extrude, cu.resolution_u = max(thick / 2 - bevel, 0.0), 1
    for lp in loops:
        sp = cu.splines.new('POLY')
        sp.points.add(len(lp) - 1)
        sp.points.foreach_set('co', [c for x, y in lp for c in (x, y, 0.0, 1.0)])
        sp.use_cyclic_u = True
    return _curve_to_mesh(cu)


def tube(points, radius, res=3):
    cu = bpy.data.curves.new('tmp', 'CURVE')
    cu.dimensions, cu.twist_mode = '3D', 'MINIMUM'
    cu.bevel_mode, cu.bevel_depth, cu.bevel_resolution = 'ROUND', radius, res
    cu.use_fill_caps = True
    sp = cu.splines.new('POLY')
    sp.points.add(len(points) - 1)
    sp.points.foreach_set('co', [c for p in points for c in (*p, 1.0)])
    return _curve_to_mesh(cu)


def _curve_to_mesh(cu):
    ob = bpy.data.objects.new('tmp', cu)
    bpy.context.scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    return me


def fillet_path(pts, rad, seg=10):
    P = [np.array(p, float) for p in pts]
    out = [P[0]]
    for i in range(1, len(P) - 1):
        a, b, c = P[i - 1], P[i], P[i + 1]
        d1, d2 = (a - b) / np.linalg.norm(a - b), (c - b) / np.linalg.norm(c - b)
        ang = math.acos(float(np.clip(d1 @ d2, -1, 1)))
        t = min(rad / math.tan(ang / 2), 0.49 * np.linalg.norm(a - b), 0.49 * np.linalg.norm(c - b))
        r = t * math.tan(ang / 2)
        bis = (d1 + d2) / np.linalg.norm(d1 + d2)
        cen = b + bis * (r / math.sin(ang / 2))
        v1, v2 = b + d1 * t - cen, b + d2 * t - cen
        om = math.pi - ang
        for k in range(seg + 1):
            s = k / seg
            out.append(cen + (math.sin((1 - s) * om) * v1 + math.sin(s * om) * v2) / math.sin(om))
    out.append(P[-1])
    return [tuple(p) for p in out]


class MB:
    """Accumulates verts/faces/material indices from many pieces, then makes one mesh."""

    def __init__(self):
        self.v, self.f, self.m = [], [], []

    def add(self, verts, faces, mat=0):
        o = len(self.v)
        self.v.extend(map(tuple, verts))
        self.f.extend(tuple(i + o for i in f) for f in faces)
        self.m.extend([mat] * len(faces))

    def add_mesh(self, me, mat=0, M=None, t=(0, 0, 0)):
        co = np.empty(len(me.vertices) * 3)
        me.vertices.foreach_get('co', co)
        co = co.reshape(-1, 3)
        if M is not None:
            co = co @ np.asarray(M).T
        self.add(co + np.asarray(t), [tuple(p.vertices) for p in me.polygons], mat)
        bpy.data.meshes.remove(me)

    def box(self, c, s, mat=0, R=None):
        hx, hy, hz = s[0] / 2, s[1] / 2, s[2] / 2
        v = np.array([(x, y, z) for x in (-hx, hx) for y in (-hy, hy) for z in (-hz, hz)])
        if R is not None:
            v = v @ np.asarray(R).T
        self.add(v + np.asarray(c), [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)], mat)

    def lathe(self, profile, center, n=48, mat=0, axis='Y', phase=0.0):
        """Revolve (r, a) profile; `a` is measured toward the viewer (-Y) for axis 'Y'."""
        c = np.asarray(center, float)
        if axis == 'Y':
            ex, ey, ez = np.array([1, 0, 0.]), np.array([0, 0, 1.]), np.array([0, -1, 0.])
        else:  # 'Z'
            ex, ey, ez = np.array([1, 0, 0.]), np.array([0, 1, 0.]), np.array([0, 0, 1.])
        verts, rings = [], []
        for r, a in profile:
            if r < 1e-9:
                rings.append([len(verts)])
                verts.append(c + ez * a)
            else:
                ring = []
                for k in range(n):
                    phi = phase + 2 * math.pi * k / n
                    ring.append(len(verts))
                    verts.append(c + ex * r * math.cos(phi) + ey * r * math.sin(phi) + ez * a)
                rings.append(ring)
        faces = []
        for A, B in zip(rings[:-1], rings[1:]):
            if len(A) == 1 and len(B) == 1:
                continue
            if len(A) == 1:
                faces += [(A[0], B[(k + 1) % n], B[k]) for k in range(n)]
            elif len(B) == 1:
                faces += [(A[k], A[(k + 1) % n], B[0]) for k in range(n)]
            else:
                faces += [(A[k], A[(k + 1) % n], B[(k + 1) % n], B[k]) for k in range(n)]
        self.add(verts, faces, mat)

    def prism(self, poly, x0, x1, mat=0):
        """Polygon in (y, z) extruded along X."""
        n = len(poly)
        verts = [(x0, y, z) for y, z in poly] + [(x1, y, z) for y, z in poly]
        faces = [tuple(range(n))[::-1], tuple(range(n, 2 * n))]
        faces += [(k, (k + 1) % n, n + (k + 1) % n, n + k) for k in range(n)]
        self.add(verts, faces, mat)

    def grid_solid(self, P, N, h, mat=0):
        """Thicken an (ni, nj) point grid along its normals by +-h into a closed solid."""
        ni, nj = P.shape[:2]
        top, bot = (P + N * h).reshape(-1, 3), (P - N * h).reshape(-1, 3)
        idx = lambda i, j: i * nj + j
        off = ni * nj
        faces = []
        for i in range(ni - 1):
            for j in range(nj - 1):
                q = (idx(i, j), idx(i + 1, j), idx(i + 1, j + 1), idx(i, j + 1))
                faces.append(q)
                faces.append(tuple(off + k for k in q[::-1]))
        ring = [idx(i, 0) for i in range(ni)] + [idx(ni - 1, j) for j in range(1, nj)] + \
               [idx(i, nj - 1) for i in range(ni - 2, -1, -1)] + [idx(0, j) for j in range(nj - 2, 0, -1)]
        for a, b in zip(ring, ring[1:] + ring[:1]):
            faces.append((b, a, off + a, off + b))
        self.add(np.vstack([top, bot]), faces, mat)

    def build(self, name, mats, pivot=None, smooth=35, uv=None):
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.v, [], self.f)
        me.polygons.foreach_set('material_index', self.m)
        for mt in mats:
            me.materials.append(mt)
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
        co = np.empty(len(me.vertices) * 3)
        me.vertices.foreach_get('co', co)
        co = co.reshape(-1, 3)
        if uv is not None:
            for l in list(me.uv_layers):
                me.uv_layers.remove(l)
            lay = me.uv_layers.new(name='UVMap')
            vi = np.empty(len(me.loops), int)
            me.loops.foreach_get('vertex_index', vi)
            lay.data.foreach_set('uv', uv(co[vi]).ravel())
        c = np.asarray(pivot) if pivot is not None else (co.min(0) + co.max(0)) / 2
        me.vertices.foreach_set('co', (co - c).ravel())
        if smooth:
            me.shade_smooth()
            me.set_sharp_from_angle(angle=math.radians(smooth))
        else:
            me.shade_flat()
        ob = bpy.data.objects.new(name, me)
        ob.location = c
        bpy.context.scene.collection.objects.link(ob)
        return ob


def finish(ob, bevel=None, segs=2, wn=True):
    if bevel:
        b = ob.modifiers.new('bevel', 'BEVEL')
        b.width, b.segments, b.limit_method = bevel, segs, 'ANGLE'
        b.angle_limit = math.radians(40)
    if wn:
        w = ob.modifiers.new('wn', 'WEIGHTED_NORMAL')
        w.keep_sharp, w.weight = True, 50
    return ob


# ---------------------------------------------------------------- textures (baked to images)
def save_image(name, rgb, colorspace, tmp):
    h, w = rgb.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=False)
    rgba = np.concatenate([rgb, np.ones((h, w, 1), np.float32)], axis=2)
    img.pixels.foreach_set(rgba.astype(np.float32).ravel())
    img.filepath_raw = os.path.join(tmp, name + '.png')
    img.file_format = 'PNG'
    img.save()
    img.colorspace_settings.name = colorspace
    return img


def pcb_textures(tmp, W=2048, H=1024):
    """Matte black solder mask with faint traces, vias and silkscreen outlines (no text)."""
    rng = np.random.default_rng(11)
    ux0, ux1, uz0, uz1 = PCB_X0, PCB_X1, FINGER_Z0, PCB_Z1
    sx, sz = W / (ux1 - ux0), H / (uz1 - uz0)
    P = lambda x, z: ((x - ux0) * sx, (z - uz0) * sz)
    trace = np.zeros((H, W), np.float32)
    pour = np.zeros((H, W), np.float32)
    silk = np.zeros((H, W), np.float32)
    via = np.zeros((H, W), np.float32)
    gold = np.zeros((H, W), np.float32)

    def line(mask, pts, hw=1):
        for (x0, y0), (x1, y1) in zip(pts[:-1], pts[1:]):
            n = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
            xs = np.round(np.linspace(x0, x1, n)).astype(int)
            ys = np.round(np.linspace(y0, y1, n)).astype(int)
            for ox in range(-hw, hw + 1):
                for oy in range(-hw, hw + 1):
                    mask[np.clip(ys + oy, 0, H - 1), np.clip(xs + ox, 0, W - 1)] = 1

    yy, xx = np.mgrid[-6:7, -6:7]

    def dot(mask, x, y, r, val=1.0):
        x, y = int(round(x)), int(round(y))
        if 6 <= x < W - 6 and 6 <= y < H - 6:
            m = (xx ** 2 + yy ** 2) <= r * r
            sub = mask[y - 6:y + 7, x - 6:x + 7]
            sub[m] = np.maximum(sub[m], val)

    def rect_outline(x, z, w, h, pad=0.0008):
        a, b = P(x - w / 2 - pad, z - h / 2 - pad), P(x + w / 2 + pad, z + h / 2 + pad)
        line(silk, [a, (b[0], a[1]), b, (a[0], b[1]), a], hw=0)

    def offset_poly(pts, d):
        p = np.asarray(pts, float)
        segs = p[1:] - p[:-1]
        nrm = np.stack([-segs[:, 1], segs[:, 0]], 1) / np.linalg.norm(segs, axis=1, keepdims=True)
        out = [p[0] + nrm[0] * d]
        for k in range(1, len(p) - 1):
            n1, n2 = nrm[k - 1], nrm[k]
            out.append(p[k] + (n1 + n2) * d / (1 + n1 @ n2))
        out.append(p[-1] + nrm[-1] * d)
        return out

    # ground pours (slightly different sheen)
    for _ in range(14):
        x, y = rng.uniform(0, W), rng.uniform(0, H)
        pour[int(max(0, y - rng.uniform(30, 120))):int(y + rng.uniform(30, 120)),
             int(max(0, x - rng.uniform(40, 200))):int(x + rng.uniform(40, 200))] = 1

    # bundles of 45/90-degree traces
    dirs = [np.array((math.cos(a), math.sin(a))) for a in np.arange(8) * math.pi / 4]
    for _ in range(170):
        d = int(rng.choice([0, 2, 4, 6, 0, 2, 4, 6, 1, 3, 5, 7]))
        p = np.array((rng.uniform(0, W), rng.uniform(0, H)))
        pts = [p.copy()]
        for _s in range(int(rng.integers(2, 5))):
            p = p + dirs[d] * rng.uniform(40, 260)
            pts.append(p.copy())
            d = (d + int(rng.choice([-1, 1]))) % 8
        for k in range(int(rng.integers(1, 7))):
            q = offset_poly(pts, k * 6.0)
            line(trace, q, hw=1)
            dot(via, *q[-1], 3)

    # die -> chip fanout
    for cx, cz, w, h in vram_layout():
        vx, vz = cx - DIE_X, cz - DIE_Z
        horiz = abs(vx) > abs(vz)
        for k in range(-4, 5):
            if horiz:
                s = P(DIE_X + math.copysign(0.022, vx), DIE_Z + vz * 0.5 + k * 0.0011)
                e = P(cx - math.copysign(w / 2, vx), cz + k * 0.0011)
                m = (s[0] + (e[0] - s[0]) * 0.35, s[1])
                line(trace, [s, m, (m[0] + abs(e[1] - s[1]) * np.sign(e[0] - s[0]), e[1]), e], hw=0)
            else:
                s = P(DIE_X + vx * 0.5 + k * 0.0011, DIE_Z + math.copysign(0.022, vz))
                e = P(cx + k * 0.0011, cz - math.copysign(h / 2, vz))
                m = (s[0], s[1] + (e[1] - s[1]) * 0.35)
                line(trace, [s, m, (e[0], m[1] + abs(e[0] - s[0]) * np.sign(e[1] - s[1])), e], hw=0)

    # via fields
    for _ in range(900):
        dot(via, rng.uniform(0, W), rng.uniform(0, H), 2)

    # silkscreen footprints and mounting-hole copper rings
    for cx, cz, w, h in vram_layout():
        rect_outline(cx, cz, w, h)
    rect_outline(DIE_X, DIE_Z, 0.052, 0.052, 0.001)
    for left, xs in ((False, VRM_R_CHOKE_X), (True, (VRM_L_CHOKE_X,))):
        for x in xs:
            for z in choke_rows(left):
                rect_outline(x, z, 0.0075, 0.0075)
    for x, z in mount_holes() + [(PCB_X1 - 0.006, PCB_Z1 - 0.006), (PCB_X1 - 0.006, PCB_Z0 + 0.006), (-0.140, 0.049)]:
        dot(gold, *P(x, z), 6)
    line(silk, [P(PCB_X0 + 0.002, PCB_Z0 + 0.002), P(PCB_X1 - 0.002, PCB_Z0 + 0.002),
                P(PCB_X1 - 0.002, PCB_Z1 - 0.002), P(PCB_X0 + 0.002, PCB_Z1 - 0.002),
                P(PCB_X0 + 0.002, PCB_Z0 + 0.002)], hw=0)

    to_lin = lambda c: np.array(c, np.float32) / 255
    col = np.empty((H, W, 3), np.float32)
    col[:] = to_lin((13, 14, 16))
    col[pour > 0] = to_lin((17, 18, 21))
    col[trace > 0] = to_lin((27, 29, 33))
    col[silk > 0] = to_lin((58, 60, 64))
    col[via > 0] = to_lin((34, 35, 37))
    col[gold > 0] = to_lin((190, 150, 80))
    orm = np.ones((H, W, 3), np.float32)
    orm[..., 1] = 0.66
    orm[..., 1][pour > 0] = 0.55
    orm[..., 1][trace > 0] = 0.36
    orm[..., 1][silk > 0] = 0.75
    orm[..., 1][via > 0] = 0.32
    orm[..., 1][gold > 0] = 0.25
    orm[..., 2] = np.where(gold > 0, 1.0, 0.0)
    return save_image('pcb_basecolor', col, 'sRGB', tmp), save_image('pcb_orm', orm, 'Non-Color', tmp)


def brushed_texture(tmp, S=512):
    """Tileable roughness streaks along U (G = roughness, B = metallic)."""
    rng = np.random.default_rng(5)
    rows = rng.normal(size=S)
    k = np.array([1, 2, 3, 2, 1], float)
    rows = np.convolve(np.concatenate([rows[-2:], rows, rows[:2]]), k / k.sum(), 'valid')
    rows = (rows - rows.mean()) / rows.std()
    u, v = np.meshgrid(np.arange(S) / S, np.arange(S) / S)
    low = sum(rng.uniform(0.3, 1) * np.sin(2 * np.pi * (fx * u + fy * v) + rng.uniform(0, 6.3))
              for fx, fy in ((1, 2), (2, 1), (3, 5), (1, 7)))
    g = 0.32 + 0.030 * rows[:, None] + 0.006 * low + 0.010 * rng.normal(size=(S, S))
    orm = np.ones((S, S, 3), np.float32)
    orm[..., 1] = np.clip(g, 0.22, 0.5)
    return save_image('brushed_orm', orm, 'Non-Color', tmp)


# ---------------------------------------------------------------- materials
def material(name, base, metal=0.0, rough=0.5, glow=None, color_tex=None, orm_tex=None, cull=True):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.use_backface_culling = cull
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*srgb(base), 1)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    if glow:
        # emission is wired but off; the web drives material.emissive / emissiveIntensity
        b.inputs['Emission Color'].default_value = (*srgb(glow), 1)
        b.inputs['Emission Strength'].default_value = 0.0
        m['glow'] = glow
    if color_tex:
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = color_tex
        nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
    if orm_tex:
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = orm_tex
        sep = nt.nodes.new('ShaderNodeSeparateColor')
        nt.links.new(t.outputs['Color'], sep.inputs['Color'])
        nt.links.new(sep.outputs['Green'], b.inputs['Roughness'])
        nt.links.new(sep.outputs['Blue'], b.inputs['Metallic'])
    return m


def make_materials(tmp):
    pcb_col, pcb_orm = pcb_textures(tmp)
    brushed = brushed_texture(tmp)
    M = {
        'shroud': material('shroud_anodized', '#3b3f47', 1.0, 0.32, orm_tex=brushed),
        'trim': material('shroud_polymer', '#141518', 0.0, 0.48),
        'blade': material('fan_blade', '#0e0f11', 0.0, 0.38),
        'hub': material('fan_hub_cap', '#4a4d55', 1.0, 0.42),
        'gold': material('gold_contact', '#ffc56e', 1.0, 0.22),
        'alu': material('aluminium_fin', '#dcdee2', 1.0, 0.20),
        'copper': material('copper', '#e9a17e', 1.0, 0.26),
        'pcb': material('pcb', '#0d0e10', 0.0, 0.6, color_tex=pcb_col, orm_tex=pcb_orm),
        'substrate': material('gpu_substrate', '#2c2a20', 0.0, 0.5),
        'silicon': material('gpu_silicon', '#141a26', 0.6, 0.08),
        'steel': material('steel', '#9a9ca2', 1.0, 0.32),
        'smd': material('smd_ceramic', '#6e604b', 0.0, 0.45),
        'choke': material('vrm_choke', '#3d3f44', 0.8, 0.42),
        'black': material('black_plastic', '#0b0b0c', 0.0, 0.55),
        'cap': material('capacitor_can', '#b9bcc2', 1.0, 0.30),
        'backplate': material('backplate_anodized', '#24262b', 1.0, 0.40, orm_tex=brushed),
        'bracket': material('bracket_metal', '#3a3c41', 1.0, 0.34),
    }
    M['vram'] = [material(f'vram_{i}', '#121214', 0.0, 0.42, glow='#f2c56b') for i in range(12)]
    return M


def accent_material(name):
    return material(name, '#e8b45a', 1.0, 0.24, glow='#f2c56b')


# ---------------------------------------------------------------- parts
def planar_xz(scale_u, scale_v, x0=0.0, z0=0.0):
    return lambda co: np.stack([(co[:, 0] - x0) / scale_u, (co[:, 2] - z0) / scale_v], 1)


def build_shroud(M):
    mb = MB()
    w, h, cx, cz = SX1 - SX0, SZ1 - SZ0, (SX0 + SX1) / 2, (SZ0 + SZ1) / 2
    # front plate: 3 mm brushed panel with rounded fan openings
    bev = 0.0012
    loops = [rrect(cx, cz, w, h, CORNER, inset=bev)] + [circle(x, FAN_Z, HOLE_R + bev, 128) for x in FAN_X]
    mb.add_mesh(plate(loops, 0.0030, bev, 4), 0, M_XZ_FRONT, (0, FRONT_Y + 0.0015, 0))
    # perimeter skirt that wraps the fan cavity
    bev = 0.0008
    loops = [rrect(cx, cz, w, h, CORNER, inset=bev), rrect(cx, cz, w - 0.0044, h - 0.0044, CORNER - 0.0022, inset=-bev)]
    y0 = FRONT_Y + 0.001
    mb.add_mesh(plate(loops, SKIRT_Y1 - y0, bev, 2), 1, M_XZ_FRONT, (0, (y0 + SKIRT_Y1) / 2, 0))
    ob = mb.build('shroud', [M['shroud'], M['trim']], uv=planar_xz(0.15, 0.03))
    return finish(ob)


def build_accents():
    out = []
    specs = [  # name, centre x, centre z, length, axis
        ('accent_top', 0.050, SZ1 - 0.0055, 0.176, 'x'),
        ('accent_bottom', -0.046, SZ0 + 0.0058, 0.176, 'x'),
    ]
    for name, x, z, length, _ in specs:
        mb = MB()
        bev = 0.0003
        mb.add_mesh(plate([rrect(x, z, length, 0.0013, 0.00064, inset=bev)], 0.0009, bev, 2), 0,
                    M_XZ_FRONT, (0, FRONT_Y - 0.00015, 0))
        out.append(finish(mb.build(name, [accent_material(name)])))
    # vertical strip on the +X end of the shroud skirt
    mb = MB()
    bev = 0.0003
    mb.add_mesh(plate([rrect((FRONT_Y + SKIRT_Y1) / 2, 0.005, 0.0013, 0.080, 0.00064, inset=bev)], 0.0009, bev, 2), 0,
                M_YZ, (SX1 + 0.00015, 0, 0))
    out.append(finish(mb.build('accent_end', [accent_material('accent_end')])))
    # line on the backplate (travels with the backplate when exploded)
    mb = MB()
    mb.add_mesh(plate([rrect(-0.035, SZ1 - 0.0055, 0.190, 0.0013, 0.00064, inset=bev)], 0.0009, bev, 2), 0,
                M_XZ_FRONT, (0, BP_Y1 + 0.00015, 0))
    out.append(finish(mb.build('accent_back', [accent_material('accent_back')])))
    return out


def fan_blade_grid(phi0, ni=17, nj=9):
    r0, r1 = 0.0112, FAN_R
    P = np.zeros((ni, nj, 3))
    for i in range(ni):
        t = math.sin(i / (ni - 1) * math.pi / 2)
        r = r0 + (r1 - r0) * t
        w = (0.0105 + 0.0105 * t) / r
        d = 0.0095 - 0.0033 * t
        phic = phi0 + 0.40 * t ** 1.5
        lo = hi = 0.0
        RT = 0.22
        if t > 1 - RT:
            u = (t - (1 - RT)) / RT
            lo, hi = 0.30 * (1 - math.sqrt(max(0.0, 1 - u * u))), 0.42 * (1 - math.sqrt(max(0.0, 1 - u * u)))
        for j in range(nj):
            v = lo + (1 - lo - hi) * j / (nj - 1)
            phi = phic + (v - 0.5) * w
            a = d * (v - 0.5) + 0.14 * d * math.sin(math.pi * v)
            P[i, j] = (r * math.cos(phi), -a, r * math.sin(phi))
    di = np.gradient(P, axis=0)
    dj = np.gradient(P, axis=1)
    N = np.cross(di, dj)
    N /= np.linalg.norm(N, axis=2, keepdims=True)
    return P, N


def build_fan(k, M, phase):
    c = np.array((FAN_X[k], FAN_Y, FAN_Z))
    mb = MB()
    nb = 11
    for b in range(nb):
        P, N = fan_blade_grid(phase + 2 * math.pi * b / nb)
        mb.grid_solid(P + c, N, 0.00045, 0)
    af, ab = 0.0060, -0.0090
    mb.lathe([(0, af - 0.0003), (0.0098, af - 0.0003), (0.0114, af - 0.0007), (0.0122, af - 0.0015),
              (0.0125, af - 0.0026), (0.0125, ab), (0, ab)], c, 64, 0)
    mb.lathe([(0, af), (0.0080, af), (0.0086, af - 0.0002), (0.0087, af - 0.0006), (0, af - 0.0006)], c, 64, 1)
    mb.lathe([(0.0088, af - 0.0006), (0.0088, af), (0.0089, af + 0.0001), (0.0096, af + 0.0001),
              (0.0097, af), (0.0097, af - 0.0006)], c, 64, 2)
    ob = mb.build(f'fan_{k}', [M['blade'], M['hub'], M['gold']], pivot=c, smooth=50)
    return finish(ob)


def build_fan_frame(M):
    mb = MB()
    for x in FAN_X:
        c = (x, FAN_Y, FAN_Z)
        # shroud ring around the rotor, from just behind the front plate to the skirt's back edge
        a0, a1 = FAN_Y - (FRONT_Y + 0.0025), FAN_Y - SKIRT_Y1
        mb.lathe([(0.0425, a1), (0.0425, a0 - 0.0006), (0.0431, a0), (0.0452, a0), (0.0452, a1)], c, 96, 0)
        # motor housing behind the hub
        h0 = FAN_Y - (SKIRT_Y1 - 0.0034)
        mb.lathe([(0, h0), (0.0128, h0), (0.0135, h0 - 0.0006), (0.0135, a1 - 0.0004), (0, a1 - 0.0004)], c, 48, 0)
        # three swept struts
        for s in range(3):
            pts = []
            for q in range(9):
                t = q / 8
                r = 0.0128 + (0.0432 - 0.0128) * t
                phi = math.radians(90 + 120 * s) - 0.55 * t
                pts.append((r * math.cos(phi), r * math.sin(phi)))
            pts = np.array(pts)
            seg = np.gradient(pts, axis=0)
            nrm = np.stack([-seg[:, 1], seg[:, 0]], 1)
            nrm /= np.linalg.norm(nrm, axis=1, keepdims=True)
            hw = 0.0014
            outline = [tuple(p + n * hw) for p, n in zip(pts, nrm)] + [tuple(p - n * hw) for p, n in zip(pts[::-1], nrm[::-1])]
            n = len(outline)
            y0, y1 = SKIRT_Y1 - 0.0016, SKIRT_Y1
            verts = [(x + u, y0, FAN_Z + v) for u, v in outline] + [(x + u, y1, FAN_Z + v) for u, v in outline]
            faces = [tuple(range(n)), tuple(range(2 * n - 1, n - 1, -1))] + \
                    [(i, n + i, n + (i + 1) % n, (i + 1) % n) for i in range(n)]
            mb.add(verts, faces, 0)
    return finish(mb.build('fan_frame', [M['trim']], smooth=40))


def build_fins(M):
    mb = MB()
    pitch, t = 0.0021, 0.00035
    n = int((FIN_X1 - FIN_X0) / pitch) + 1
    for i in range(n):
        x = FIN_X0 + i * pitch
        y1 = FIN_Y1_FLOW if x > FLOW_X else FIN_Y1
        y0 = FIN_Y0
        c = 0.0025
        # small alternating notch on the top edge gives the stack a machined rhythm
        zt = FIN_Z1 - (0.0008 if i % 2 else 0.0)
        poly = [(y0, FIN_Z0 + c), (y0 + c, FIN_Z0), (y1 - c, FIN_Z0), (y1, FIN_Z0 + c),
                (y1, zt - c), (y1 - c, zt), (y0 + c, zt), (y0, zt - c)]
        mb.prism(poly, x - t / 2, x + t / 2, 0)
    # end plates that close the stack
    for x in (FIN_X0 - 0.0006, FIN_X1 + 0.0006):
        y1 = FIN_Y1_FLOW if x > FLOW_X else FIN_Y1
        mb.prism(chamfer_poly([(FIN_Y0, FIN_Z0), (y1, FIN_Z0), (y1, FIN_Z1), (FIN_Y0, FIN_Z1)], 0.0025),
                 x - 0.0006, x + 0.0006, 0)
    return mb.build('heatsink_fins', [M['alu']], smooth=None)


def build_heatpipes(M):
    mb = MB()
    # vapour-chamber cold plate over die + memory
    mb.box(((-0.082 + 0.002) / 2, (COLD_Y0 + COLD_Y1) / 2, (-0.038 + 0.046) / 2), (0.084, COLD_Y1 - COLD_Y0, 0.084), 0)
    yb, yf, ztop = COLD_Y0 - PIPE_R + 0.0006, -0.0055, 0.0595
    pipes = [  # base z, direction, bend x, return z
        (-0.020, +1, 0.040, 0.012),
        (-0.008, -1, -0.104, 0.000),
        (0.004, +1, 0.030, -0.010),
        (0.016, -1, -0.094, -0.025),
        (0.028, +1, 0.020, -0.030),
    ]
    for z, d, xb, zr in pipes:
        xs = -0.074 if d > 0 else -0.006
        xe = 0.140 if d > 0 else -0.136
        pts = fillet_path([(xs, yb, z), (xb, yb, z), (xb, yb, ztop), (xb, yf, ztop), (xb, yf, zr), (xe, yf, zr)],
                          0.0058, 10)
        mb.add_mesh(tube(pts, PIPE_R, 3), 0)
    return finish(mb.build('heatpipes', [M['copper']], smooth=40), bevel=0.0006, segs=2)


def pcb_outline():
    nx0, nx1 = FINGER_X0 + 0.0115, FINGER_X0 + 0.0135
    pts = [(PCB_X0, PCB_Z1), (PCB_X1, PCB_Z1), (PCB_X1, PCB_Z0),
           (FINGER_X1 + 0.002, PCB_Z0), (FINGER_X1, PCB_Z0 - 0.002), (FINGER_X1, FINGER_Z0 + 0.0008),
           (FINGER_X1 - 0.0008, FINGER_Z0), (nx1, FINGER_Z0), (nx1, PCB_Z0 - 0.0008), (nx0, PCB_Z0 - 0.0008),
           (nx0, FINGER_Z0), (FINGER_X0 + 0.0008, FINGER_Z0), (FINGER_X0, FINGER_Z0 + 0.0008),
           (FINGER_X0, PCB_Z0), (PCB_X0, PCB_Z0)]
    return pts[::-1]


def build_pcb(M):
    mb = MB()
    holes = [circle(x, z, 0.0017, 24) for x, z in mount_holes()]
    holes += [circle(x, z, 0.0017, 24) for x, z in
              [(PCB_X1 - 0.006, PCB_Z1 - 0.006), (PCB_X1 - 0.006, PCB_Z0 + 0.006), (-0.140, 0.049)]]
    mb.add_mesh(plate([pcb_outline()] + holes, PCB_Y1 - PCB_Y0, 0.0002, 1), 0, M_XZ_FRONT,
                (0, (PCB_Y0 + PCB_Y1) / 2, 0))
    uv = planar_xz(PCB_X1 - PCB_X0, PCB_Z1 - FINGER_Z0, PCB_X0, FINGER_Z0)
    return finish(mb.build('pcb', [M['pcb']], smooth=40, uv=uv))


def build_fingers(M):
    mb = MB()
    nx0, nx1 = FINGER_X0 + 0.0115, FINGER_X0 + 0.0135
    x = FINGER_X0 + 0.0009
    while x < FINGER_X1 - 0.0006:
        if not (nx0 - 0.0006 < x < nx1 + 0.0006):
            for y in (PCB_Y0 - 0.00003, PCB_Y1 + 0.00003):
                mb.box((x, y, FINGER_Z0 + 0.0034), (0.0007, 0.00006, 0.0054), 0)
        x += 0.001
    return mb.build('pcie_fingers', [M['gold']], smooth=None)


def build_die(M):
    mb = MB()
    mb.box((DIE_X, PCB_Y0 - 0.0006, DIE_Z), (0.044, 0.0012, 0.044), 0)               # substrate
    mb.box((DIE_X, PCB_Y0 - 0.0016, DIE_Z), (0.025, 0.0008, 0.023), 1)               # silicon
    o, i = 0.052, 0.0465                                                               # stiffener frame
    for dx, dz, sx, sz in ((0, (o + i) / 4, o, (o - i) / 2), (0, -(o + i) / 4, o, (o - i) / 2),
                           ((o + i) / 4, 0, (o - i) / 2, i), (-(o + i) / 4, 0, (o - i) / 2, i)):
        mb.box((DIE_X + dx, PCB_Y0 - 0.0005, DIE_Z + dz), (sx, 0.0010, sz), 2)
    for k in range(10):                                                                # decoupling caps
        s = -0.0135 + k * 0.003
        for dx, dz in ((s, 0.0172), (s, -0.0172), (0.0172, s), (-0.0172, s)):
            mb.box((DIE_X + dx, PCB_Y0 - 0.0014, DIE_Z + dz), (0.0012 if dz else 0.0006, 0.0004, 0.0006 if dz else 0.0012), 3)
    return finish(mb.build('gpu_die', [M['substrate'], M['silicon'], M['steel'], M['smd']], smooth=40),
                  bevel=0.00015, segs=1)


def build_vram(M):
    out = []
    for i, (x, z, sx, sz) in enumerate(vram_layout()):
        mb = MB()
        mb.box((x, PCB_Y0 - 0.0006, z), (sx, 0.0012, sz), 0)
        out.append(finish(mb.build(f'vram_{i}', [M['vram'][i]], smooth=40), bevel=0.00025, segs=2))
    return out


def build_vrm(M):
    mb = MB()
    for left, xs, stage_x in ((False, VRM_R_CHOKE_X, VRM_R_STAGE_X), (True, (VRM_L_CHOKE_X,), VRM_L_STAGE_X)):
        for z in choke_rows(left):
            for x in xs:
                mb.box((x, PCB_Y0 - 0.0020, z), (0.0075, 0.0040, 0.0075), 0)
            mb.box((stage_x, PCB_Y0 - 0.0005, z), (0.0050, 0.0010, 0.0060), 1)
    return finish(mb.build('vrm', [M['choke'], M['black']], smooth=40), bevel=0.0005, segs=2)


def build_caps(M):
    mb = MB()
    for left, xs in ((False, CAP_R_X), (True, CAP_L_X)):
        for x in xs:
            for z in cap_rows(left):
                c = (x, PCB_Y0, z)
                mb.lathe([(0, 0), (0.0025, 0), (0.0025, 0.0032), (0, 0.0032)], c, 20, 1)
                mb.lathe([(0, 0.0031), (0.0024, 0.0031), (0.0024, 0.0040), (0.0021, 0.0045), (0, 0.0045)], c, 20, 0)
    rng = np.random.default_rng(3)
    for x in np.arange(0.034, 0.047, 0.0032):                      # MLCC field between VRM and caps
        for z in np.arange(-0.040, 0.045, 0.0024):
            if rng.random() < 0.7:
                mb.box((x, PCB_Y0 - 0.0004, z), (0.0016, 0.0008, 0.0008), 2)
    for cx, cz, w, h in vram_layout():                              # decoupling around each chip
        horiz = abs(cx - DIE_X) > abs(cz - DIE_Z)
        for k in range(3):
            if horiz:
                mb.box((cx + math.copysign(w / 2 + 0.0016, cx - DIE_X), PCB_Y0 - 0.0004, cz - 0.004 + k * 0.004),
                       (0.0008, 0.0008, 0.0016), 2)
            else:
                mb.box((cx - 0.004 + k * 0.004, PCB_Y0 - 0.0004, cz + math.copysign(h / 2 + 0.0016, cz - DIE_Z)),
                       (0.0016, 0.0008, 0.0008), 2)
    return finish(mb.build('capacitors', [M['cap'], M['black'], M['smd']], smooth=40))


def build_backplate(M):
    mb = MB()
    w, h, cx, cz = SX1 - SX0, SZ1 - SZ0, (SX0 + SX1) / 2, (SZ0 + SZ1) / 2
    bev = 0.0008
    loops = [rrect(cx, cz, w, h, CORNER, inset=bev), rrect(0.1125, FAN_Z, 0.054, 0.084, 0.008, inset=-bev)]
    mb.add_mesh(plate(loops, BP_Y1 - BP_Y0, bev, 3), 0, M_XZ_FRONT, (0, (BP_Y0 + BP_Y1) / 2, 0))
    # die retention screws on the back
    for x, z in mount_holes():
        mb.lathe([(0, 0), (0.0026, 0), (0.0026, 0.0007), (0.0022, 0.0011), (0, 0.0011)], (x, BP_Y1, z), 24, 1, axis='Y')
    ob = mb.build('backplate', [M['backplate'], M['steel']], uv=planar_xz(0.15, 0.03))
    return finish(ob)


def build_bracket(M):
    mb = MB()
    y0, y1, z0, z1 = -0.0300, 0.0195, -0.0560, 0.0598
    outline = chamfer_poly([(y0, z0), (0.0070, z0), (0.0070, -0.0640), (0.0110, -0.0680), (0.0140, -0.0680),
                            (0.0140, z0), (y1, z0), (y1, z1), (y0, z1)], 0.0006)
    port_y = PCB_Y0 - 0.0031
    ports, holes = [], []
    for k, z in enumerate((-0.038, -0.016, 0.006, 0.028)):
        hdmi = k == 3
        hy, hz = 0.0031, 0.0080 if not hdmi else 0.0075
        if hdmi:
            hole = [(port_y - hy, z - hz + 0.0012), (port_y - hy + 0.0012, z - hz), (port_y + hy, z - hz),
                    (port_y + hy, z + hz), (port_y - hy + 0.0012, z + hz), (port_y - hy, z + hz - 0.0012)]
        else:
            hole = [(port_y - hy, z - hz), (port_y + hy, z - hz), (port_y + hy, z + hz),
                    (port_y - hy + 0.0015, z + hz), (port_y - hy, z + hz - 0.0015)]
        holes.append(chamfer_poly(hole, 0.0003)[::-1])
        ports.append((port_y, z, 2 * hy + 0.001, 2 * hz + 0.001))
    R = 0.0031
    for i, z in enumerate(np.arange(-0.049, 0.054, 0.0058)):
        for y in np.arange(-0.0255, 0.0015, 0.0066) + (0.0033 if i % 2 else 0):
            if y < 0.0018:
                holes.append(circle(y, z, R, 6, math.pi / 6))
    mb.add_mesh(plate([outline] + holes, 0.0009, 0.0003, 1), 0, M_YZ, (BRACKET_X, 0, 0))
    # top tab bent outward, with two screw slots
    tab = [(BRACKET_X + 0.0004, y0), (BRACKET_X + 0.0004, y1), (BRACKET_X - 0.0095, y1)]
    for sy in (0.0080, -0.0120):
        tab += [(BRACKET_X - 0.0095, sy + 0.0023), (BRACKET_X - 0.0055, sy + 0.0023),
                (BRACKET_X - 0.0055, sy - 0.0023), (BRACKET_X - 0.0095, sy - 0.0023)]
    tab += [(BRACKET_X - 0.0095, y0)]
    mb.add_mesh(plate([chamfer_poly(tab, 0.0004)[::-1]], 0.0009, 0.0003, 1), 0, M_XY, (0, 0, z1 + 0.00045))
    for y, z, sy, sz in ports:                                      # connector bodies behind the cut-outs
        mb.box((BRACKET_X + 0.0050, y, z), (0.0085, sy, sz), 1)
    return finish(mb.build('io_bracket', [M['bracket'], M['black']], smooth=40))


# ---------------------------------------------------------------- assembly / export
def reset_scene():
    for coll in (bpy.data.objects, bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.curves,
                 bpy.data.cameras, bpy.data.lights):
        for item in list(coll):
            coll.remove(item)


def build():
    reset_scene()
    tmp = tempfile.mkdtemp(prefix='gpu_tex_')
    M = make_materials(tmp)
    parts = [build_shroud(M), *[build_fan(k, M, p) for k, p in enumerate((0.0, 0.37, 0.81))],
             build_fan_frame(M), build_fins(M), build_heatpipes(M), build_pcb(M), build_die(M),
             *build_vram(M), build_vrm(M), build_caps(M), build_fingers(M), build_backplate(M),
             build_bracket(M), *build_accents()]
    # recentre on the overall bounding box
    lo, hi = np.full(3, np.inf), np.full(3, -np.inf)
    for ob in parts:
        co = np.array([v.co[:] for v in ob.data.vertices]) + np.array(ob.location[:])
        lo, hi = np.minimum(lo, co.min(0)), np.maximum(hi, co.max(0))
    centre = (lo + hi) / 2
    root = bpy.data.objects.new('gpu', None)
    bpy.context.scene.collection.objects.link(root)
    for ob in parts:
        ob.location = tuple(np.array(ob.location[:]) - centre)
        ob.parent = root
    print('GPU bbox (m):', np.round(hi - lo, 4), 'centre shift:', np.round(centre, 4))
    return root, parts


def export_glb(path, quality=82):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    root = bpy.data.objects['gpu']
    root.select_set(True)
    for ob in root.children:
        ob.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
        export_extras=True, export_cameras=False, export_lights=False, export_animations=False,
        export_texcoords=True, export_normals=True, export_tangents=False, export_materials='EXPORT',
        export_image_format='WEBP', export_image_quality=quality,
        export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=10,
        export_draco_position_quantization=14, export_draco_normal_quantization=10,
        export_draco_texcoord_quantization=12)
    print('exported', path, os.path.getsize(path), 'bytes')


def main(argv):
    args = argv[argv.index('--') + 1:] if '--' in argv else []
    glb, blend = DEFAULT_GLB, None
    for k, v in zip(args[::2], args[1::2]):
        if k == '--glb':
            glb = os.path.abspath(v)
        elif k == '--blend':
            blend = os.path.abspath(v)
    build()
    if glb != 'none':
        export_glb(glb)
    if blend:
        bpy.ops.wm.save_as_mainfile(filepath=blend)


if __name__ == '__main__':
    main(sys.argv)
