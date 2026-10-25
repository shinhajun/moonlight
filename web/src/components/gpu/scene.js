// The landing hero's graphics card in three.js: the Blender model, or a procedural one (shroud, fans,
// heatsink, PCB with die and VRAM, backplate). Hero progress 0..1 turns it, takes it apart layer by layer
// and lights the VRAM chips (see timeline.js); the camera refits every frame so nothing leaves the frame.
import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  Box3,
  Euler,
  Matrix3,
  Vector3,
  RepeatWrapping,
  Sprite,
  SpriteMaterial,
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  ExtrudeGeometry,
  Group,
  InstancedMesh,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Path,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  Shape,
  SRGBColorSpace,
  TorusGeometry,
  WebGLRenderer,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import dracoWrapperUrl from 'three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js?url';
import dracoWasmUrl from 'three/examples/jsm/libs/draco/gltf/draco_decoder.wasm?url';
import { CHIPS, LAYERS, TURN, chipsLit, copyOut, smooth } from './timeline.js';

const L = 4.4; // length
const H = 1.75; // height
const ACCENT = new Color('#f2c56b');
const FANS = [-1.42, 0, 1.42];

function roundedRect(w, h, r) {
  const s = new Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

// Circuit traces drawn once into a canvas: the PCB's color map and, in accent, its glow map.
function traceTextures() {
  const w = 1024;
  const h = 408;
  const make = (bg, line, pad) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    g.strokeStyle = line;
    g.lineCap = 'round';
    for (let i = 0; i < 150; i++) {
      g.lineWidth = rnd() < 0.2 ? 2.2 : 1.1;
      let x = rnd() * w;
      let y = rnd() * h;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        const len = 30 + rnd() * 140;
        const dir = Math.floor(rnd() * 4);
        if (dir === 0) x += len;
        else if (dir === 1) x -= len;
        else if (dir === 2) y += len * 0.6;
        else y -= len * 0.6;
        if (rnd() < 0.5) {
          x += len * 0.4;
          y += len * 0.4 * (rnd() < 0.5 ? 1 : -1);
        }
        g.lineTo(x, y);
      }
      g.stroke();
      if (pad) {
        g.fillStyle = pad;
        g.beginPath();
        g.arc(x, y, 2.6, 0, Math.PI * 2);
        g.fill();
      }
    }
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  return { map: make('#121519', '#1d242b', '#2a3138'), glow: make('#000000', '#b38a3e', '#f2c56b') };
}

// Fine horizontal streaks: a roughness map that makes the shroud read as brushed metal.
function brushedTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#7a7a7a';
  g.fillRect(0, 0, 512, 512);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 2600; i++) {
    const v = rnd() < 0.5 ? 255 : 0;
    g.strokeStyle = `rgba(${v},${v},${v},${0.03 + rnd() * 0.09})`;
    g.lineWidth = rnd() < 0.85 ? 1 : 2;
    const y = rnd() * 512;
    const x = rnd() * 512;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + 40 + rnd() * 360, y + (rnd() - 0.5) * 1.5);
    g.stroke();
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(0.3, 0.3);
  return t;
}

// Soft round falloff used for the glow sprites (a cheap, alpha-safe stand-in for bloom).
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new CanvasTexture(c);
}

function shadowTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 64, 4, 128, 64, 126);
  grad.addColorStop(0, 'rgba(0,0,0,0.9)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.save();
  g.scale(1, 0.5);
  g.fillRect(0, 0, 256, 256);
  g.restore();
  return new CanvasTexture(c);
}

// A dark studio for the metal to mirror, in place of a lit room: tall softbox strips (warm key front left, cool
// strip far left that the turned shroud swings into, cool rim behind right, a thin gold kick low behind) and only a
// faint ceiling, so reflections read as long streaks with deep falloff between them. Colors above 1 are HDR.
function studioEnvironment(pmrem) {
  const env = new Scene();
  env.background = new Color('#0b0d11'); // a faint base, so flat dark faces never go to pure black
  const strip = (w, h, color, intensity, dir) => {
    const m = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color: new Color(color).multiplyScalar(intensity) }));
    m.position.set(...dir).setLength(7);
    m.lookAt(0, m.position.y, 0);
    env.add(m);
  };
  strip(1.1, 9, '#fff1de', 4, [-0.45, 0.15, 0.9]);
  strip(1.2, 9, '#cfe0ff', 3.5, [-1, 0.1, 0.05]);
  strip(1.4, 9, '#a9c8ff', 9, [0.75, 0.2, -0.65]);
  strip(5, 0.5, '#f2c56b', 5, [-0.6, -0.35, -0.7]);
  strip(1.6, 6, '#e8ecf2', 1.6, [0.85, 0.1, 0.5]);
  strip(6, 6, '#d9dee6', 0.5, [0, 1, 0.1]); // a faint ceiling, too dim to read as a panel on the fin tops
  const tex = pmrem.fromScene(env, 0.02).texture;
  env.traverse((o) => (o.geometry?.dispose(), o.material?.dispose()));
  return tex;
}

function buildGpu() {
  const brushed = brushedTexture();
  const mats = {
    shroud: new MeshPhysicalMaterial({ color: '#4a505a', metalness: 0.92, roughness: 0.42, roughnessMap: brushed, clearcoat: 0.35, clearcoatRoughness: 0.3 }),
    frame: new MeshStandardMaterial({ color: '#2b2f36', metalness: 0.88, roughness: 0.38, roughnessMap: brushed }),
    blade: new MeshPhysicalMaterial({ color: '#16181c', metalness: 0.25, roughness: 0.4, clearcoat: 0.5 }),
    alu: new MeshStandardMaterial({ color: '#b8bdc6', metalness: 1, roughness: 0.32 }),
    copper: new MeshStandardMaterial({ color: '#c8794a', metalness: 1, roughness: 0.24 }),
    back: new MeshStandardMaterial({ color: '#30353d', metalness: 0.9, roughness: 0.4, roughnessMap: brushed }),
    steel: new MeshStandardMaterial({ color: '#9aa0a8', metalness: 1, roughness: 0.28 }),
    gold: new MeshStandardMaterial({ color: '#d9a94b', metalness: 1, roughness: 0.22 }),
    die: new MeshStandardMaterial({ color: '#cfd3da', metalness: 1, roughness: 0.14 }),
    substrate: new MeshStandardMaterial({ color: '#1f2b27', metalness: 0.3, roughness: 0.6 }),
    part: new MeshStandardMaterial({ color: '#202226', metalness: 0.4, roughness: 0.55 }),
    choke: new MeshStandardMaterial({ color: '#3a3d43', metalness: 0.6, roughness: 0.4 }),
    edge: new MeshBasicMaterial({ color: ACCENT, toneMapped: false }),
  };
  const gpu = new Group();

  // ---- PCB: the anchor layer
  const pcb = new Group();
  const tex = traceTextures();
  const board = new MeshStandardMaterial({ map: tex.map, emissiveMap: tex.glow, emissive: ACCENT, emissiveIntensity: 0, metalness: 0.2, roughness: 0.7 });
  const side = new MeshStandardMaterial({ color: '#101215', roughness: 0.8 });
  pcb.add(new Mesh(new BoxGeometry(L - 0.12, H - 0.1, 0.035), [side, side, side, side, board, side]));
  const tab = new Mesh(new BoxGeometry(1.75, 0.16, 0.035), side);
  tab.position.set(-0.55, -(H - 0.1) / 2 - 0.07, 0);
  pcb.add(tab);
  for (let i = 0; i < 28; i++) {
    const f = new Mesh(new BoxGeometry(0.038, 0.12, 0.006), mats.gold);
    f.position.set(-1.38 + i * 0.062, -(H - 0.1) / 2 - 0.08, 0.02);
    pcb.add(f);
  }
  const sub = new Mesh(new BoxGeometry(0.8, 0.8, 0.03), mats.substrate);
  sub.position.set(-0.35, 0.05, 0.032);
  const die = new Mesh(new BoxGeometry(0.46, 0.46, 0.025), mats.die);
  die.position.set(-0.35, 0.05, 0.058);
  pcb.add(sub, die);
  // VRAM around the die, ordered so they light up as a ring.
  const chipSpots = [
    [-1.05, 0.45], [-0.55, 0.62], [-0.15, 0.62], [0.32, 0.45], [0.32, 0.05], [0.32, -0.35],
    [-0.15, -0.55], [-0.55, -0.55], [-1.05, -0.35], [-1.05, 0.05], [0.72, 0.45], [0.72, -0.35],
  ];
  const chips = chipSpots.map(([x, y]) => {
    const m = new MeshStandardMaterial({ color: '#141518', metalness: 0.35, roughness: 0.45, emissive: ACCENT, emissiveIntensity: 0 });
    const c = new Mesh(new BoxGeometry(0.27, 0.2, 0.032), m);
    c.position.set(x, y, 0.034);
    pcb.add(c);
    return m;
  });
  for (let r = 0; r < 6; r++) {
    for (let k = 0; k < 2; k++) {
      const s = new Mesh(new BoxGeometry(0.11, 0.11, 0.05), k ? mats.choke : mats.part);
      s.position.set(1.15 + k * 0.17, -0.55 + r * 0.21, 0.04);
      pcb.add(s);
    }
  }
  const capGeo = new CylinderGeometry(0.045, 0.045, 0.1, 20);
  capGeo.rotateX(Math.PI / 2);
  for (let i = 0; i < 8; i++) {
    const c = new Mesh(capGeo, mats.steel);
    c.position.set(1.62 + (i % 2) * 0.12, -0.42 + Math.floor(i / 2) * 0.24, 0.06);
    pcb.add(c);
  }
  const power = new Mesh(new BoxGeometry(0.46, 0.16, 0.2), mats.part);
  power.position.set(1.55, H / 2 - 0.04, 0.1);
  pcb.add(power);
  pcb.position.z = -0.27;

  // ---- heatsink: aluminium fins, copper heatpipes and contact plate
  const sink = new Group();
  const finCount = 84;
  const fins = new InstancedMesh(new BoxGeometry(0.014, H - 0.24, 0.3), mats.alu, finCount);
  const m4 = new Matrix4();
  for (let i = 0; i < finCount; i++) {
    m4.makeTranslation(-L / 2 + 0.2 + (i * (L - 0.4)) / (finCount - 1), 0, 0);
    fins.setMatrixAt(i, m4);
  }
  sink.add(fins);
  const pipeGeo = new CylinderGeometry(0.036, 0.036, L - 0.55, 20);
  pipeGeo.rotateZ(Math.PI / 2);
  [-0.42, -0.21, 0, 0.21, 0.42].forEach((y) => {
    const p = new Mesh(pipeGeo, mats.copper);
    p.position.set(0, y, -0.06);
    sink.add(p);
  });
  [-1, 1].forEach((dir) => {
    [-0.315, 0.105].forEach((y) => {
      const bend = new Mesh(new TorusGeometry(0.105, 0.036, 12, 24, Math.PI), mats.copper);
      bend.rotation.z = dir > 0 ? -Math.PI / 2 : Math.PI / 2;
      bend.position.set(dir * ((L - 0.55) / 2), y, -0.06);
      sink.add(bend);
    });
  });
  const plate = new Mesh(new BoxGeometry(0.9, 0.9, 0.05), mats.copper);
  plate.position.set(-0.35, 0.05, -0.19);
  sink.add(plate);
  sink.position.z = -0.02;

  // ---- shroud: beveled face with three fan openings, side frame, glowing edge
  const shroud = new Group();
  const face = roundedRect(L, H, 0.16);
  FANS.forEach((x) => {
    const hole = new Path();
    hole.absarc(x, 0, 0.62, 0, Math.PI * 2, true);
    face.holes.push(hole);
  });
  shroud.add(new Mesh(new ExtrudeGeometry(face, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.025, bevelSegments: 4, curveSegments: 64 }), mats.shroud));
  const frameShape = roundedRect(L, H, 0.16);
  frameShape.holes.push(roundedRect(L - 0.09, H - 0.09, 0.12));
  const frame = new Mesh(new ExtrudeGeometry(frameShape, { depth: 0.36, bevelEnabled: false, curveSegments: 24 }), mats.frame);
  frame.position.z = -0.34;
  shroud.add(frame);
  const edgeTop = new Mesh(new BoxGeometry(L - 0.7, 0.02, 0.022), mats.edge);
  edgeTop.position.set(0.1, H / 2 + 0.004, -0.1);
  const edgeFront = new Mesh(new BoxGeometry(L - 0.5, 0.012, 0.012), mats.edge);
  edgeFront.position.set(0, -H / 2 + 0.085, 0.083);
  shroud.add(edgeTop, edgeFront);
  shroud.position.z = 0.16;

  // ---- fans: eleven pitched blades merged into one mesh each
  const blade = new Shape();
  blade.moveTo(0.15, -0.06);
  blade.quadraticCurveTo(0.4, -0.2, 0.585, -0.1);
  blade.quadraticCurveTo(0.52, 0.1, 0.17, 0.07);
  blade.closePath();
  const bladeGeo = new ExtrudeGeometry(blade, { depth: 0.012, bevelEnabled: false, curveSegments: 12 });
  const blades = [];
  for (let i = 0; i < 11; i++) {
    const g = bladeGeo.clone();
    g.rotateX(0.38);
    g.rotateZ((i / 11) * Math.PI * 2);
    blades.push(g);
  }
  const rotorGeo = mergeGeometries(blades);
  const hubGeo = new CylinderGeometry(0.17, 0.17, 0.075, 48);
  hubGeo.rotateX(Math.PI / 2);
  const fans = FANS.map((x) => {
    const fan = new Group();
    const rotor = new Group();
    rotor.add(new Mesh(rotorGeo, mats.blade));
    rotor.add(new Mesh(hubGeo, mats.frame));
    const cap = new Mesh(new CircleGeometry(0.13, 48), mats.shroud);
    cap.position.z = 0.04;
    const ring = new Mesh(new TorusGeometry(0.135, 0.006, 8, 64), mats.edge);
    ring.position.z = 0.041;
    rotor.add(cap, ring);
    fan.add(rotor);
    const outer = new Mesh(new TorusGeometry(0.615, 0.02, 12, 72), mats.frame);
    fan.add(outer);
    fan.position.set(x, 0, 0.17);
    fan.userData.rotor = rotor;
    return fan;
  });

  // ---- backplate and IO bracket
  const back = new Group();
  back.add(new Mesh(new RoundedBoxGeometry(L, H, 0.035, 2, 0.02), mats.back));
  const backLine = new Mesh(new BoxGeometry(L - 0.9, 0.01, 0.006), mats.edge);
  backLine.position.set(0.2, -H / 2 + 0.12, -0.02);
  back.add(backLine);
  back.position.z = -0.33;
  const bracket = new Group();
  bracket.add(new Mesh(new BoxGeometry(0.035, H + 0.12, 0.62), mats.steel));
  for (let i = 0; i < 4; i++) {
    const port = new Mesh(new BoxGeometry(0.01, 0.12, 0.28), mats.part);
    port.position.set(-0.02, -0.45 + i * 0.3, 0.05);
    bracket.add(port);
  }
  bracket.position.set(-L / 2 - 0.04, 0, -0.08);

  // Glow sprites: always facing the camera, additive, faded in with what they light.
  const glowTex = glowTexture();
  const glow = (w, h, opacity) => {
    const s = new Sprite(new SpriteMaterial({ map: glowTex, color: ACCENT, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false }));
    s.scale.set(w, h, 1);
    s.userData.base = opacity;
    return s;
  };
  const edgeGlow = glow(L * 0.95, 0.32, 0.5);
  edgeGlow.position.copy(edgeTop.position);
  const frontGlow = glow(L * 1.0, 0.26, 0.42);
  frontGlow.position.copy(edgeFront.position);
  shroud.add(edgeGlow, frontGlow);
  const fanGlows = fans.map((f) => {
    const g = glow(0.62, 0.62, 0.3);
    g.position.z = 0.06;
    f.add(g);
    return g;
  });
  const chipGlows = chipSpots.map(([x, y]) => {
    const g = glow(0.75, 0.62, 0);
    g.position.set(x, y, 0.09);
    pcb.add(g);
    return g;
  });
  const traceGlow = glow(L * 1.25, H * 1.5, 0);
  traceGlow.position.set(0, 0, 0.05);
  pcb.add(traceGlow);

  gpu.add(pcb, sink, shroud, back, bracket, ...fans);
  const move = (obj, layer, x, y, z) => ({ obj, layer, base: obj.position.clone(), delta: new Vector3(x, y, z) });
  return {
    object: gpu,
    moves: [move(bracket, 'bracket', -0.6, 0, 0), move(back, 'back', 0, 0, -0.5), move(sink, 'sink', 0, 0, 1.6), move(shroud, 'shroud', 0, 0, 2.0), ...fans.map((f) => move(f, 'fans', 0, 0, 2.3))],
    rotors: fans.map((f) => f.userData.rotor),
    spin: -1,
    chips: chips.map((mat, i) => ({ mats: [mat], glow: chipGlows[i] })),
    board,
    traceGlow,
    staticGlows: [edgeGlow, frontGlow, ...fanGlows],
  };
}

// ---------------------------------------------------------------- the Blender model

// How far each named layer travels when the card opens, in card units (the card is 4.4 long), and its beat.
// The heatsink clears the PCB so the VRAM shows; the shroud and fans sit just outside each other's walls.
const EXPLODE = [
  [['fan_0', 'fan_1', 'fan_2', 'fan_frame'], [0, 0, 2.3], 'fans'],
  [['shroud'], [0, 0, 2.0], 'shroud'],
  [['heatsink_fins', 'heatpipes'], [0, 0, 1.6], 'sink'],
  [['backplate'], [0, 0, -0.5], 'back'],
  [['io_bracket'], [-0.6, 0, 0], 'bracket'],
];

// Builds the same rig from gpu.glb by node name (Y up, fans face +Z, length along X).
function rigFromGltf(model) {
  const glowTex = glowTexture();
  const box = new Box3().setFromObject(model);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const wrap = new Group();
  model.position.sub(center);
  wrap.add(model);
  wrap.scale.setScalar(L / size.x);
  wrap.updateMatrixWorld(true);
  const named = (n) => model.getObjectByName(n);
  // Top-level matches only: a multi-material node's child meshes share its name prefix.
  const prefixed = (p) => {
    const out = [];
    model.traverse((o) => o.name.startsWith(p) && !o.parent?.name.startsWith(p) && out.push(o));
    return out;
  };
  const centerOf = (o) => new Box3().setFromObject(o).getCenter(new Vector3());
  const sizeOf = (o) => new Box3().setFromObject(o).getSize(new Vector3());
  const glowAt = (node, w, h, opacity) => {
    const s = new Sprite(new SpriteMaterial({ map: glowTex, color: ACCENT, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false }));
    const ws = node.getWorldScale(new Vector3());
    s.scale.set(w / ws.x, h / ws.y, 1);
    s.position.copy(node.worldToLocal(centerOf(node)));
    s.userData.base = opacity;
    node.add(s);
    return s;
  };

  // Explode moves; a node inside a moving parent only moves by the difference.
  const want = new Map();
  EXPLODE.forEach(([names, d, layer]) => names.forEach((n) => named(n) && want.set(named(n), { d: new Vector3(...d), layer })));
  // Accent strips leave with the shroud in front of the PCB or the backplate behind it.
  const pcbZ = named('pcb') ? centerOf(named('pcb')).z : 0;
  prefixed('accent_').forEach((o) => {
    for (let p = o; p; p = p.parent) if (want.has(p)) return;
    want.set(o, centerOf(o).z >= pcbZ ? { d: new Vector3(0, 0, 2.0), layer: 'shroud' } : { d: new Vector3(0, 0, -0.5), layer: 'back' });
  });
  const moves = [];
  for (const [o, { d, layer }] of want) {
    let inherited = new Vector3();
    for (let p = o.parent; p; p = p.parent) {
      if (want.has(p)) {
        inherited = want.get(p).d;
        break;
      }
    }
    const world = o.getWorldPosition(new Vector3());
    const from = o.parent.worldToLocal(world.clone());
    const to = o.parent.worldToLocal(world.clone().add(d.clone().sub(inherited)));
    moves.push({ obj: o, layer, base: o.position.clone(), delta: to.sub(from) });
  }

  const emissive = (o, intensity) => {
    const mats = [];
    o.traverse((m) => {
      if (!m.isMesh) return;
      m.material = m.material.clone();
      m.material.emissive = ACCENT.clone();
      m.material.emissiveIntensity = intensity;
      mats.push(m.material);
    });
    return mats;
  };
  const chips = [];
  for (let i = 0; i < 12; i++) {
    const c = named(`vram_${i}`);
    if (c) chips.push({ mats: emissive(c, 0), glow: glowAt(c, 0.75, 0.62, 0) });
  }
  const staticGlows = [];
  prefixed('accent_').forEach((o) => {
    emissive(o, 1.6);
    const s = sizeOf(o);
    staticGlows.push(glowAt(o, Math.max(s.x, s.y) * 1.15 + 0.2, Math.min(s.x, s.y) + 0.24, 0.5));
  });
  // Seen from above, the fins' polished tops mirror the studio's ceiling as a white slab: dim their reflections.
  const dim = [];
  named('heatsink_fins')?.traverse((m) => m.isMesh && dim.push(m.material));
  const rotors = ['fan_0', 'fan_1', 'fan_2'].map(named).filter(Boolean);
  const pcb = named('pcb');
  return {
    object: wrap,
    moves,
    rotors,
    spin: 1, // positive rotation.z is the blades' working direction in gpu.glb
    chips,
    board: null,
    traceGlow: pcb ? glowAt(pcb, L * 1.2, H * 1.4, 0) : null,
    staticGlows,
    dim,
  };
}

function loadModel(url, renderer) {
  // The glTF-only Draco decoder, as hashed assets (fetched only if the model is Draco-compressed).
  const draco = new DRACOLoader().setDecoderPath({ js: dracoWrapperUrl, wasm: dracoWasmUrl });
  const loader = new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
  return loader.loadAsync(url).then((gltf) => {
    draco.dispose();
    renderer.compile(gltf.scene, new PerspectiveCamera());
    return rigFromGltf(gltf.scene);
  });
}

// A mesh's own box, without the glow sprites hung under it.
function ownBox(o) {
  if (o.isInstancedMesh) {
    o.computeBoundingBox();
    return o.boundingBox.clone();
  }
  if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
  return o.geometry.boundingBox.clone();
}

// Where the card may go until the page measures its rooms: canvas fractions, top-left origin.
const FULL = { x: 0.04, y: 0.04, w: 0.92, h: 0.87 };

// modelUrl: a gpu.glb following the node-name contract; the procedural card is used without one or if it fails.
// progress: returns hero progress 0..1, read every frame while running.
export function createGpuScene(canvas, { reduced = false, modelUrl = null, onReady = () => {}, progress = null } = {}) {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = SRGBColorSpace;

  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = studioEnvironment(pmrem);
  scene.environmentIntensity = 1.0;

  const camera = new PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(0, 0, 12);

  // Low-key rig: a warm key high on the right, hard cool rim from behind for edge highlights, a gold kick, and
  // no fill so the shadow side falls off.
  const key = new DirectionalLight('#fff1de', 3.2);
  key.position.set(4, 6, 5);
  const rim = new DirectionalLight('#a9c8ff', 5);
  rim.position.set(4, 3, -5);
  const kick = new DirectionalLight(ACCENT, 2);
  kick.position.set(-6, 1, -3);
  // Turned, the fans face left, away from the key: a soft front-left light keeps them reading.
  const side = new DirectionalLight('#e6eaf0', 0.6);
  side.position.set(-6, 3, 5);
  scene.add(key, rim, kick, side);

  // Contact shadow: a wide soft layer and a tight dark core under the card.
  const shadowTex = shadowTexture();
  const shadow = new Group();
  const soft = new Mesh(new PlaneGeometry(3.6, 1.7), new MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.45 }));
  const core = new Mesh(new PlaneGeometry(2.1, 0.6), new MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.6 }));
  core.position.y = 0.001;
  shadow.add(soft, core);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -L / 2 - 0.35;
  scene.add(shadow);

  // root: yaw, tilt and float. pose: stands the card up, long axis vertical, fans toward the viewer.
  const root = new Group();
  const pose = new Group();
  pose.rotation.z = Math.PI / 2;
  root.add(pose);
  scene.add(root);
  let rig = null;
  let parts = [];
  let pts = null;
  const use = (r, source) => {
    rig = r;
    rig.source = source;
    // A material's own envMapIntensity only applies with its own envMap.
    rig.dim?.forEach((m) => {
      m.envMap = scene.environment;
      m.envMapIntensity = 0.6;
      m.needsUpdate = true;
    });
    pose.add(r.object);
    measure();
    api.renderOnce();
    onReady(source);
  };

  // Each layer's box in root space (standing, closed) and how far it travels, for the camera fit.
  function measure() {
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    root.updateMatrixWorld(true);
    const owner = new Map();
    rig.moves.forEach((m) => m.obj.traverse((o) => owner.set(o, m)));
    const boxes = new Map();
    rig.object.traverse((o) => {
      if (!o.isMesh) return;
      const m = owner.get(o) || null;
      if (!boxes.has(m)) boxes.set(m, new Box3());
      boxes.get(m).union(ownBox(o).applyMatrix4(o.matrixWorld));
    });
    parts = [...boxes].map(([m, b]) => ({
      win: m && LAYERS[m.layer],
      delta: m ? m.delta.clone().applyMatrix3(new Matrix3().setFromMatrix4(m.obj.parent.matrixWorld)) : new Vector3(),
      corners: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => new Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z)),
    }));
    pts = new Float32Array(parts.length * 24);
  }

  // Frames the turned, opened card inside the room: centered on its box, as close as it can be with every
  // corner inside. The room slides from the closed card's box (rest) to the space between the side story
  // (open) as the hero copy steps aside.
  const turn = new Matrix4();
  const euler = new Euler();
  const v = new Vector3();
  function fit(t, pitch, yaw, roll) {
    turn.makeRotationFromEuler(euler.set(pitch, yaw, roll));
    let n = 0;
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const part of parts) {
      const e = part.win ? smooth(part.win[0], part.win[1], t) : 0;
      for (const c of part.corners) {
        v.copy(c).addScaledVector(part.delta, e).applyMatrix4(turn);
        pts[n++] = v.x;
        pts[n++] = v.y;
        pts[n++] = v.z;
        x0 = Math.min(x0, v.x);
        x1 = Math.max(x1, v.x);
        y0 = Math.min(y0, v.y);
        y1 = Math.max(y1, v.y);
      }
    }
    const k = copyOut(t);
    const { rest: r, open: o, avoid } = state.room;
    const w = MathUtils.lerp(r.w, o.w, k);
    const h = MathUtils.lerp(r.h, o.h, k);
    const ox = (MathUtils.lerp(r.x, o.x, k) + w / 2) * 2 - 1;
    const oy = 1 - (MathUtils.lerp(r.y, o.y, k) + h / 2) * 2;
    const tanY = Math.tan(MathUtils.degToRad(camera.fov / 2));
    const tanX = tanY * camera.aspect;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    let d = 0;
    for (let i = 0; i < n; i += 3) d = Math.max(d, pts[i + 2] + Math.abs(pts[i] - cx) / (tanX * w), pts[i + 2] + Math.abs(pts[i + 1] - cy) / (tanY * h));
    // Then, once the side text is in, back off just enough that no layer's box touches it.
    const hits = (dist) => {
      for (let p = 0; p < n; p += 24) {
        let a0 = Infinity;
        let a1 = -Infinity;
        let b0 = Infinity;
        let b1 = -Infinity;
        for (let i = p; i < p + 24; i += 3) {
          const s = 1 / (dist - pts[i + 2]);
          const x = (1 + ox + (pts[i] - cx) * s / tanX) / 2;
          const y = (1 - oy - (pts[i + 1] - cy) * s / tanY) / 2;
          a0 = Math.min(a0, x);
          a1 = Math.max(a1, x);
          b0 = Math.min(b0, y);
          b1 = Math.max(b1, y);
        }
        for (const q of avoid) if (a0 < q.x + q.w && a1 > q.x && b0 < q.y + q.h && b1 > q.y) return true;
      }
      return false;
    };
    if (k > 0 && avoid?.length && hits(d)) {
      let lo = d;
      let hi = d * 4;
      for (let i = 0; i < 18; i++) {
        const mid = (lo + hi) / 2;
        if (hits(mid)) lo = mid;
        else hi = mid;
      }
      d = hi;
    }
    camera.position.set(cx, cy, d);
    // Lens shift: the card's center lands on the room's center without turning the camera. setViewOffset also
    // sets the aspect from the full size, so the full size keeps the canvas's aspect.
    const a = camera.aspect;
    camera.setViewOffset(2 * a, 2, -ox * a, oy, 2 * a, 2);
    camera.updateProjectionMatrix();
  }

  const state = { t: 0, room: { rest: FULL, open: FULL }, last: performance.now(), lastInput: performance.now(), raf: 0, running: false, frame: 0 };

  // Glows are softer on light backgrounds and breathe slowly when idle.
  let glowScale = 1;
  function layout(t, time) {
    if (!rig) return;
    glowScale = document.documentElement.dataset.theme === 'light' ? 0.55 : 1;
    // Idle motion (sway, float, breathing glow) only at the top; once scrolling starts the card holds still.
    const idle = reduced ? 0 : 1 - smooth(0, 0.06, t);
    const breath = 1 - idle * 0.18 * (0.5 - 0.5 * Math.sin(time * 1.4));
    rig.staticGlows.forEach((g) => (g.material.opacity = g.userData.base * glowScale * breath));
    rig.moves.forEach((m) => m.obj.position.copy(m.base).addScaledVector(m.delta, smooth(...LAYERS[m.layer], t)));
    const span = 0.07;
    const step = (CHIPS[1] - CHIPS[0] - span) / Math.max(1, rig.chips.length - 1);
    rig.chips.forEach((c, i) => {
      const k = smooth(CHIPS[0] + i * step, CHIPS[0] + i * step + span, t);
      c.mats.forEach((m) => (m.emissiveIntensity = 1.35 * k));
      c.glow.material.opacity = 0.55 * k * glowScale;
    });
    if (rig.board) rig.board.emissiveIntensity = 0.28 * smooth(0.62, 0.85, t);
    if (rig.traceGlow) rig.traceGlow.material.opacity = 0.16 * smooth(0.62, 0.85, t) * glowScale;
    // At rest, a hero shot: seen from below (top leaning away), about 24° of yaw, a slight dutch roll and a long
    // lens. Opening, the view cranes up over the card while it swings to 43° and levels out, ending on the
    // internals from above: the layers separate mostly in depth, so the opened card stays narrow enough to be
    // big between the side texts. The lens narrows further (the fit keeps the size), so the front layers
    // don't swell and turn edge-on.
    const k = smooth(TURN[0], TURN[1], t);
    const yaw = MathUtils.lerp(-0.42, -0.75, k);
    const pitch = MathUtils.lerp(-0.14, 0.4, k);
    const roll = MathUtils.lerp(0.06, 0, k);
    camera.fov = MathUtils.lerp(24, 17, k);
    // Idle: a slow orbit and a drifting camera height, out of phase so the move never visibly loops.
    root.rotation.set(pitch + idle * Math.sin(time * 0.21) * 0.03, yaw + idle * Math.sin(time * 0.3) * 0.08, roll);
    root.position.y = idle * Math.sin(time * 0.6) * 0.03;
    fit(t, pitch, yaw, roll);
    const light = document.documentElement.dataset.theme === 'light';
    const ground = 1 - 0.9 * smooth(0.06, 0.4, t);
    shadow.children[0].material.opacity = (light ? 0.22 : 0.45) * ground;
    shadow.children[1].material.opacity = (light ? 0.3 : 0.6) * ground;
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - state.last) / 1000);
    state.last = now;
    const p = progress ? progress() : state.t;
    if (p !== state.t) {
      state.t = p;
      state.lastInput = now;
    }
    // Fans speed up as the VRAM lights: the card is serving.
    const spin = dt * (2.1 + 2.6 * chipsLit(state.t));
    rig?.rotors.forEach((r, i) => (r.rotation.z += rig.spin * spin * (1 + i * 0.03)));
    layout(state.t, now / 1000);
    renderer.render(scene, camera);
  }

  function loop(now) {
    if (!state.running) return;
    state.raf = requestAnimationFrame(loop);
    // After 12 s without input, draw every other frame.
    const idle = now - state.lastInput > 12_000;
    if (idle && state.frame++ % 2) return;
    frame(now);
  }

  const api = {
    // Sets progress directly (stills and captures); a running scene reads `progress` instead.
    setProgress(p) {
      state.t = MathUtils.clamp(p, 0, 1);
      if (!state.running) api.renderOnce();
    },
    // { rest, open }: the boxes the closed and the opened card fill, in canvas fractions.
    setRoom(room) {
      state.room = room;
      if (!state.running) api.renderOnce();
    },
    resize(w, h) {
      // A full-screen canvas: cap the pixel count on big, dense displays.
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75, Math.sqrt(4.4e6 / Math.max(1, w * h))));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      if (!state.running) api.renderOnce();
    },
    start() {
      if (state.running || reduced) return;
      state.running = true;
      state.last = performance.now();
      state.raf = requestAnimationFrame(loop);
    },
    stop() {
      state.running = false;
      cancelAnimationFrame(state.raf);
    },
    renderOnce() {
      layout(state.t, 0);
      renderer.render(scene, camera);
    },
    info: () => ({ source: rig?.source, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, gl: renderer.getContext().getParameter(renderer.getContext().VERSION) }),
    dispose() {
      api.stop();
      scene.traverse((o) => {
        o.geometry?.dispose();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
          m?.map?.dispose();
          m?.emissiveMap?.dispose();
          m?.dispose();
        });
      });
      pmrem.dispose();
      renderer.dispose();
    },
  };
  if (modelUrl) {
    loadModel(modelUrl, renderer)
      .then((r) => use(r, 'glb'))
      .catch(() => use(buildGpu(), 'procedural'));
  } else {
    use(buildGpu(), 'procedural');
  }
  return api;
}
