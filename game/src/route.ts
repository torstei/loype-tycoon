const DIRS: [number, number][] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

export interface RouteGround {
  width: number;
  height: number;
  /** What laying or following track on a tile costs, or null where track cannot go. */
  step(x: number, y: number): number | null;
  /** A tile a diagonal step may not slip past at a corner: anything blocked, a road or a railway. */
  wall(x: number, y: number): boolean;
}

export interface Route {
  tiles: [number, number][];
  /** False when the route stops short of the target: the nearest point it could get to. */
  complete: boolean;
}

/** Added per 45° of turn, so routes run in straight stretches instead of zigzagging. */
const TURN_COST = 12;

/** Small binary min-heap of state indices keyed by cost. */
class Heap {
  private keys: number[] = [];
  private items: number[] = [];

  get size() {
    return this.items.length;
  }

  push(item: number, key: number) {
    this.items.push(item);
    this.keys.push(key);
    let i = this.items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) {
        break;
      }
      this.swap(i, p);
      i = p;
    }
  }

  pop(): number {
    const top = this.items[0];
    const lastItem = this.items.pop()!;
    const lastKey = this.keys.pop()!;
    if (this.items.length > 0) {
      this.items[0] = lastItem;
      this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.items.length && this.keys[l] < this.keys[m]) {
          m = l;
        }
        if (r < this.items.length && this.keys[r] < this.keys[m]) {
          m = r;
        }
        if (m === i) {
          break;
        }
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number) {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
  }
}

/**
 * The cheapest route of track from one tile to another, searched within a box around the two
 * so a detour stays a detour. If the target cannot be reached, the route goes as close as it can.
 */
export function findRoute(ground: RouteGround, from: [number, number], to: [number, number]): Route {
  const [fx, fy] = from;
  const [tx, ty] = to;
  const pad = 12 + Math.floor(Math.max(Math.abs(tx - fx), Math.abs(ty - fy)) / 2);
  const x0 = Math.max(0, Math.min(fx, tx) - pad);
  const y0 = Math.max(0, Math.min(fy, ty) - pad);
  const w = Math.min(ground.width, Math.max(fx, tx) + pad + 1) - x0;
  const h = Math.min(ground.height, Math.max(fy, ty) + pad + 1) - y0;
  const cells = w * h;
  const cost = new Float64Array(cells * 8).fill(Infinity);
  const prev = new Int32Array(cells * 8).fill(-1);
  const stepCost = new Float64Array(cells).fill(NaN);
  const stepAt = (c: number): number | null => {
    if (Number.isNaN(stepCost[c])) {
      stepCost[c] = ground.step(x0 + (c % w), y0 + Math.floor(c / w)) ?? -1;
    }
    return stepCost[c] < 0 ? null : stepCost[c];
  };
  const wallAt = (x: number, y: number) => x < x0 || y < y0 || x >= x0 + w || y >= y0 + h || ground.wall(x, y);

  const heap = new Heap();
  const start = (fy - y0) * w + (fx - x0);
  for (let d = 0; d < 8; d++) {
    cost[start * 8 + d] = 0;
    heap.push(start * 8 + d, 0);
  }
  const goal = (ty - y0) * w + (tx - x0);
  let found = -1;
  while (heap.size > 0) {
    const s = heap.pop();
    const c = s >> 3;
    const dir = s & 7;
    const here = cost[s];
    if (c === goal) {
      found = s;
      break;
    }
    const x = x0 + (c % w);
    const y = y0 + Math.floor(c / w);
    for (let d = 0; d < 8; d++) {
      const [dx, dy] = DIRS[d];
      const nx = x + dx;
      const ny = y + dy;
      if (nx < x0 || ny < y0 || nx >= x0 + w || ny >= y0 + h) {
        continue;
      }
      if (dx !== 0 && dy !== 0 && (wallAt(nx, y) || wallAt(x, ny))) {
        continue;
      }
      const n = (ny - y0) * w + (nx - x0);
      const step = stepAt(n);
      if (step === null) {
        continue;
      }
      const turn = c === start ? 0 : Math.min((d - dir + 8) % 8, (dir - d + 8) % 8);
      const next = here + step + turn * TURN_COST;
      const ns = n * 8 + d;
      if (next < cost[ns]) {
        cost[ns] = next;
        prev[ns] = s;
        heap.push(ns, next);
      }
    }
  }

  let end = found;
  if (end < 0) {
    // Unreachable: stop at the reached tile nearest the target, the cheapest way there.
    let best = Infinity;
    for (let s = 0; s < cells * 8; s++) {
      if (cost[s] === Infinity) {
        continue;
      }
      const c = s >> 3;
      const dist = Math.hypot(x0 + (c % w) - tx, y0 + Math.floor(c / w) - ty);
      const key = dist * 1e7 + cost[s];
      if (key < best) {
        best = key;
        end = s;
      }
    }
  }
  const tiles: [number, number][] = [];
  for (let s = end; s >= 0 && s >> 3 !== start; s = prev[s]) {
    const c = s >> 3;
    tiles.push([x0 + (c % w), y0 + Math.floor(c / w)]);
  }
  tiles.reverse();
  return { tiles, complete: found >= 0 };
}
