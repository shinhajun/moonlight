// A procedural graphics card in three.js: shroud, fans, heatsink, PCB with die and VRAM, backplate.
// setProgress(0..1) explodes it into layers and lights the VRAM chips. No external model files.
import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  Box3,
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
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import dracoWrapperUrl from 'three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js?url';
import dracoWasmUrl from 'three/examples/jsm/libs/draco/gltf/draco_decoder.wasm?url';

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
  const move = (obj, x, y, z) => ({ obj, base: obj.position.clone(), delta: new Vector3(x, y, z) });
  return {
    object: gpu,
    moves: [move(bracket, -0.6, 0, 0), move(back, 0, 0, -0.75), move(sink, 0, 0, 0.78), move(shroud, 0, 0, 1.5), ...fans.map((f) => move(f, 0, 0, 2.15))],
    rotors: fans.map((f) => f.userData.rotor),
    chips: chips.map((mat, i) => ({ mats: [mat], glow: chipGlows[i] })),
    board,
    traceGlow,
    staticGlows: [edgeGlow, frontGlow, ...fanGlows],
  };
}

// ---------------------------------------------------------------- the Blender model

// How far each named layer travels when the card opens, in card units (the card is 4.4 long).
const EXPLODE = [
  [['fan_0', 'fan_1', 'fan_2', 'fan_frame'], [0, 0, 2.15]],
  [['shroud'], [0, 0, 1.5]],
  [['heatsink_fins', 'heatpipes'], [0, 0, 0.78]],
  [['backplate'], [0, 0, -0.75]],
  [['io_bracket'], [-0.6, 0, 0]],
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
  EXPLODE.forEach(([names, d]) => names.forEach((n) => named(n) && want.set(named(n), new Vector3(...d))));
  const pcbZ = named('pcb') ? centerOf(named('pcb')).z : 0;
  prefixed('accent_').forEach((o) => {
    for (let p = o; p; p = p.parent) if (want.has(p)) return;
    want.set(o, new Vector3(0, 0, centerOf(o).z >= pcbZ ? 1.5 : -0.75));
  });
  const moves = [];
  for (const [o, d] of want) {
    let inherited = new Vector3();
    for (let p = o.parent; p; p = p.parent) {
      if (want.has(p)) {
        inherited = want.get(p);
        break;
      }
    }
    const world = o.getWorldPosition(new Vector3());
    const from = o.parent.worldToLocal(world.clone());
    const to = o.parent.worldToLocal(world.clone().add(d.clone().sub(inherited)));
    moves.push({ obj: o, base: o.position.clone(), delta: to.sub(from) });
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
  const rotors = ['fan_0', 'fan_1', 'fan_2'].map(named).filter(Boolean);
  const pcb = named('pcb');
  return {
    object: wrap,
    moves,
    rotors,
    chips,
    board: null,
    traceGlow: pcb ? glowAt(pcb, L * 1.2, H * 1.4, 0) : null,
    staticGlows,
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

const smooth = (a, b, x) => {
  const t = MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// modelUrl: a gpu.glb following the node-name contract; the procedural card is used without one or if it fails.
export function createGpuScene(canvas, { reduced = false, modelUrl = null, onReady = () => {} } = {}) {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = SRGBColorSpace;

  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 1.0;

  const camera = new PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(0, 0.25, 8.2);

  // Studio rig: warm key from top right, cool rim from behind for edge highlights, a little gold kick.
  const key = new DirectionalLight('#fff4e6', 2.6);
  key.position.set(4, 5, 6);
  const rim = new DirectionalLight('#a9c8ff', 3.4);
  rim.position.set(4, 2, -5);
  const kick = new DirectionalLight(ACCENT, 1.4);
  kick.position.set(-6, 1.5, -2);
  const fill = new DirectionalLight('#dfe3ea', 0.45);
  fill.position.set(-3, -2, 4);
  scene.add(key, rim, kick, fill);

  // Contact shadow: a wide soft layer and a tight dark core under the card.
  const shadowTex = shadowTexture();
  const shadow = new Group();
  const soft = new Mesh(new PlaneGeometry(7.2, 3), new MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.45 }));
  const core = new Mesh(new PlaneGeometry(4.6, 1.1), new MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.6 }));
  core.position.y = 0.001;
  shadow.add(soft, core);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -1.45;
  scene.add(shadow);

  const root = new Group();
  scene.add(root);
  let rig = null;
  const use = (r, source) => {
    rig = r;
    root.add(r.object);
    api.renderOnce();
    onReady(source);
  };

  const state = { target: 0, t: 0, px: 0, py: 0, tx: 0, ty: 0, load: 0.4, last: performance.now(), lastInput: performance.now(), raf: 0, running: false, frame: 0 };

  // Lifts the card above the docked VRAM panel; glows are softer on light backgrounds.
  let frameY = 0.3;
  let glowScale = 1;
  function layout(t, time) {
    if (!rig) return;
    const e = smooth(0, 1, t);
    glowScale = document.documentElement.dataset.theme === 'light' ? 0.55 : 1;
    rig.staticGlows.forEach((g) => (g.material.opacity = g.userData.base * glowScale));
    rig.moves.forEach((m) => m.obj.position.copy(m.base).addScaledVector(m.delta, e));
    rig.chips.forEach((c, i) => {
      const k = smooth(0.42 + i * 0.035, 0.56 + i * 0.035, t);
      c.mats.forEach((m) => (m.emissiveIntensity = 1.35 * k));
      c.glow.material.opacity = 0.55 * k * glowScale;
    });
    if (rig.board) rig.board.emissiveIntensity = 0.28 * smooth(0.55, 1, t);
    if (rig.traceGlow) rig.traceGlow.material.opacity = 0.16 * smooth(0.6, 1, t) * glowScale;
    const sway = reduced ? 0 : Math.sin(time * 0.25) * 0.06;
    root.rotation.y = MathUtils.lerp(-0.6, -1.0, e) + state.px * 0.28 + sway;
    root.rotation.x = MathUtils.lerp(0.2, 0.3, e) + state.py * 0.14;
    root.position.y = frameY + (reduced ? 0 : Math.sin(time * 0.6) * 0.035);
    const s = MathUtils.lerp(1, 0.84, e);
    root.scale.setScalar(s);
    const light = document.documentElement.dataset.theme === 'light';
    shadow.position.y = frameY - 1.45;
    shadow.children[0].material.opacity = (light ? 0.22 : 0.45) * (1 - 0.35 * e);
    shadow.children[1].material.opacity = (light ? 0.3 : 0.6) * (1 - 0.5 * e);
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - state.last) / 1000);
    state.last = now;
    // Critically damped follow for scroll and pointer, so motion stays smooth at any scroll speed.
    const k = 1 - Math.exp(-dt * 6);
    state.t += (state.target - state.t) * k;
    state.px += (state.tx - state.px) * (1 - Math.exp(-dt * 4));
    state.py += (state.ty - state.py) * (1 - Math.exp(-dt * 4));
    const spin = dt * (2.2 + 4.5 * state.load);
    rig?.rotors.forEach((r, i) => (r.rotation.z -= spin * (1 + i * 0.03)));
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
    setProgress(p) {
      state.target = MathUtils.clamp(p, 0, 1);
      state.lastInput = performance.now();
      if (reduced || !state.running) {
        state.t = state.target;
        layout(state.t, 0);
        renderer.render(scene, camera);
      }
    },
    setPointer(x, y) {
      if (reduced) return;
      state.tx = x;
      state.ty = y;
      state.lastInput = performance.now();
    },
    setLoad(l) {
      state.load = l;
    },
    resize(w, h) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // Fit about 4.5 units of card across the canvas, and keep it in frame vertically.
      const tan = Math.tan(MathUtils.degToRad(camera.fov / 2));
      camera.position.z = Math.max(5.5 / camera.aspect / (2 * tan), 3.6 / (2 * tan));
      frameY = camera.aspect < 1.4 ? 0.42 : 0.2;
      camera.updateProjectionMatrix();
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
