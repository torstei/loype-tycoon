import { Graphics } from "pixi.js";
import { GameMap } from "./map";
import { hash, housePosition, PX } from "./render";
import { Flag, Terrain } from "./terrain";

/** Tiles between street lights: every 50 m on the main roads, sparser on village roads. */
const LAMP_SPACING = [6, 6, 4, 2];
/** Most Norwegians leave the outside light on; a few do not. */
const LIT_HOUSES = 0.8;
const WARM = 0xffd98a;

const builtUp = (map: GameMap, x: number, y: number) => {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (!map.inside(tx, ty) || map.terrainAt(tx, ty) !== Terrain.Built) {
    return false;
  }
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (map.inside(tx + dx, ty + dy) && map.has(tx + dx, ty + dy, Flag.Building)) {
        return true;
      }
    }
  }
  return false;
};

/** Street lamps in tile units: every 50 m on the main roads, sparser through built-up areas. */
export function streetLamps(map: GameMap): { x: number; y: number; nx: number; ny: number; main: boolean }[] {
  const out: { x: number; y: number; nx: number; ny: number; main: boolean }[] = [];
  for (const line of map.lines) {
    if (line.kind !== "road_name") {
      continue;
    }
    const traffic = line.traffic ?? 1;
    const main = traffic >= 3;
    const spacing = LAMP_SPACING[traffic];
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
      for (let d = carry; d < len; d += spacing) {
        const x = ax + ((bx - ax) * d) / len;
        const y = ay + ((by - ay) * d) / len;
        if (main) {
          out.push({ x: x + nx * 0.3, y: y + ny * 0.3, nx, ny, main });
        } else if (builtUp(map, x + nx * 0.45, y + ny * 0.45)) {
          out.push({ x: x + nx * 0.45, y: y + ny * 0.45, nx, ny, main });
        }
      }
      carry = (carry - len) % spacing;
      carry = carry < 0 ? carry + spacing : carry;
    }
  }
  return out;
}

/**
 * Outside lights on the houses and street lights along the main roads, and along smaller roads
 * where people live. Drawn once; fade in with the dark by setting the alpha.
 */
export function nightLights(map: GameMap): Graphics {
  const lamps: [number, number, number][] = [];
  const heads: { x: number; y: number; nx: number; ny: number }[] = [];
  for (const l of streetLamps(map)) {
    if (l.main) {
      heads.push({ x: l.x * PX, y: l.y * PX, nx: l.nx, ny: l.ny });
    } else {
      lamps.push([l.x * PX, l.y * PX, 1.1]);
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
  for (const [r, a] of [[PX * 0.8, 0.09], [PX * 0.45, 0.14]]) {
    for (const h of heads) {
      g.circle(h.x - h.nx * 5, h.y - h.ny * 5, r);
    }
    g.fill({ color: WARM, alpha: a });
  }
  for (const h of heads) {
    g.circle(h.x - h.nx * 4.5, h.y - h.ny * 4.5, 3);
  }
  g.fill({ color: 0xfff1c8, alpha: 0.45 });
  for (const h of heads) {
    g.moveTo(h.x + h.nx * 5, h.y + h.ny * 5).lineTo(h.x, h.y);
  }
  g.stroke({ color: 0x3a4048, width: 1, cap: "round" });
  for (const h of heads) {
    g.moveTo(h.x + h.nx * 0.5, h.y + h.ny * 0.5).lineTo(h.x - h.nx * 2, h.y - h.ny * 2);
  }
  g.stroke({ color: 0x2b3038, width: 2.4, cap: "round" });
  g.alpha = 0;
  return g;
}
