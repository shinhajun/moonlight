// The landing hero's scroll story, shared by the page (copy, caption) and the 3D scene (turn, layers, VRAM).
// Every beat is a window of hero progress 0..1; scrolling back plays it in reverse.

export const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// The side copy steps aside first so the card owns the screen.
export const COPY = [0.03, 0.16];
// The card turns from about 15° to 60° of yaw while it opens.
export const TURN = [0.04, 0.8];
// Layers leave in order; the PCB stays put. The rest of the scroll holds the opened card.
export const LAYERS = {
  fans: [0.08, 0.3],
  shroud: [0.18, 0.4],
  sink: [0.3, 0.52],
  back: [0.56, 0.74],
  bracket: [0.6, 0.78],
};
// VRAM chips light one by one, after the heatsink has cleared them.
export const CHIPS = [0.46, 0.7];
export const CAPTION = [0.5, 0.58];

export const copyOut = (p) => smooth(COPY[0], COPY[1], p);
export const chipsLit = (p) => smooth(CHIPS[0], CHIPS[1], p);
export const caption = (p) => smooth(CAPTION[0], CAPTION[1], p) * (1 - smooth(0.93, 0.99, p));
