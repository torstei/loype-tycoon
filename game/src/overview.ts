import { GameMap, MapLine } from "./map";
import { drawLines, hash, house, lightAt, mix, RGB, sample, smoothTerrain, spruce, Stroke, tileField } from "./render";
import { Flag, Terrain } from "./terrain";

/** Pixels per tile on the overview map: a quarter of the detail view. */
export const OVERVIEW_PX = 4;

const FILL: Record<Terrain, RGB> = {
  [Terrain.Forest]: [112, 168, 116],
  [Terrain.Open]: [248, 250, 253],
  [Terrain.Farmland]: [251, 247, 234],
  [Terrain.Bog]: [218, 226, 204],
  [Terrain.Water]: [124, 184, 228],
  [Terrain.Built]: [242, 218, 210],
  [Terrain.Rock]: [206, 208, 216],
};

const OUTLINE: Partial<Record<Terrain, RGB>> = {
  [Terrain.Forest]: [64, 116, 76],
  [Terrain.Water]: [58, 108, 168],
  [Terrain.Farmland]: [176, 140, 98],
  [Terrain.Built]: [206, 166, 154],
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

  const img = ctx.createImageData(W, H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const t = cls[i] as Terrain;
      const edge = cls[i - 1] !== t || cls[i + 1] !== t || cls[i - W] !== t || cls[i + W] !== t;
      const s = sample(map, shade, x, y, px);
      let c = edge && OUTLINE[t] ? OUTLINE[t]! : FILL[t];
      if (!edge) {
        c = mix(c, s < 0.9 ? 0.9 : s > 1.06 ? 1.04 : 1);
      }
      img.data.set([Math.min(255, c[0]), Math.min(255, c[1]), Math.min(255, c[2]), 255], i * 4);
    }
  }
  ctx.putImageData(img, 0, 0);
  drawLines(map, ctx, OVERVIEW_LINES, px);
  stampIcons(map, ctx, cls, W, H);
  return canvas;
}

function stampIcons(map: GameMap, ctx: CanvasRenderingContext2D, cls: Uint8Array, W: number, H: number) {
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
      if (clear(x, y, 5, Terrain.Forest) && hash(gx, gy, 3) < 0.55) {
        const img = trees[hash(gx, gy, 4) < 0.5 ? 0 : 1];
        icons.push({ x: x - img.width / 2, y, img, w: img.width, h: img.height });
      }
      const tx = Math.floor(x / OVERVIEW_PX);
      const ty = Math.floor(y / OVERVIEW_PX);
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
