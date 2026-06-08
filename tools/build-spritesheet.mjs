// =============================================================================
//  build-spritesheet.mjs  —  A SPRITE ATLAS, BUILT FROM SCRATCH
// =============================================================================
//
//  GOAL OF THIS FILE (read this!):
//  A "sprite" is just a 2D image of a character in one pose. An ANIMATION is a
//  sequence of those poses ("frames") shown quickly in order. Instead of saving
//  20 separate .png files, real games pack every frame into ONE image (a
//  "sprite sheet" / "texture atlas") plus a small JSON file that says where each
//  frame lives inside that image.
//
//  WHY pack them?
//    1. One network request instead of 20.
//    2. The GPU can draw many frames from a single texture in one batch (fast).
//
//  Normally you'd author this in Aseprite or pack with TexturePacker. Here we do
//  the WHOLE thing in code so you can see every step:
//    (a) allocate a raw pixel buffer (RGBA bytes),
//    (b) "draw" each pose by filling rectangles of pixels,
//    (c) encode the buffer to a real .png with the pure-JS `pngjs` library,
//    (d) emit a JSON atlas in the exact format Phaser's loader expects.
//
//  Run it with:  npm run build:sprites
// =============================================================================

import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '../assets/sprites');

// --- 1. Layout constants -----------------------------------------------------
// Every frame is a fixed CELL. The character is drawn inside one cell.
const CELL = 64;          // each frame is 64x64 pixels
const COLS = 5;           // we lay frames out in a grid, 5 per row

// --- 2. A tiny "drawing" toolkit --------------------------------------------
// A PNG pixel buffer is just a flat array of bytes: [R,G,B,A, R,G,B,A, ...]
// row by row. We write a couple of helpers so the pose code reads like drawing.

function makeCanvas(width, height) {
  // pngjs gives us `.data`, a Buffer of width*height*4 bytes, zero-filled
  // (so fully transparent black to start — alpha = 0).
  return new PNG({ width, height });
}

// Fill an axis-aligned rectangle with one RGBA color, clipped to the buffer.
function rect(png, x, y, w, h, [r, g, b, a = 255]) {
  for (let py = y; py < y + h; py++) {
    if (py < 0 || py >= png.height) continue;
    for (let px = x; px < x + w; px++) {
      if (px < 0 || px >= png.width) continue;
      const i = (png.width * py + px) << 2; // index of this pixel's R byte
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
      png.data[i + 3] = a;
    }
  }
}

// --- 3. The character "rig" --------------------------------------------------
// We keep the body NEAR-WHITE so that in the game Phaser's setTint() can recolor
// each fighter (multiply blend): white*red = red, white*blue = blue. Outlines
// stay dark. The head is a fixed skin tone.
const C = {
  body:    [235, 235, 235],   // tintable torso/limbs
  bodyDk:  [180, 180, 180],   // shading
  outline: [30, 30, 36],      // dark edges
  skin:    [240, 200, 160],   // head
  belt:    [60, 60, 70],
};

// Draw ONE fighter pose into the cell whose top-left is (ox, oy).
// `p` is a pose descriptor: offsets/sizes for the parts that move between poses.
// Everything is expressed relative to the cell so poses are easy to tweak.
function drawPose(png, ox, oy, p) {
  const cx = ox + 32;            // horizontal center of the cell
  const groundY = oy + 60;       // where the feet rest

  // ---- legs (two stances: together, or front/back split for walking/kicking)
  const legW = 7, legH = p.legH ?? 16;
  const legTop = groundY - legH;
  // back leg
  rect(png, cx - 10 + (p.backLegDx ?? 0), legTop, legW, legH, C.bodyDk);
  rect(png, cx - 10 + (p.backLegDx ?? 0), legTop, legW, legH - 1, C.bodyDk);
  // front leg — on a kick this one extends forward & up (smaller legH + dx)
  if (p.kick) {
    // extended kicking leg: a horizontal bar shooting toward the front
    rect(png, cx + 2, legTop + 2, 22, 7, C.body);
    rect(png, cx + 2, legTop + 2, 22, 1, C.outline); // top edge
  } else {
    rect(png, cx + 3 + (p.frontLegDx ?? 0), legTop, legW, legH, C.body);
  }

  // ---- torso
  const torsoTop = oy + 20 + (p.lean ?? 0);
  rect(png, cx - 9, torsoTop, 18, 22, C.body);
  rect(png, cx - 9, torsoTop, 18, 22, C.body);
  rect(png, cx - 9, torsoTop + 22 - 4, 18, 4, C.belt); // belt at waist
  rect(png, cx - 9, torsoTop, 1, 22, C.outline);       // left edge
  rect(png, cx + 8, torsoTop, 1, 22, C.outline);       // right edge

  // ---- head (skin), leans with the torso
  const headY = oy + 6 + (p.lean ?? 0);
  rect(png, cx - 6, headY, 12, 12, C.skin);
  rect(png, cx - 6, headY, 12, 1, C.outline);
  rect(png, cx - 6, headY + 11, 12, 1, C.outline);

  // ---- arms
  const shoulderY = torsoTop + 2;
  // back arm (mostly static, tucked)
  rect(png, cx - 12, shoulderY, 4, 12, C.bodyDk);
  // front arm: extends on a punch, raises on a block, hangs otherwise
  if (p.punch) {
    // extended punching arm: a horizontal bar with a "fist" at the end
    rect(png, cx + 8, shoulderY + 2, 18, 5, C.body);
    rect(png, cx + 24, shoulderY, 8, 9, C.body);          // fist
    rect(png, cx + 24, shoulderY, 8, 1, C.outline);
  } else if (p.block) {
    // both forearms raised vertically in front of the face/chest
    rect(png, cx + 4, shoulderY - 2, 6, 16, C.body);
    rect(png, cx + 4, shoulderY - 2, 6, 1, C.outline);
  } else {
    rect(png, cx + 8, shoulderY, 4, 12, C.body);          // arm at side
  }
}

// --- 4. Define the ANIMATIONS as lists of pose descriptors -------------------
// Each key becomes frames named `<key>_<index>` (e.g. punch_0..punch_4), which
// is the naming convention Phaser's generateFrameNames() will read back.
const ANIMATIONS = {
  idle:    [{}, { lean: 1 }],                                   // gentle bob
  walk:    [{ frontLegDx: 6, backLegDx: -4 },
            {},
            { frontLegDx: -4, backLegDx: 6 },
            {}],                                                // legs alternate
  punch:   [{}, { punch: true, lean: 1 }, { punch: true },
            { punch: true }, {}],                               // startup→active→recovery
  kick:    [{}, { kick: true, legH: 14 }, { kick: true, legH: 14 },
            { kick: true, legH: 14 }, {}],
  block:   [{ block: true }],
  hitstun: [{ lean: 4 }, { lean: 6 }],                          // knocked backward
  ko:      [{ lean: 10, legH: 4 }],                             // crumpled
};

// --- 5. Compose the sheet ----------------------------------------------------
// Flatten every animation into an ordered frame list, then place each frame in
// the grid and record its rectangle for the JSON atlas.
const frameList = [];
for (const [name, poses] of Object.entries(ANIMATIONS)) {
  poses.forEach((pose, i) => frameList.push({ key: `${name}_${i}`, pose }));
}

const rows = Math.ceil(frameList.length / COLS);
const sheetW = COLS * CELL;
const sheetH = rows * CELL;
const png = makeCanvas(sheetW, sheetH);

const atlasFrames = {};
frameList.forEach((f, idx) => {
  const col = idx % COLS;
  const row = Math.floor(idx / COLS);
  const x = col * CELL;
  const y = row * CELL;

  drawPose(png, x, y, f.pose);

  // This object shape is the Phaser "JSON Hash" atlas format. TexturePacker and
  // Aseprite emit the exact same structure — that's why Phaser can load all three.
  atlasFrames[f.key] = {
    frame: { x, y, w: CELL, h: CELL },
    rotated: false,
    trimmed: false,
    spriteSourceSize: { x: 0, y: 0, w: CELL, h: CELL },
    sourceSize: { w: CELL, h: CELL },
  };
});

// --- 6. Write the two output files -------------------------------------------
mkdirSync(OUT_DIR, { recursive: true });

// (a) the image: encode the raw RGBA buffer to a real PNG file.
const pngBuffer = PNG.sync.write(png);
writeFileSync(resolve(OUT_DIR, 'fighter.png'), pngBuffer);

// (b) the atlas JSON that tells Phaser where every frame is.
const atlas = {
  frames: atlasFrames,
  meta: {
    app: 'tools/build-spritesheet.mjs',
    image: 'fighter.png',
    format: 'RGBA8888',
    size: { w: sheetW, h: sheetH },
    scale: '1',
  },
};
writeFileSync(resolve(OUT_DIR, 'fighter.json'), JSON.stringify(atlas, null, 2));

console.log(
  `✔ Generated atlas: ${frameList.length} frames in a ${sheetW}x${sheetH} sheet`,
);
console.log(`  -> ${resolve(OUT_DIR, 'fighter.png')}`);
console.log(`  -> ${resolve(OUT_DIR, 'fighter.json')}`);
console.log('  frames:', frameList.map((f) => f.key).join(', '));
