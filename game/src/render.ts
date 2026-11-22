import { GameMap, MapLine } from "./map";
import { Flag, Terrain } from "./terrain";

export const PX = 16;

export type RGB = [number, number, number];

export function hash(x: number, y: number, salt = 0): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export const mix = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];

/** Snow is drawn in a few flat bands, cartoon style, with blue shadows. */
const SNOW_BANDS: [number, RGB][] = [
  [0.86, [178, 196, 226]],
  [0.95, [208, 221, 240]],
  [1.06, [236, 242, 250]],
  [Infinity, [253, 254, 255]],
];

function snow(shade: number): RGB {
  for (const [limit, colour] of SNOW_BANDS) {
    if (shade < limit) {
      return colour;
    }
  }
  return SNOW_BANDS[SNOW_BANDS.length - 1][1];
}

const CONTOUR_M = 20;

/** Terrain painted over the forest floor, in the same order mapgen paints it. */
export const PAINT_ORDER = [Terrain.Open, Terrain.Farmland, Terrain.Built, Terrain.Rock, Terrain.Bog, Terrain.Water];

export function renderLandscape(map: GameMap): HTMLCanvasElement {
  const W = map.width * PX;
  const H = map.height * PX;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

  const cls = smoothTerrain(map, ctx, W, H, PX);
  const shade = tileField(map, (x, y) => lightAt(map, x, y));
  const elev = tileField(map, (x, y) => map.elevationAt(x, y));

  const img = ctx.createImageData(W, H);
  const d = img.data;
  const band = new Int16Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      band[y * W + x] = Math.floor(sample(map, elev, x, y) / CONTOUR_M);
    }
  }

  const edge = (i: number, t: number, r: number) =>
    cls[i - r] !== t || cls[i + r] !== t || cls[i - r * W] !== t || cls[i + r * W] !== t;

  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const t = cls[i];
      const s = sample(map, shade, x, y);
      let c = snow(s);
      switch (t) {
        case Terrain.Water:
          if (edge(i, t, 1) || edge(i, t, 2)) {
            c = [84, 128, 180];
          } else if (edge(i, t, 3) || edge(i, t, 4)) {
            c = [236, 244, 252];
          } else if ((x * 2 - y + 400) % 41 < 2 && hash(x >> 4, y >> 4, 5) < 0.35) {
            c = [232, 244, 252];
          } else {
            c = [162, 204, 232];
          }
          break;
        case Terrain.Farmland:
          if (edge(i, t, 1)) {
            c = (x + y) % 8 < 2 ? [104, 72, 46] : [176, 138, 96];
          } else if (y % 6 === 0 && x % 5 < 2 && hash(x, y, 8) < 0.8) {
            c = [212, 196, 160];
          }
          break;
        case Terrain.Built:
          c = mix(c, 0.95);
          break;
        case Terrain.Rock:
          if (hash(x >> 2, y >> 2, 11) < 0.45) {
            c = mix([170, 176, 190], s);
          }
          break;
        case Terrain.Forest:
          c = mix(c, 0.97);
          break;
      }
      if (t !== Terrain.Water && (band[i] !== band[i + 1] || band[i] !== band[i + W])) {
        c = mix(c, 0.9);
      }
      const o = i * 4;
      d[o] = c[0];
      d[o + 1] = c[1];
      d[o + 2] = c[2];
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  drawLines(map, ctx, LINE_STYLES, PX);
  drawSprites(map, ctx, cls, W);
  return canvas;
}

/**
 * Per-pixel terrain class. Each class's tile mask is blurred and thresholded so lakes and
 * fields come out as rounded blobs instead of 25 m squares.
 */
export function smoothTerrain(map: GameMap, ctx: CanvasRenderingContext2D, W: number, H: number, px: number): Uint8Array {
  const cls = new Uint8Array(W * H).fill(Terrain.Forest);
  const small = document.createElement("canvas");
  small.width = map.width;
  small.height = map.height;
  const sctx = small.getContext("2d")!;
  for (const t of PAINT_ORDER) {
    const mask = sctx.createImageData(map.width, map.height);
    let any = false;
    for (let i = 0; i < map.terrain.length; i++) {
      if (map.terrain[i] === t) {
        mask.data[i * 4 + 3] = 255;
        any = true;
      }
    }
    if (!any) {
      continue;
    }
    sctx.putImageData(mask, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    ctx.filter = `blur(${px * 0.35}px)`;
    ctx.drawImage(small, 0, 0, W, H);
    ctx.filter = "none";
    const alpha = ctx.getImageData(0, 0, W, H).data;
    for (let i = 0; i < cls.length; i++) {
      if (alpha[i * 4 + 3] > 127) {
        cls[i] = t;
      }
    }
  }
  ctx.clearRect(0, 0, W, H);
  return cls;
}

export function lightAt(map: GameMap, x: number, y: number): number {
  const e = (dx: number, dy: number) =>
    map.elevationAt(Math.min(map.width - 1, Math.max(0, x + dx)), Math.min(map.height - 1, Math.max(0, y + dy)));
  const gx = (e(1, 0) - e(-1, 0)) / (2 * map.tileSize);
  const gy = (e(0, 1) - e(0, -1)) / (2 * map.tileSize);
  // Light from the north-west, as on Norwegian topo maps.
  return 1 - (gx + gy) * 0.9;
}

export function tileField(map: GameMap, f: (x: number, y: number) => number): Float32Array {
  const out = new Float32Array(map.width * map.height);
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      out[map.index(x, y)] = f(x, y);
    }
  }
  return out;
}

/** Bilinear sample of a per-tile field at a pixel, between tile centres. */
export function sample(map: GameMap, field: Float32Array, px: number, py: number, scale = PX): number {
  const fx = Math.min(map.width - 1.001, Math.max(0, (px + 0.5) / scale - 0.5));
  const fy = Math.min(map.height - 1.001, Math.max(0, (py + 0.5) / scale - 0.5));
  const x0 = fx | 0;
  const y0 = fy | 0;
  const ax = fx - x0;
  const ay = fy - y0;
  const i = y0 * map.width + x0;
  const top = field[i] * (1 - ax) + field[i + 1] * ax;
  const bottom = field[i + map.width] * (1 - ax) + field[i + map.width + 1] * ax;
  return top * (1 - ay) + bottom * ay;
}

export interface Stroke {
  colour: string;
  width: number;
  dash?: number[];
}

/** Each kind is stroked several times, widest first; narrower strokes over wider ones make rails and verges. */
export const LINE_STYLES: [MapLine["kind"], Stroke[]][] = [
  ["stream", [{ colour: "#8fb6da", width: 2 }]],
  ["path", [{ colour: "#b0927a", width: 1.6, dash: [1.5, 3.5] }]],
  ["forest_road", [
    { colour: "#ffffff", width: 7 },
    { colour: "#8c7456", width: 4.5 },
    { colour: "#d8c8ae", width: 3 },
  ]],
  ["road", [
    { colour: "#ffffff", width: 10 },
    { colour: "#4f535c", width: 7 },
    { colour: "#8e939d", width: 5.5 },
    { colour: "#f2d36b", width: 0.8, dash: [3, 4] },
  ]],
  ["rail", [
    { colour: "#9b968e", width: 9 },
    { colour: "#6b4a32", width: 8, dash: [2, 2.5] },
    { colour: "#2c2c33", width: 5 },
    { colour: "#9b968e", width: 2.5 },
  ]],
];

export function drawLines(map: GameMap, ctx: CanvasRenderingContext2D, styles: [MapLine["kind"], Stroke[]][], px: number) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const [kind, strokes] of styles) {
    const lines = map.lines.filter((l) => l.kind === kind);
    for (const s of strokes) {
      ctx.strokeStyle = s.colour;
      ctx.lineWidth = s.width;
      ctx.setLineDash(s.dash ?? []);
      ctx.lineCap = s.dash ? "butt" : "round";
      ctx.beginPath();
      for (const l of lines) {
        l.pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x * px, y * px) : ctx.lineTo(x * px, y * px)));
      }
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);
}

export function sprite(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  return c;
}

export function spruce(height: number, green: string): HTMLCanvasElement {
  const w = Math.ceil(height * 0.8) + 4;
  const h = Math.ceil(height) + 4;
  return sprite(w, h, (g) => {
    const cx = w / 2;
    const base = h - 2;
    g.fillStyle = "#5b3d2a";
    g.fillRect(cx - 1, base - 3, 2, 3);
    g.lineJoin = "round";
    for (let k = 2; k >= 0; k--) {
      const top = 2 + k * height * 0.24;
      const bottom = Math.min(base - 2, 2 + height * 0.45 + k * height * 0.24);
      const half = (w / 2 - 1.5) * (0.5 + 0.25 * k);
      g.beginPath();
      g.moveTo(cx, top);
      g.lineTo(cx + half, bottom);
      g.lineTo(cx - half, bottom);
      g.closePath();
      g.fillStyle = green;
      g.fill();
      g.strokeStyle = "#173a2b";
      g.lineWidth = 1;
      g.stroke();
      g.beginPath();
      g.moveTo(cx, top + 0.5);
      g.lineTo(cx - half * 0.85, bottom - 0.8);
      g.quadraticCurveTo(cx - half * 0.2, bottom - 2.5, cx + half * 0.35, bottom - (bottom - top) * 0.35);
      g.closePath();
      g.fillStyle = "#f6f9fd";
      g.fill();
    }
  });
}

export function house(wall: string): HTMLCanvasElement {
  return sprite(14, 14, (g) => {
    g.lineJoin = "round";
    g.lineWidth = 1;
    g.strokeStyle = "#3a2a26";
    g.fillStyle = wall;
    g.fillRect(2.5, 6.5, 10, 6);
    g.strokeRect(2.5, 6.5, 10, 6);
    g.fillStyle = "#ffd75e";
    g.fillRect(4, 8.5, 2, 2);
    g.fillRect(9, 8.5, 2, 2);
    g.fillStyle = "#5b4038";
    g.fillRect(10, 0, 2, 3);
    g.beginPath();
    g.moveTo(1, 7);
    g.lineTo(4, 1.5);
    g.lineTo(11, 1.5);
    g.lineTo(14, 7);
    g.closePath();
    g.fillStyle = "#fbfdff";
    g.fill();
    g.strokeStyle = "#5b6270";
    g.stroke();
    g.beginPath();
    g.moveTo(4, 1.5);
    g.lineTo(11, 1.5);
    g.strokeStyle = "#9aa3b3";
    g.stroke();
  });
}

const boulder = sprite(9, 7, (g) => {
  g.beginPath();
  g.ellipse(4.5, 4, 4, 2.8, 0, 0, Math.PI * 2);
  g.fillStyle = "#8d93a1";
  g.fill();
  g.strokeStyle = "#4d5260";
  g.stroke();
  g.beginPath();
  g.ellipse(3.8, 2.6, 2.6, 1.3, 0, 0, Math.PI * 2);
  g.fillStyle = "#f6f9fd";
  g.fill();
});

const tuft = sprite(5, 5, (g) => {
  g.strokeStyle = "#b8974e";
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(2.5, 4.5);
  g.lineTo(1, 1);
  g.moveTo(2.5, 4.5);
  g.lineTo(2.5, 0.5);
  g.moveTo(2.5, 4.5);
  g.lineTo(4, 1.5);
  g.stroke();
});

const TREES = [12, 14, 16, 18].flatMap((h) => ["#2f6a4c", "#285c43", "#356f4a"].map((c) => spruce(h, c)));
/** Where the house on a building tile stands: left edge and ground line, in pixels. */
export function housePosition(tx: number, ty: number): { x: number; y: number } {
  return { x: tx * PX + 1 + hash(tx, ty, 3) * 3, y: ty * PX + 13 + hash(tx, ty, 4) * 2 };
}

const HOUSES = ["#b8433a", "#b8433a", "#c9a045", "#eef0f0", "#8a3b34"].map(house);
const NO_TREES = Flag.Road | Flag.Rail | Flag.Building | Flag.ForestRoad;

function drawSprites(map: GameMap, ctx: CanvasRenderingContext2D, cls: Uint8Array, W: number) {
  const items: { x: number; y: number; img: HTMLCanvasElement; shadow: number }[] = [];
  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) {
      const flags = map.flags[map.index(tx, ty)];
      const t = map.terrainAt(tx, ty);
      if (flags & Flag.Building && !(flags & Flag.Road)) {
        const img = HOUSES[Math.floor(hash(tx, ty, 5) * HOUSES.length)];
        items.push({ ...housePosition(tx, ty), img, shadow: 6 });
        continue;
      }
      if (t === Terrain.Forest && !(flags & NO_TREES)) {
        const count = 2 + (hash(tx, ty, 1) < 0.5 ? 1 : 0) - (flags & Flag.Path ? 1 : 0);
        for (let k = 0; k < count; k++) {
          const x = tx * PX + 2 + hash(tx, ty, 10 + k) * 12;
          const y = ty * PX + 3 + hash(tx, ty, 20 + k) * 13;
          if (cls[(y | 0) * W + (x | 0)] !== Terrain.Forest) {
            continue;
          }
          const img = TREES[Math.floor(hash(tx, ty, 30 + k) * TREES.length)];
          items.push({ x: x - img.width / 2, y, img, shadow: img.width * 0.45 });
        }
      } else if (t === Terrain.Rock && hash(tx, ty, 40) < 0.6) {
        items.push({ x: tx * PX + 3 + hash(tx, ty, 41) * 6, y: ty * PX + 8 + hash(tx, ty, 42) * 6, img: boulder, shadow: 4 });
      } else if (t === Terrain.Bog) {
        for (let k = 0; k < 3; k++) {
          if (hash(tx, ty, 50 + k) < 0.6) {
            items.push({ x: tx * PX + hash(tx, ty, 60 + k) * 12, y: ty * PX + 4 + hash(tx, ty, 70 + k) * 12, img: tuft, shadow: 0 });
          }
        }
      }
    }
  }
  items.sort((a, b) => a.y - b.y);
  ctx.fillStyle = "rgba(60, 84, 140, 0.22)";
  for (const it of items) {
    if (it.shadow > 0) {
      ctx.beginPath();
      ctx.ellipse(it.x + it.img.width / 2 + 2.5, it.y - 1, it.shadow, it.shadow * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  for (const it of items) {
    ctx.drawImage(it.img, Math.round(it.x), Math.round(it.y - it.img.height));
  }
}
