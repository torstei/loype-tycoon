import { GameMap } from "./map";
import { region } from "./region";
import { hash, RGB } from "./render";
import { Flag, Terrain } from "./terrain";

/** Snow depth in cm at an elevation in metres. */
export type SnowDepth = (elevation: number) => number;

/** The ground as the map shows it: how deep the snow is, and 0–1 how far the new grass has come, by elevation. */
export interface Ground {
  depthAt: SnowDepth;
  greenAt: (elevation: number) => number;
}

/** Season day the new grass starts showing on the valley floor, and the days until it has taken over. */
const GREEN_FROM = 95;
const GREEN_DAYS = 55;
/** Days the grass comes later for every metre higher up. */
const GREEN_LAG_PER_M = 0.1;

/** How far the new grass has come on the season's `day`, by elevation: earliest low down where it is warmest. */
export function greening(day: number): (elevation: number) => number {
  return (elevation) => Math.min(1, Math.max(0, (day - GREEN_FROM - (elevation - region.climate.valley) * GREEN_LAG_PER_M) / GREEN_DAYS));
}

/** Below a tile's need, the snow goes through this many cm of grey slush before the ground shows. */
export const SLUSH = 3;

/** How much deeper than average the snow must be for each kind of ground to stay white. */
const NEED: Record<Terrain, number> = {
  [Terrain.Forest]: 2,
  [Terrain.Open]: 6,
  [Terrain.Farmland]: 8,
  [Terrain.Bog]: 4,
  [Terrain.Water]: -1000,
  [Terrain.Built]: 10,
  [Terrain.Rock]: 7,
};

/**
 * How deep the snow must be, in cm, for each tile to stay white. Open fields, towns and slopes
 * facing the sun go first; forest and slopes facing north hold on; machine-made snow on the
 * pistes lasts longest. Patches come from smoothed noise.
 */
export function meltNeed(map: GameMap): Float32Array {
  const out = new Float32Array(map.width * map.height);
  const e = (x: number, y: number) => map.elevationAt(Math.min(map.width - 1, Math.max(0, x)), Math.min(map.height - 1, Math.max(0, y)));
  const patch = (x: number, y: number) => {
    const s = 5;
    const fx = x / s;
    const fy = y / s;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const ax = fx - x0;
    const ay = fy - y0;
    const top = hash(x0, y0, 91) * (1 - ax) + hash(x0 + 1, y0, 91) * ax;
    const bottom = hash(x0, y0 + 1, 91) * (1 - ax) + hash(x0 + 1, y0 + 1, 91) * ax;
    return top * (1 - ay) + bottom * ay - 0.5;
  };
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const i = map.index(x, y);
      // Metres of drop per metre southwards: positive on slopes facing south.
      const south = (e(x, y - 1) - e(x, y + 1)) / (2 * map.tileSize);
      let need = NEED[map.terrain[i] as Terrain] + Math.max(-8, Math.min(10, south * 40)) + patch(x, y) * 10;
      if (map.flags[i] & Flag.Piste) {
        need -= 25;
      }
      out[i] = need;
    }
  }
  return out;
}

/** 1 where the snow is whole, 0 where the ground is bare, between in slush. */
export function cover(depth: number, need: number, px: number, py: number): number {
  const ragged = (hash(px >> 1, py >> 1, 93) - 0.5) * 2.5;
  return Math.min(1, Math.max(0, (depth - need + ragged) / SLUSH));
}

/**
 * What the snow looks like on the map now, keyed so the drawing can tell when it is worth drawing
 * again: "vinter" while the snow is deep enough everywhere to keep the whole map white.
 */
export function snowKey(ground: Ground, lowest: number, highest: number, deepestNeed: number): string {
  const low = ground.depthAt(lowest);
  const high = ground.depthAt(highest);
  if (Math.min(low, high) > deepestNeed + SLUSH + 2) {
    return "vinter";
  }
  const green = (e: number) => Math.round(ground.greenAt(e) * 8);
  return `${Math.round(low / 2)}:${Math.round(high / 2)}:${green(lowest)}:${green(highest)}`;
}

/** Fresh green shoots in small tufts: a share of the ground at first, all of it once `green` reaches 1. */
const sprouting = (px: number, py: number, share: number, green: number) =>
  hash(px >> 1, py >> 1, 99) < (share + (1.1 - share) * green) * (0.6 + hash(px >> 4, py >> 4, 100) * 0.8);

/** Ground where the snow has gone: last year's yellow grass with new green poking through, more of it as `green` goes from 0 to 1. */
export function bareGround(t: Terrain, px: number, py: number, shade: number, green: number): RGB {
  const k = Math.max(0.7, Math.min(1.12, shade));
  let c: RGB;
  switch (t) {
    case Terrain.Farmland:
      c = sprouting(px, py, 0.45, green) ? [134, 158, 82] : py % 5 < 2 ? [168, 152, 96] : [192, 178, 116];
      break;
    case Terrain.Open:
      c = sprouting(px, py, 0.3, green) ? [128, 152, 80] : hash(px >> 1, py >> 1, 94) < 0.3 ? [174, 160, 102] : [196, 182, 120];
      break;
    case Terrain.Bog:
      c = sprouting(px, py, 0.2, green) ? [124, 140, 76] : hash(px >> 1, py >> 1, 95) < 0.25 ? [150, 132, 86] : [178, 162, 104];
      break;
    case Terrain.Built:
      c = hash(px >> 2, py >> 2, 96) < 0.4 ? [146, 146, 138] : sprouting(px, py, 0.4, green) ? [128, 152, 84] : [180, 170, 116];
      break;
    case Terrain.Rock:
      c = hash(px >> 2, py >> 2, 97) < 0.5 ? [134, 134, 128] : [150, 146, 110];
      break;
    default:
      c = sprouting(px, py, 0.4, green) ? [84, 112, 62] : hash(px >> 1, py >> 1, 98) < 0.4 ? [112, 104, 70] : [134, 126, 84];
  }
  return [c[0] * k, c[1] * k, c[2] * k];
}

/** Grey, wet snow on its way out. */
export const SLUSH_COLOUR: RGB = [196, 200, 196];

/** The colour of a pixel given its snow colour, bare colour and how much snow is left. */
export function blend(snowy: RGB, bare: RGB, k: number): RGB {
  if (k >= 0.66) {
    return snowy;
  }
  if (k > 0.2) {
    const s = SLUSH_COLOUR;
    const f = Math.min(1, Math.max(0.6, snowy[0] / 240));
    return [s[0] * f, s[1] * f, s[2] * f];
  }
  return bare;
}
