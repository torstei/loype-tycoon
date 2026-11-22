import { GameMap } from "./map";
import { BUILD_COST, Flag } from "./terrain";

const ROAD_CROSSING = 2000;
const ORTHOGONAL = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAGONAL = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

export class TrackNetwork {
  private readonly tiles = new Set<number>();

  constructor(private readonly map: GameMap) {}

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
    this.tiles.add(this.map.index(x, y));
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
