# Asset management — the "truth" folder

This `assets/src/` folder represents where you'd keep **source/authoring files** —
the editable originals. `assets/sprites/` holds the **exported** files the game
actually loads. Keeping the two separate is the single most important asset-
management habit.

```
assets/
  src/        <- editable originals (.aseprite, .kra, .psd) + these notes
  sprites/    <- EXPORTED fighter.png + fighter.json (what the game loads)
```

## How our atlas is made here

We generate it in code: `tools/build-spritesheet.mjs` → `npm run build:sprites`.
That script draws each pose as rectangles, encodes a PNG, and writes a Phaser
"JSON Hash" atlas. Read that file top-to-bottom; it is the whole lesson.

## How you'd normally make the same files

The output format (`fighter.png` + `fighter.json`) is identical no matter which
tool produces it — that's the point of a standard atlas format.

### Aseprite (the pixel-art standard, ~$20; free fork: LibreSprite)
1. Draw one tag per animation (`idle`, `walk`, `punch`, …), one frame per cell.
2. `File → Export Sprite Sheet`.
3. Set **Output → JSON Data → Hash**, check "Output File".
4. Use the *tag + frame* naming so frames come out as `punch_0`, `punch_1`, … —
   matching what `this.anims.generateFrameNames()` expects in the game.

### TexturePacker (industry standard packer)
- Drag in your individual PNG frames.
- Choose framework **Phaser (JSONHash)** as the data format.
- It will pack tightly and emit the same `.png` + `.json` pair.

## Don't want to draw? Use free art (CC0 = public domain)

The game loads these by path, so swapping art is a ~5-minute change: regenerate
or replace `fighter.png` + `fighter.json`, keep the frame names.

- **kenney.nl** — huge, genuinely CC0, game-ready packs.
- **itch.io** (filter by free / CC0) and **opengameart.org**.
- **craftpix.net** (has free section).

## Version-control convention

- **Commit** the source files (`.aseprite`) so art is reproducible.
- For large binaries, enable **git-lfs** (`git lfs track "*.png" "*.aseprite"`).
- Treat `assets/sprites/` as a build output — you can commit it for convenience,
  but it should always be regenerable from source.

## Audio follows the exact same shape

- SFX/music: load via Phaser's audio system (or **Howler.js**).
- Free sources: **freesound.org**; generate retro blips with **jsfxr**.
