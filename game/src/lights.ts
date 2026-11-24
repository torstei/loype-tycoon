import { Graphics } from "pixi.js";
import { GameMap } from "./map";
import { hash, housePosition, PX } from "./render";
import { Flag, Terrain } from "./terrain";

/** Street lights stand about every 50 m. */
const LAMP_SPACING = 2;
/** Most Norwegians leave the outside light on; a few do not. */
const LIT_HOUSES = 0.8;
const WARM = 0xffd98a;

const builtUp = (map: GameMap, x: number, y: number) => {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (!map.inside(tx, ty)) {
    return false;
  }
  if (map.terrainAt(tx, ty) === Terrain.Built) {
    return true;
  }
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (map.inside(tx + dx, ty + dy) && map.has(tx + dx, ty + dy, Flag.Building)) {
        return true;
      }
    }
  }
  return false;
};

/**
 * Outside lights on the houses and street lights along the main roads, and along smaller roads
 * where people live. Drawn once; fade in with the dark by setting the alpha.
 */
export function nightLights(map: GameMap): Graphics {
  const lamps: [number, number, number][] = [];
  for (const line of map.lines) {
    if (line.kind !== "road_name") {
      continue;
    }
    const main = (line.traffic ?? 1) >= 3;
    let carry = 0;
    for (let i = 1; i < line.pts.length; i++) {
      const [ax, ay] = line.pts[i - 1];
      const [bx, by] = line.pts[i];
      const len = Math.hypot(bx - ax, by - ay);
      if (len === 0) {
        continue;
      }
      const nx = -(by - ay) / len;
      const ny = (bx - ax) / len;
      for (let d = carry; d < len; d += LAMP_SPACING) {
        const x = ax + ((bx - ax) * d) / len + nx * 0.45;
        const y = ay + ((by - ay) * d) / len + ny * 0.45;
        if (main || builtUp(map, x, y)) {
          lamps.push([x * PX, y * PX, 1.4]);
        }
      }
      carry = (carry - len) % LAMP_SPACING;
      carry = carry < 0 ? carry + LAMP_SPACING : carry;
    }
  }
  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) {
      if (map.has(tx, ty, Flag.Building) && !map.has(tx, ty, Flag.Road) && hash(tx, ty, 61) < LIT_HOUSES) {
        const { x, y } = housePosition(tx, ty);
        lamps.push([x + 12, y - 4, 1]);
      }
    }
  }
  const g = new Graphics();
  for (const [r, a] of [[PX * 0.9, 0.08], [PX * 0.5, 0.12]]) {
    for (const [x, y, k] of lamps) {
      g.circle(x, y, r * k);
    }
    g.fill({ color: WARM, alpha: a });
  }
  for (const [x, y, k] of lamps) {
    g.circle(x, y, 1.2 * k);
  }
  g.fill({ color: 0xfff6d8, alpha: 0.95 });
  g.alpha = 0;
  return g;
}
