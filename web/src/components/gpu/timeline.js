// The landing hero's scroll story, shared by the page (copy, side story) and the 3D scene (turn, layers, VRAM).
// Every beat is a window of hero progress 0..1; scrolling back plays it in reverse.

export const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// The side copy steps aside first so the card and the story own the screen.
export const COPY = [0.02, 0.11];
// The card turns from about 37° to 43° of yaw as the view cranes up over it; done by the VRAM beat.
export const TURN = [0.04, 0.62];
// Layers leave in order; the PCB stays put. The rest of the scroll holds the opened card.
export const LAYERS = {
  fans: [0.08, 0.3],
  shroud: [0.18, 0.4],
  sink: [0.32, 0.52],
  back: [0.68, 0.84],
  bracket: [0.7, 0.86],
};
// VRAM chips light one by one, after the heatsink has cleared them.
export const CHIPS = [0.5, 0.7];
// The side story: one pair of blocks per beat (fans and shroud, heatsink, PCB, backplate). Each starts as the
// previous one finishes leaving, so only one pair shows at a time; the last stays to the end.
export const BEATS = [0.12, 0.34, 0.52, 0.72];
const FADE = 0.035;

export const copyOut = (p) => smooth(COPY[0], COPY[1], p);
export const chipsLit = (p) => smooth(CHIPS[0], CHIPS[1], p);
export const beat = (i, p) => smooth(BEATS[i], BEATS[i] + FADE, p) * (i + 1 < BEATS.length ? 1 - smooth(BEATS[i + 1] - FADE, BEATS[i + 1], p) : 1);
