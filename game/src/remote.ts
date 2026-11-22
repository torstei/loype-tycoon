import { GameMap } from "./map";
import { Flag, Terrain } from "./terrain";

/** Within this many tiles of houses, roads or the railway a place counts as not remote at all. */
const NEAR = 8;
/** From this many tiles further out it counts as fully remote (about a kilometre in total). */
const SPAN = 30;

/**
 * How remote each tile is, 0 (next to houses, roads or the railway) … 1 (deep in the forest),
 * from a breadth-first distance to the nearest sign of people.
 */
export function remoteness(map: GameMap): Float32Array {
  const n = map.width * map.height;
  const dist = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  const people = Flag.Building | Flag.Road | Flag.Rail;
  for (let i = 0; i < n; i++) {
    if (map.flags[i] & people || map.terrain[i] === Terrain.Built) {
      dist[i] = 0;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % map.width;
    const y = (i / map.width) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if ((dx || dy) && map.inside(nx, ny)) {
          const j = ny * map.width + nx;
          if (dist[j] < 0) {
            dist[j] = dist[i] + 1;
            queue[tail++] = j;
          }
        }
      }
    }
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const d = dist[i] < 0 ? NEAR + SPAN : dist[i];
    out[i] = Math.max(0, Math.min(1, (d - NEAR) / SPAN));
  }
  return out;
}
