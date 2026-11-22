import { GameMap } from "./map";
import { BUILD_COST, Flag } from "./terrain";
import { Weather } from "./weather";

/** Below this snow depth a groomer only scrapes gravel. */
export const MIN_GROOMING_DEPTH = 15;

const ROAD_CROSSING = 2000;
const ORTHOGONAL = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAGONAL = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const NEIGHBOURS = [...ORTHOGONAL, ...DIAGONAL];

export type Condition = "fresh" | "ok" | "worn" | "snowed" | "icy" | "bare";

export const CONDITION_NAMES: Record<Condition, string> = {
  fresh: "nypreppet",
  ok: "grei",
  worn: "slitt",
  snowed: "nedsnødd",
  icy: "isete",
  bare: "for lite snø",
};

export class TrackNetwork {
  private readonly tiles = new Set<number>();
  /** Per-tile state, indexed like the map. Only meaningful where there is track. */
  readonly fresh: Float32Array;
  readonly newSnow: Float32Array;
  readonly ice: Float32Array;
  readonly wet: Float32Array;
  readonly groomedAt: Float64Array;

  constructor(private readonly map: GameMap) {
    const n = map.width * map.height;
    this.fresh = new Float32Array(n);
    this.newSnow = new Float32Array(n);
    this.ice = new Float32Array(n);
    this.wet = new Float32Array(n);
    this.groomedAt = new Float64Array(n).fill(-Infinity);
  }

  has(x: number, y: number): boolean {
    return this.map.inside(x, y) && this.tiles.has(this.map.index(x, y));
  }

  /** Price of a new track tile, or null where track cannot go. */
  cost(x: number, y: number): number | null {
    if (!this.map.inside(x, y) || this.map.has(x, y, Flag.Rail) || this.map.has(x, y, Flag.Building)) {
      return null;
    }
    const base = BUILD_COST[this.map.terrainAt(x, y)];
    if (base === null) {
      return null;
    }
    const slope = this.map.slopeAt(x, y);
    if (slope > 40) {
      return null;
    }
    const roads = this.map.has(x, y, Flag.Road) ? ROAD_CROSSING : 0;
    return Math.round(base * (1 + slope / 8) + roads);
  }

  add(x: number, y: number) {
    const i = this.map.index(x, y);
    this.tiles.add(i);
    // A new track is just a line of footprints until a groomer has been along.
    this.fresh[i] = 0.35;
    this.newSnow[i] = 0;
    this.ice[i] = 0;
    this.wet[i] = 0;
    this.groomedAt[i] = -Infinity;
  }

  neighbours(x: number, y: number): [number, number][] {
    return NEIGHBOURS.map(([dx, dy]) => [x + dx, y + dy] as [number, number]).filter(([nx, ny]) => this.has(nx, ny));
  }

  /** 0 (unskiable) … 1 (perfect corduroy). */
  quality(x: number, y: number, weather: Weather): number {
    const i = this.map.index(x, y);
    const depth = weather.snowDepthAt(this.map.elevationAt(x, y));
    const snowFactor = Math.min(1, depth / MIN_GROOMING_DEPTH);
    const buried = 1 - Math.min(1, this.newSnow[i] / 10);
    return this.fresh[i] * buried * (1 - 0.6 * this.ice[i]) * snowFactor;
  }

  condition(x: number, y: number, weather: Weather): Condition {
    const i = this.map.index(x, y);
    if (weather.snowDepthAt(this.map.elevationAt(x, y)) < MIN_GROOMING_DEPTH * 0.6) {
      return "bare";
    }
    if (this.newSnow[i] >= 4) {
      return "snowed";
    }
    if (this.ice[i] >= 0.5) {
      return "icy";
    }
    const q = this.quality(x, y, weather);
    return q > 0.75 ? "fresh" : q > 0.45 ? "ok" : "worn";
  }

  /** Whether a groomer would make a noticeable difference here. */
  needsGrooming(x: number, y: number, weather: Weather): boolean {
    const i = this.map.index(x, y);
    const depth = weather.snowDepthAt(this.map.elevationAt(x, y));
    return depth >= MIN_GROOMING_DEPTH && (this.newSnow[i] >= 3 || this.ice[i] >= 0.4 || this.fresh[i] < 0.7);
  }

  groom(x: number, y: number, weather: Weather, now: number) {
    const i = this.map.index(x, y);
    const depth = weather.snowDepthAt(this.map.elevationAt(x, y));
    this.fresh[i] = depth >= MIN_GROOMING_DEPTH ? 1 : Math.max(this.fresh[i], depth / MIN_GROOMING_DEPTH * 0.5);
    this.newSnow[i] = 0;
    this.ice[i] *= 0.3;
    this.wet[i] *= 0.5;
    this.groomedAt[i] = now;
  }

  /** Let the weather work on every track tile. snow is cm, rain mm, both at the reference elevation. */
  applyWeather(hours: number, weather: Weather, snow: number, rain: number) {
    for (const i of this.tiles) {
      const elevation = this.map.elevation[i];
      const t = weather.localTemperature(elevation);
      const snowHere = t < 0.8 ? snow : 0;
      const rainHere = t < 0.8 ? 0 : rain;
      this.newSnow[i] += snowHere;
      this.fresh[i] = Math.max(0, this.fresh[i] - hours * 0.006 - weather.wind * hours * 0.0008);
      if (t > 0) {
        this.fresh[i] = Math.max(0, this.fresh[i] - hours * 0.015 * t);
        this.wet[i] = Math.min(1, this.wet[i] + hours * 0.03 * t);
        this.newSnow[i] = Math.max(0, this.newSnow[i] - hours * 0.2 * t);
      }
      if (rainHere > 0) {
        this.fresh[i] = Math.max(0, this.fresh[i] - rainHere * 0.04);
        this.wet[i] = Math.min(1, this.wet[i] + rainHere * 0.15);
      }
      if (t < -1 && this.wet[i] > 0) {
        const freeze = Math.min(this.wet[i], hours * 0.1);
        this.wet[i] -= freeze;
        this.ice[i] = Math.min(1, this.ice[i] + freeze * 0.9);
      }
    }
  }

  remove(x: number, y: number) {
    this.tiles.delete(this.map.index(x, y));
  }

  get size(): number {
    return this.tiles.size;
  }

  /** A tile whose only links are two perpendicular straight neighbours: drawn as a diagonal shortcut. */
  private isCorner(x: number, y: number): boolean {
    const straight = ORTHOGONAL.filter(([dx, dy]) => this.has(x + dx, y + dy));
    const diagonal = DIAGONAL.some(([dx, dy]) => this.has(x + dx, y + dy));
    return (
      straight.length === 2 &&
      !diagonal &&
      straight[0][0] * straight[1][0] + straight[0][1] * straight[1][1] === 0
    );
  }

  /** Line segments between tile centres, in tile units, with staircase corners cut. */
  segments(): { lines: [number, number, number, number][]; dots: [number, number][] } {
    const lines: [number, number, number, number][] = [];
    const dots: [number, number][] = [];
    for (const [x, y] of this.each()) {
      const corner = this.isCorner(x, y);
      let linked = corner;
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
        if (!this.has(x + dx, y + dy)) {
          continue;
        }
        const diagonal = dx !== 0 && dy !== 0;
        const draw = diagonal
          ? [[x + dx, y], [x, y + dy]].every(([cx, cy]) => !this.has(cx, cy) || this.isCorner(cx, cy))
          : !corner && !this.isCorner(x + dx, y + dy);
        if (draw) {
          lines.push([x + 0.5, y + 0.5, x + dx + 0.5, y + dy + 0.5]);
          linked = true;
        }
      }
      if (!linked) {
        dots.push([x + 0.5, y + 0.5]);
      }
    }
    return { lines, dots };
  }

  *each(): Generator<[number, number]> {
    for (const i of this.tiles) {
      yield [i % this.map.width, Math.floor(i / this.map.width)];
    }
  }
}

/** Tiles on the line between two tiles, so a fast drag leaves no gaps. */
export function* lineTiles(x0: number, y0: number, x1: number, y1: number): Generator<[number, number]> {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    yield [x0, y0];
    if (x0 === x1 && y0 === y1) {
      return;
    }
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}
