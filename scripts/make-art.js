// ---------------------------------------------------------------------------
// make-art.js — generates every piece of pixel art the site uses.
//
//   npm run art                  → writes PNGs into src/assets/img/
//   npm run art -- --preview DIR → also writes big zoomed-in copies into DIR
//                                  so you can inspect the pixels easily.
//
// There are no dependencies: the script paints pixels into a buffer and
// encodes the PNG file format by hand (using Node's built-in zlib for the
// compression step). If you want to tweak the art, everything is either a
// little ASCII drawing (the sprites) or a list of paint calls (the big
// background scene) — change it and re-run `npm run art`.
// ---------------------------------------------------------------------------

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "src/assets/img");

// --- PNG encoding ----------------------------------------------------------
// A PNG file is a signature followed by "chunks". We only need three chunks:
// IHDR (size/format), IDAT (the compressed pixel rows) and IEND (the end).

function crc32(buf) {
  // Standard CRC-32 checksum, required at the end of every PNG chunk.
  if (!crc32.table) {
    crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crc32.table[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crc32.table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // 8 bits per channel
  ihdr[9] = 6;  // colour type 6 = RGBA
  // Each pixel row is prefixed with a "filter type" byte; 0 = no filtering.
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // signature
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- A tiny canvas to paint on ----------------------------------------------

function hex(color) {
  // "#rrggbb" or "#rrggbbaa" → [r, g, b, a]
  const n = color.replace("#", "");
  return [
    parseInt(n.slice(0, 2), 16),
    parseInt(n.slice(2, 4), 16),
    parseInt(n.slice(4, 6), 16),
    n.length === 8 ? parseInt(n.slice(6, 8), 16) : 255,
  ];
}

class Canvas {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.data = Buffer.alloc(w * h * 4); // starts fully transparent
  }
  px(x, y, color) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const [r, g, b, a] = Array.isArray(color) ? color : hex(color);
    const i = (y * this.w + x) * 4;
    if (a === 255) {
      this.data[i] = r; this.data[i + 1] = g; this.data[i + 2] = b; this.data[i + 3] = 255;
    } else if (a > 0) {
      // Blend the new colour over whatever is already there.
      const t = a / 255;
      this.data[i] = Math.round(r * t + this.data[i] * (1 - t));
      this.data[i + 1] = Math.round(g * t + this.data[i + 1] * (1 - t));
      this.data[i + 2] = Math.round(b * t + this.data[i + 2] * (1 - t));
      this.data[i + 3] = Math.max(this.data[i + 3], a);
    }
  }
  rect(x, y, w, h, color) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, color);
  }
  outline(x, y, w, h, color) {
    this.rect(x, y, w, 1, color);
    this.rect(x, y + h - 1, w, 1, color);
    this.rect(x, y, 1, h, color);
    this.rect(x + w - 1, y, 1, h, color);
  }
  disc(cx, cy, r, color) {
    for (let y = -r; y <= r; y++)
      for (let x = -r; x <= r; x++)
        if (x * x + y * y <= r * r + r * 0.6) this.px(cx + x, cy + y, color);
  }
  // Copy another canvas onto this one (transparent pixels are skipped).
  stamp(spriteCanvas, x, y) {
    for (let j = 0; j < spriteCanvas.h; j++)
      for (let i = 0; i < spriteCanvas.w; i++) {
        const k = (j * spriteCanvas.w + i) * 4;
        const a = spriteCanvas.data[k + 3];
        if (a > 0)
          this.px(x + i, y + j, [
            spriteCanvas.data[k], spriteCanvas.data[k + 1], spriteCanvas.data[k + 2], a,
          ]);
      }
  }
  scaled(s) {
    const out = new Canvas(this.w * s, this.h * s);
    for (let y = 0; y < out.h; y++)
      for (let x = 0; x < out.w; x++) {
        const k = ((y / s | 0) * this.w + (x / s | 0)) * 4;
        const o = (y * out.w + x) * 4;
        this.data.copy(out.data, o, k, k + 4);
      }
    return out;
  }
  save(name) {
    writeFileSync(join(OUT_DIR, name), encodePng(this.w, this.h, this.data));
  }
}

// Deterministic "random" so the art comes out identical on every run.
function makeRandom(seed) {
  let s = seed;
  return () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Build a sprite from an ASCII drawing. Each character is one pixel;
// "." (or space) is transparent, everything else looks up the palette.
function sprite(text, palette) {
  const rows = text.split("\n").filter((r) => r.trim().length);
  const c = new Canvas(Math.max(...rows.map((r) => r.length)), rows.length);
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch !== "." && ch !== " ") c.px(x, y, palette[ch]);
    });
  });
  return c;
}

// --- The shared palette ------------------------------------------------------

const P = {
  outline: "#211a13",
  woodDark: "#4a3524", wood: "#61462e", woodLight: "#7a593a", woodHi: "#8f6b46",
  wall: "#453a2f", wallDark: "#3d332a", wallLight: "#4f4335",
  cork: "#a3805a", corkDark: "#8b6c4b",
  navy: "#252c42", navyDark: "#191f30", navyDeep: "#12172a",
  moon: "#e9dfbe", moonShade: "#cfc39d",
  star: "#d8d2b8",
  brass: "#c2984c", brassHi: "#e5c47c", brassDark: "#94713a",
  paper: "#efe4c9", paperShade: "#d6c7a5",
  cream: "#f5ecd7",
  green: "#5c7a52", greenDark: "#41573a",
  burg: "#8a4038", burgDark: "#66302b",
  red: "#a04a40",
  glow: "#ffd98a",
  grey: "#6f6a62", greyLight: "#8b857a",
  catFur: "#c98d4c", catDark: "#a06c34", catHi: "#e0ab6b",
};

// --- Sprites -----------------------------------------------------------------

// The owl librarian. o = outline, d = dark feathers, b = body brown,
// c = cream belly, v = belly chevron, g = glasses, w = eye white,
// e = pupil, y = beak & feet, h = highlight.
const owlPalette = {
  o: P.outline, d: "#5d452c", b: "#7d5f3a", h: "#96774c",
  c: "#e8d9b4", v: "#c9b488", g: "#3a2f22",
  w: "#f4efdf", e: "#211a13", y: "#d1a13f",
};
const OWL = sprite(`
..oo............oo..
.oddo..........oddo.
.odddoooooooooodddo.
.oddbbbbbbbbbbbbddo.
odbbbbbbbbbbbbbbbbdo
obbgggggggbbgggggggbo
obgwwwwwgbbgwwwwwgbo
obgwweewgbbgwweewgbo
obgwweewgggwweewwgo.
obbgggggyyggggggbbo.
odbbbbbbyybbbbbbbdo.
odbbbccccccccbbbbdo.
odbbccvccccvccbbbdo.
odbbcccvccvcccbbbdo.
odbbccvccccvccbbbdo.
odbbcccvccvcccbbbdo.
odbbccccccccccbbbdo.
.odbbcccccccccbbdo..
.oddbbccccccbbbddo..
..oddbbbbbbbbbddo...
...ooodbbbbbbdoo....
......oyyooyyo......
......oyyooyyo......
.......oo..oo.......
`, owlPalette);

// A sleeping cat loaf: ears and closed eyes on the left, tail curled
// around the front. f = fur, s = shading, i = highlight, p = inner ear,
// z = closed eye, t = tail.
const catPalette = {
  o: P.outline, f: P.catFur, s: P.catDark, i: P.catHi,
  p: "#b0605a", z: "#4a3010", t: "#a06c34",
};
const CAT = sprite(`
....oo...oo..........
...opso.ospo.........
...osfffffso.........
..offiffffffooooo....
..offiffffffffffoo...
.offzffzffffffffffo..
.offffffffffffffffo..
.offffffffffffffffo..
.osffffffffffffffso..
.ossffffffffffffsso..
..oosttttttttttsoo...
....ottttttttttto....
.....ooooooooooo.....
`, catPalette);

// A steaming mug. m = mug, r = rim highlight, k = coffee.
const MUG = sprite(`
..ooooooooo...
.omrrrrrrmo...
.omkkkkkkmooo.
.ommmmmmmmo.oo
.ommmmmmmmo..o
.ommmmmmmmo.oo
.ommmmmmmmooo.
..ommmmmmo....
...oooooo.....
`, { o: P.outline, m: P.burg, r: "#a95a50", k: "#3a2a1c" });

// A pencil, lying flat. y = body, f = ferrule, e = eraser, w = wood, l = lead.
const PENCIL = sprite(`
.oooooooooooooooooooooo....
oeeffyyyyyyyyyyyyyyyyyowo..
oeeffyyyyyyyyyyyyyyyyyowwol
oeeffhhhhhhhhhhhhhhhhhowo..
.oooooooooooooooooooooo....
`, { o: P.outline, y: "#d1a13f", h: "#b5872f", f: P.grey, e: P.burg, w: "#e0c493", l: P.outline });

// --- Little scene props (built with paint calls, stamped into the scene) -----

function makeBook(w, h, color, spineColor) {
  const c = new Canvas(w, h);
  c.rect(0, 0, w, h, P.outline);
  c.rect(1, 1, w - 2, h - 2, color);
  if (w >= 4) c.rect(1, 1, 1, h - 2, spineColor); // lit edge
  if (h >= 10) { c.rect(1, 2, w - 2, 1, spineColor); c.rect(1, h - 4, w - 2, 1, spineColor); }
  return c;
}

function makePottedPlant() {
  const c = new Canvas(12, 14);
  // pot
  c.rect(2, 9, 8, 5, P.outline);
  c.rect(3, 10, 6, 4, "#8a5a34");
  c.rect(3, 10, 6, 1, "#a37244");
  // leaves
  const leaf = (x, y) => { c.disc(x, y, 2, P.greenDark); c.px(x, y - 1, P.green); c.px(x - 1, y, P.green); };
  leaf(3, 6); leaf(8, 5); leaf(6, 3); leaf(5, 7);
  c.rect(5, 6, 1, 4, P.greenDark);
  return c;
}

// A small pinned note with a crossword grid doodled on it.
function makePinnedGrid(size, seed) {
  const rnd = makeRandom(seed);
  const cells = 5, cell = 3, pad = 2;
  const w = cells * cell + pad * 2 + 1;
  const c = new Canvas(w, w + 2);
  c.rect(0, 2, w, w, P.paperShade);       // paper shadow edge
  c.rect(0, 1, w - 1, w, P.paper);
  c.outline(0, 1, w - 1, w, "#b3a37e");
  for (let gy = 0; gy < cells; gy++)
    for (let gx = 0; gx < cells; gx++) {
      const x = pad + gx * cell, y = 1 + pad + gy * cell;
      c.outline(x, y, cell + 1, cell + 1, "#8d7f60");
      if (rnd() < 0.28) c.rect(x + 1, y + 1, cell - 1, cell - 1, "#2c2620");
    }
  // pushpin
  c.px(Math.floor(w / 2), 0, P.outline);
  c.px(Math.floor(w / 2) - 1, 0, P.red);
  return c;
}

// --- The background scene: a constructor's study at night --------------------

function makeScene() {
  const W = 512, H = 288;
  const c = new Canvas(W, H);
  const rnd = makeRandom(20260704);

  // Wall with subtle vertical striping, darker near the top.
  c.rect(0, 0, W, H, P.wall);
  for (let x = 0; x < W; x += 24) c.rect(x, 0, 1, H, P.wallDark);
  for (let x = 12; x < W; x += 24) c.rect(x, 0, 1, H, P.wallLight);
  c.rect(0, 0, W, 10, P.navyDeep);            // ceiling shadow
  c.rect(0, 10, W, 2, P.woodDark);            // picture rail
  c.rect(0, 12, W, 1, P.outline);

  // Wainscot panelling behind the desk.
  c.rect(0, 168, W, 4, P.woodLight);
  c.rect(0, 171, W, 1, P.outline);
  c.rect(0, 172, W, 42, P.wood);
  for (let x = 0; x < W; x += 26) c.rect(x, 172, 1, 42, P.woodDark);

  // ---- Corkboard (centre) — the site itself hangs on this ----
  const bx = 104, by = 22, bw = 300, bh = 178;
  c.rect(bx - 5, by - 5, bw + 10, bh + 10, P.outline);
  c.rect(bx - 4, by - 4, bw + 8, bh + 8, P.woodLight);
  c.rect(bx - 4, by - 4, bw + 8, 2, P.woodHi);
  c.rect(bx - 1, by - 1, bw + 2, bh + 2, P.outline);
  c.rect(bx, by, bw, bh, P.cork);
  for (let i = 0; i < 900; i++) c.px(bx + rnd() * bw, by + rnd() * bh, i % 2 ? P.corkDark : "#b08a61");
  // Pinned crossword scraps around the edges (the middle is covered by the page).
  c.stamp(makePinnedGrid(5, 1), bx + 6, by + 8);
  c.stamp(makePinnedGrid(5, 2), bx + 10, by + 132);
  c.stamp(makePinnedGrid(5, 3), bx + bw - 26, by + 12);
  c.stamp(makePinnedGrid(5, 4), bx + bw - 30, by + 128);
  c.stamp(makePinnedGrid(5, 5), bx + 34, by + 60);
  c.stamp(makePinnedGrid(5, 6), bx + bw - 54, by + 66);

  // ---- Bookcase (left) ----
  const kx = 8, ky = 30, kw = 82, kh = 184; // stands down to the desk
  c.rect(kx - 2, ky - 2, kw + 4, kh + 4, P.outline);
  c.rect(kx, ky, kw, kh, P.woodDark);
  c.outline(kx, ky, kw, kh, P.wood);
  const shelves = [ky + 40, ky + 82, ky + 124, ky + 166];
  for (const sy of shelves) { c.rect(kx, sy, kw, 4, P.woodLight); c.rect(kx, sy + 3, kw, 1, P.outline); }
  // Books: rows of spines with varied heights and colours.
  const bookColors = [
    [P.burg, "#a95a50"], [P.green, "#75935f"], [P.navy, "#39415e"],
    ["#8a5a34", "#a37244"], [P.brassDark, P.brass], ["#5d4a6b", "#786293"],
  ];
  const shelfTops = [ky + 4, ky + 44, ky + 86, ky + 128];
  shelfTops.forEach((topY, si) => {
    const bottom = shelves[si];
    let x = kx + 3;
    while (x < kx + kw - 6) {
      const w = 4 + Math.floor(rnd() * 3);
      const h = 24 + Math.floor(rnd() * 10);
      const [col, hi] = bookColors[Math.floor(rnd() * bookColors.length)];
      if (rnd() < 0.12) { // an occasional flat stack instead of upright spines
        for (let s = 0; s < 3; s++) c.stamp(makeBook(14, 5, bookColors[Math.floor(rnd() * 6)][0], "#00000000"), x, bottom - 5 * (s + 1));
        x += 16;
      } else {
        c.stamp(makeBook(w, Math.min(h, bottom - topY - 2), col, hi), x, bottom - Math.min(h, bottom - topY - 2));
        x += w + (rnd() < 0.15 ? 2 : 0);
      }
    }
  });
  // The cat sleeps on top of the bookcase.
  c.stamp(CAT, kx + kw - CAT.w - 4, ky - CAT.h + 2);
  // A little plant beside it.
  c.stamp(makePottedPlant(), kx + 4, ky - 12);

  // ---- Window (right) ----
  const wx = 424, wy = 26, ww = 74, wh = 118;
  c.rect(wx - 6, wy - 6, ww + 12, wh + 12, P.outline);
  c.rect(wx - 5, wy - 5, ww + 10, wh + 10, P.woodLight);
  c.rect(wx - 5, wy - 5, ww + 10, 2, P.woodHi);
  c.rect(wx - 1, wy - 1, ww + 2, wh + 2, P.outline);
  // night sky, darker towards the top
  for (let y = 0; y < wh; y++) {
    const t = y / wh;
    c.rect(wx, wy + y, ww, 1, t < 0.35 ? P.navyDeep : t < 0.7 ? P.navyDark : P.navy);
  }
  for (let i = 0; i < 26; i++) {
    const sx = wx + 2 + rnd() * (ww - 4), sy = wy + 2 + rnd() * (wh * 0.75);
    c.px(sx, sy, i % 3 ? P.star : "#f2eccd");
  }
  // moon with a couple of craters
  c.disc(wx + 52, wy + 26, 9, P.moon);
  c.disc(wx + 49, wy + 24, 2, P.moonShade);
  c.disc(wx + 56, wy + 30, 1, P.moonShade);
  // rooftops silhouette at the bottom of the view
  c.rect(wx, wy + wh - 16, 22, 16, P.navyDeep);
  c.rect(wx + 30, wy + wh - 10, 26, 10, P.navyDeep);
  c.rect(wx + 8, wy + wh - 22, 8, 6, P.navyDeep);
  c.px(wx + 12, wy + wh - 13, P.glow); // one lit window far away
  c.px(wx + 38, wy + wh - 6, P.glow);
  // window cross bars
  c.rect(wx, wy + Math.floor(wh / 2) - 1, ww, 3, P.woodLight);
  c.rect(wx + Math.floor(ww / 2) - 1, wy, 3, wh, P.woodLight);
  // curtains
  c.rect(wx - 12, wy - 8, 8, wh + 20, P.burgDark);
  c.rect(wx - 10, wy - 8, 2, wh + 20, P.burg);
  c.rect(wx + ww + 4, wy - 8, 8, wh + 20, P.burgDark);
  c.rect(wx + ww + 6, wy - 8, 2, wh + 20, P.burg);
  c.rect(wx - 14, wy - 10, ww + 28, 3, P.woodDark); // rod
  c.rect(wx - 14, wy - 10, ww + 28, 1, P.outline);

  // ---- Desk (full width, bottom) ----
  c.rect(0, 214, W, 3, P.woodHi);
  c.rect(0, 213, W, 1, P.outline);
  c.rect(0, 217, W, 6, P.woodLight);
  c.rect(0, 223, W, 1, P.outline);
  c.rect(0, 224, W, H - 224, P.wood);
  for (let x = 0; x < W; x += 40) c.rect(x, 224, 1, H - 224, P.woodDark); // plank seams
  for (let y = 234; y < H; y += 18) c.rect(0, y, W, 1, "#55401f44");      // faint grain
  // drawers with brass handles
  for (const dx of [30, 380]) {
    c.outline(dx, 232, 104, 34, P.outline);
    c.rect(dx + 1, 233, 102, 32, P.woodLight);
    c.outline(dx + 4, 236, 96, 26, P.woodDark);
    c.rect(dx + 42, 246, 20, 5, P.outline);
    c.rect(dx + 43, 247, 18, 3, P.brass);
    c.px(dx + 44, 247, P.brassHi);
  }

  // ---- Banker's lamp (right, standing on the desk) ----
  const lx = 452;
  // glow cone first, so the lamp is drawn crisply on top of it
  for (let y = 188; y < 214; y++) {
    const spread = 8 + Math.floor((y - 188) * 0.7);
    const fade = Math.round(52 - (y - 188) * 1.2);
    c.rect(lx - spread, y, spread * 2, 1, P.glow + fade.toString(16).padStart(2, "0"));
  }
  c.disc(lx, 214, 24, P.glow + "1e"); // warm pool on the desk
  c.rect(lx - 1, 188, 3, 20, P.brassDark); // stem
  c.rect(lx - 1, 188, 1, 20, P.brassHi);
  c.rect(lx - 9, 208, 19, 5, P.outline); // base
  c.rect(lx - 7, 209, 15, 3, P.brass);
  c.rect(lx - 7, 209, 15, 1, P.brassHi);
  // green shade, narrow on top and flared at the bottom
  c.outline(lx - 14, 178, 29, 11, P.outline);
  c.rect(lx - 13, 179, 27, 9, P.green);
  c.rect(lx - 13, 179, 27, 2, "#75935f");
  c.rect(lx - 10, 177, 21, 2, P.outline);
  c.rect(lx - 9, 178, 19, 1, P.green);
  c.rect(lx - 11, 188, 23, 1, P.glow); // lit rim under the shade

  // ---- Small desk props ----
  c.stamp(MUG, 486, 205); // sits on the desk, next to the lamp's glow
  // steam
  c.px(492, 200, "#e8dfbe88"); c.px(493, 197, "#e8dfbe66"); c.px(491, 194, "#e8dfbe44");
  // pencil pot under the window
  c.rect(424, 195, 12, 19, P.outline);
  c.rect(425, 196, 10, 17, P.navy);
  c.rect(425, 196, 2, 17, "#39415e");
  c.rect(427, 187, 2, 9, "#d1a13f"); c.px(427, 185, P.outline); c.px(428, 186, "#e0c493");
  c.rect(431, 189, 2, 7, P.burg); c.px(431, 187, P.outline);
  // a stack of books at the far left of the desk, under the bookcase's shadow
  c.stamp(makeBook(30, 7, P.navy, "#39415e"), 96, 207);
  c.stamp(makeBook(26, 7, P.burg, "#a95a50"), 99, 200);
  c.stamp(makeBook(22, 6, P.green, "#75935f"), 101, 194);

  // ---- Vignette: gently darken the edges so the page glows in the middle ----
  for (let x = 0; x < 70; x++) {
    const a = Math.round(64 * (1 - x / 70));
    c.rect(x, 0, 1, H, "#0c0a12" + a.toString(16).padStart(2, "0"));
    c.rect(W - 1 - x, 0, 1, H, "#0c0a12" + a.toString(16).padStart(2, "0"));
  }
  for (let y = 0; y < 40; y++) {
    const a = Math.round(52 * (1 - y / 40));
    c.rect(0, y, W, 1, "#0c0a12" + a.toString(16).padStart(2, "0"));
  }
  for (let y = 0; y < 30; y++) {
    const a = Math.round(40 * (1 - y / 30));
    c.rect(0, H - 1 - y, W, 1, "#0c0a12" + a.toString(16).padStart(2, "0"));
  }

  return c;
}

// --- Paper texture for the page background ----------------------------------

function makePaperTexture() {
  const c = new Canvas(128, 128);
  const rnd = makeRandom(7);
  c.rect(0, 0, 128, 128, P.cream);
  for (let i = 0; i < 340; i++) {
    c.px(rnd() * 128, rnd() * 128, rnd() < 0.5 ? "#d6c7a540" : "#ffffff50");
  }
  for (let i = 0; i < 40; i++) {
    const x = rnd() * 128, y = rnd() * 128;
    c.px(x, y, "#c9b88f30"); c.px(x + 1, y, "#c9b88f24");
  }
  return c;
}

// --- Write everything --------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true });

const art = {
  "bg-study.png": makeScene(),
  "owl.png": OWL,
  "cat.png": CAT,
  "mug.png": MUG,
  "pencil.png": PENCIL,
  "paper.png": makePaperTexture(),
};

for (const [name, canvas] of Object.entries(art)) {
  canvas.save(name);
  console.log(`wrote src/assets/img/${name} (${canvas.w}×${canvas.h})`);
}

// Optional zoomed-in previews: npm run art -- --preview /some/dir
const flag = process.argv.indexOf("--preview");
if (flag !== -1 && process.argv[flag + 1]) {
  const dir = process.argv[flag + 1];
  mkdirSync(dir, { recursive: true });
  for (const [name, canvas] of Object.entries(art)) {
    const scale = canvas.w > 200 ? 2 : 8;
    writeFileSync(join(dir, name), encodePng(canvas.w * scale, canvas.h * scale, canvas.scaled(scale).data));
  }
  console.log(`previews written to ${dir}`);
}
