# GPU hero model

`web/public/models/gpu.glb` is a generic triple-fan graphics card for the landing hero. It is built
entirely by `build_gpu.py`: the geometry, the materials, and the PCB and brushed-metal textures.
No external assets, brands, logos or trademarks are used. It is all original work, so no license
or attribution is needed.

## Rebuild

Blender 4.5 LTS, headless (installed user-level at `~/opt/blender`):

```sh
# model + GLB  (about 2 s)
~/opt/blender/blender -b --factory-startup --python assets/3d/build_gpu.py
#   options after "--": --glb PATH (default web/public/models/gpu.glb, "none" to skip)  --blend PATH

# preview renders → assets/3d/previews/  (Cycles on the GPU via OptiX, about 20 s for all eight)
~/opt/blender/blender -b --factory-startup --python assets/3d/render_previews.py -- \
    --views hero,front,exploded,closeup --themes dark,light --samples 160 --res 1600x1000 --tmp /tmp
# transparent still at the web hero framing → previews/gpu-still.webp (≤ 120 KB)
~/opt/blender/blender -b --factory-startup --python assets/3d/render_previews.py -- --views still --themes dark --tmp /tmp
```

The build is deterministic (seeded textures), so the same script gives the same GLB.

## GLB facts

- glTF 2.0 binary, Draco mesh compression (`KHR_draco_mesh_compression`) and WebP textures
  (`EXT_texture_webp`), so the loader needs `DRACOLoader`. The textures are PCB albedo and
  roughness/metal maps at 2048×1024, plus a tiling 512² brushed roughness map.
- About 0.63 MB and about 84k triangles.
- Frame: Y up, card length along X, fans facing +Z, origin at the bounding-box centre, metres.
  The bbox is about 0.311 × 0.131 × 0.056, including the I/O bracket and the PCIe fingers.

## Node contract

Root node `gpu`. Every part is a direct child, so translate parts along `gpu`'s +Z to explode.
Parts with one material load in three.js as a `Mesh`. Parts with several materials load as a
`Group` named after the part, with one child mesh per material (`shroud`, `fan_*`, `gpu_die`,
`vrm`, `capacitors`, `backplate`, `io_bracket`), so use `getObjectByName(part)` and `traverse`.

| node | what | notes |
|---|---|---|
| `shroud` | brushed front plate with 3 fan openings + polymer skirt | |
| `fan_0`, `fan_1`, `fan_2` | rotor: 11 curved, pitched blades + hub with gold ring | origin is the hub centre; spin with `rotation.z` (positive = counter-clockwise from the front, the blades' working direction) |
| `fan_frame` | rotor rings, motor housings, struts | |
| `heatsink_fins` | 137 aluminium fins + end plates | fins reach the backplate past the PCB (flow-through) |
| `heatpipes` | copper cold plate + 5 pipes with U-bends out of the top edge | |
| `pcb` | board with PCIe edge, mounting holes, baked traces | |
| `gpu_die` | substrate, silicon, stiffener frame, decoupling caps | |
| `vram_0` … `vram_11` | memory chips, clockwise from the top-left: 0–2 top row, 3–5 right column, 6–8 bottom row, 9–11 left column | each has its own material `vram_i` |
| `vrm` | chokes + power stages | |
| `capacitors` | polymer caps + MLCC fields | |
| `pcie_fingers` | gold contacts on both faces | |
| `backplate` | brushed plate with flow-through window, retention screws | |
| `io_bracket` | bracket with 4 port cut-outs, hex vents, top tab | |
| `accent_top`, `accent_bottom`, `accent_end` | gold inlay strips on the shroud | in front of the PCB, so they travel with the shroud |
| `accent_back` | gold inlay strip on the backplate | behind the PCB, so it travels with the backplate |

### Glow

`vram_*` and `accent_*` materials export with emissive black (emission strength 0). Each one has
its own material. The intended glow colour is in `material.userData.glow` (`#f2c56b`). To light a
part, set it from the web: `m.emissive.set(m.userData.glow); m.emissiveIntensity = …`.

## Materials (PBR metallic-roughness)

| material | base | metal / rough | used by |
|---|---|---|---|
| `shroud_anodized` | #3b3f47 | 1 / brushed map ≈ 0.32 | shroud plate |
| `shroud_polymer` | #141518 | 0 / 0.48 | shroud skirt, fan frame |
| `fan_blade` | #0e0f11 | 0 / 0.38 | blades, hub |
| `fan_hub_cap` | #4a4d55 | 1 / 0.42 | hub centre |
| `gold_contact` | #ffc56e | 1 / 0.22 | PCIe fingers, hub rings |
| `aluminium_fin` | #dcdee2 | 1 / 0.20 | fins |
| `copper` | #e9a17e | 1 / 0.26 | heatpipes, cold plate |
| `pcb` | baked albedo (matte black mask, traces, vias, silkscreen outlines) | baked map ≈ 0 / 0.36–0.75 | pcb |
| `gpu_substrate`, `gpu_silicon`, `steel`, `smd_ceramic` | | | gpu_die (steel also on the backplate screws) |
| `vram_0` … `vram_11` | #121214, emissive-ready | 0 / 0.42 | memory chips |
| `vrm_choke`, `black_plastic`, `capacitor_can` | | | vrm, capacitors, port bodies |
| `backplate_anodized` | #24262b | 1 / brushed map ≈ 0.32 | backplate |
| `bracket_metal` | #3a3c41 | 1 / 0.34 | io_bracket |
| `accent_*` | #e8b45a, emissive-ready | 1 / 0.24 | accent strips |

The metals need an environment map (for example `RoomEnvironment` through `PMREMGenerator`).
Without one they render near-black.

## Previews

`previews/{hero,front,exploded,closeup}_{dark,light}.jpg` are 1600×1000 Cycles renders. The hero
uses the web's angle (rotation.y −0.60, rotation.x 0.20) and the web's light directions. The
exploded view uses the web's offsets (in units of card length / 4.4): fans and fan_frame +2.15,
shroud +1.5, fins and pipes +0.78, backplate −0.75, bracket −0.6 on x. The camera is a little
steeper than the web's, so the PCB reads clearly. `previews/gpu-still.webp` is a transparent
1536×1600 render at the web hero framing. It is a backup for the no-WebGL fallback; the web's
own still is captured from the live scene.
