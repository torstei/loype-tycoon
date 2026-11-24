import { GameMap, MapLine } from "./map";
import { downhill, drawLines, hash, house, lightAt, mix, RGB, sample, smoothTerrain, snow, spruce, Stroke, tileField } from "./render";
import { Flag, Terrain } from "./terrain";
import { MAX_SLOPE } from "./tracks";

/** Pixels per tile on the overview map: a quarter of the detail view. */
export const OVERVIEW_PX = 4;

/** Winter colours: snow everywhere but the forest, frozen lakes. Snow-covered ground takes its colour from the light. */
const FOREST: RGB = [92, 132, 118];
const FROZEN: RGB = [204, 226, 242];
/** How each snow-covered terrain is tinted away from plain snow. */
const TINT: Partial<Record<Terrain, RGB>> = {
  [Terrain.Farmland]: [1, 0.99, 0.96],
  [Terrain.Bog]: [0.96, 0.98, 0.96],
  [Terrain.Built]: [1, 0.96, 0.95],
  [Terrain.Rock]: [0.88, 0.9, 0.95],
};

const OUTLINE: Partial<Record<Terrain, RGB>> = {
  [Terrain.Forest]: [62, 98, 88],
  [Terrain.Water]: [112, 152, 196],
  [Terrain.Farmland]: [176, 140, 98],
  [Terrain.Built]: [200, 170, 166],
};

const OVERVIEW_LINES: [MapLine["kind"], Stroke[]][] = [
  ["forest_road", [{ colour: "#a88f6c", width: 1.2 }]],
  ["road", [{ colour: "#ffffff", width: 3.5 }, { colour: "#7d828c", width: 2 }]],
  ["rail", [
    { colour: "#2c2c33", width: 3 },
    { colour: "#ffffff", width: 1.2, dash: [3, 3] },
  ]],
];

/** A board-game style map of the whole region: blobs, fat roads and big icons instead of detail. */
export function renderOverview(map: GameMap): HTMLCanvasElement {
  const px = OVERVIEW_PX;
  const W = map.width * px;
  const H = map.height * px;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  // A softer blur than the detail view: the overview wants rounded blobs, not field edges.
  const cls = smoothTerrain(map, ctx, { x: 0, y: 0, w: map.width, h: map.height }, px, px * 1.6 * 0.35);
  const shade = tileField(map, (x, y) => lightAt(map, x, y));
  const slope = tileField(map, (x, y) => (map.flags[map.index(x, y)] & (Flag.Road | Flag.ForestRoad) ? 0 : map.slopeAt(x, y)));

  const img = ctx.createImageData(W, H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const t = cls[i] as Terrain;
      const edge = cls[i - 1] !== t || cls[i + 1] !== t || cls[i - W] !== t || cls[i + W] !== t;
      const s = sample(map, shade, x, y, px);
      let c: RGB;
      if (edge && OUTLINE[t]) {
        c = OUTLINE[t]!;
      } else if (t === Terrain.Forest) {
        c = hash(x >> 1, y >> 1, 9) < 0.06 ? [214, 226, 236] : mix(FOREST, Math.max(0.7, Math.min(1.15, s)));
      } else if (t === Terrain.Water) {
        c = FROZEN;
      } else {
        const tint = TINT[t] ?? [1, 1, 1];
        const base = snow(s);
        c = [base[0] * tint[0], base[1] * tint[1], base[2] * tint[2]];
      }
      const steep = Math.min(1, Math.max(0, (sample(map, slope, x, y, px) - MAX_SLOPE + 4) / 8));
      if (steep > 0 && t !== Terrain.Water && t !== Terrain.Built) {
        const rock = mix([146, 160, 190], Math.min(1.1, s));
        const k = steep * (t === Terrain.Forest ? 0.65 : 0.5);
        c = [c[0] + (rock[0] - c[0]) * k, c[1] + (rock[1] - c[1]) * k, c[2] + (rock[2] - c[2]) * k];
      }
      img.data.set([Math.min(255, c[0]), Math.min(255, c[1]), Math.min(255, c[2]), 255], i * 4);
    }
  }
  ctx.putImageData(img, 0, 0);
  drawFallLines(map, ctx, slope, px);
  drawLines(map, ctx, OVERVIEW_LINES, px);
  stampIcons(map, ctx, cls, W, H, slope);
  return canvas;
}

/** Streaks down the fall line where the snowcat cannot go, as on the detail map but coarser. */
function drawFallLines(map: GameMap, ctx: CanvasRenderingContext2D, slope: Float32Array, px: number) {
  const gullies = new Path2D();
  const ridges = new Path2D();
  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) {
      const t = map.terrainAt(tx, ty);
      if (slope[map.index(tx, ty)] <= MAX_SLOPE || t === Terrain.Water || t === Terrain.Built) {
        continue;
      }
      const [dx, dy] = downhill(map, tx, ty);
      const len = px * (1.4 + hash(tx, ty, 86) * 0.6);
      const off = (hash(tx, ty, 84) - 0.5) * px * 0.6;
      const sx = (tx + 0.5) * px - dy * off - dx * len * 0.5;
      const sy = (ty + 0.5) * px + dx * off - dy * len * 0.5;
      gullies.moveTo(sx, sy);
      gullies.lineTo(sx + dx * len, sy + dy * len);
      ridges.moveTo(sx + dy * 1.2, sy - dx * 1.2);
      ridges.lineTo(sx + dx * len * 0.8 + dy * 1.2, sy + dy * len * 0.8 - dx * 1.2);
    }
  }
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(64, 78, 120, 0.55)";
  ctx.lineWidth = 1.1;
  ctx.stroke(gullies);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
  ctx.lineWidth = 0.8;
  ctx.stroke(ridges);
}

function stampIcons(map: GameMap, ctx: CanvasRenderingContext2D, cls: Uint8Array, W: number, H: number, slope: Float32Array) {
  const trees = [9, 11].map((h) => spruce(h, "#2f6a4c"));
  const houses = ["#b8433a", "#c9a045"].map(house);
  const icons: { x: number; y: number; img: HTMLCanvasElement; w: number; h: number }[] = [];
  const clear = (x: number, y: number, r: number, t: Terrain) => {
    for (const [dx, dy] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
      const cx = Math.round(x + dx);
      const cy = Math.round(y + dy);
      if (cx < 0 || cy < 0 || cx >= W || cy >= H || cls[cy * W + cx] !== t) {
        return false;
      }
    }
    return true;
  };
  const step = 9;
  for (let gy = 0; gy < H; gy += step) {
    for (let gx = 0; gx < W; gx += step) {
      const x = gx + hash(gx, gy, 1) * step;
      const y = gy + hash(gx, gy, 2) * step;
      const tx = Math.floor(x / OVERVIEW_PX);
      const ty = Math.floor(y / OVERVIEW_PX);
      const steep = map.inside(tx, ty) && slope[map.index(tx, ty)] > MAX_SLOPE;
      if (!steep && clear(x, y, 5, Terrain.Forest) && hash(gx, gy, 3) < 0.55) {
        const img = trees[hash(gx, gy, 4) < 0.5 ? 0 : 1];
        icons.push({ x: x - img.width / 2, y, img, w: img.width, h: img.height });
      }
      if (map.inside(tx, ty) && map.has(tx, ty, Flag.Building) && hash(gx, gy, 5) < 0.7) {
        const img = houses[hash(gx, gy, 6) < 0.6 ? 0 : 1];
        icons.push({ x: x - 5, y, img, w: 10, h: 10 });
      }
    }
  }
  icons.sort((a, b) => a.y - b.y);
  for (const it of icons) {
    ctx.drawImage(it.img, Math.round(it.x), Math.round(it.y - it.h), it.w, it.h);
  }
}
