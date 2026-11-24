import { Graphics } from "pixi.js";
import { hash, PX } from "./render";

/** The house in Hadelandsveien that ends up in Varingen every December for its Christmas lights. */
export const JULEHUS = { x: 294, y: 239, name: "julehuset i Hadelandsveien" };

/** Tjugendedag, 13 January, when Christmas is over and the lights come down. */
export const LIGHTS_DOWN_DAY = 43;

const COLOURS = [0xff3b3b, 0x3bdc5a, 0x4a8bff, 0xffd23b, 0xffffff, 0xff7ad9];

interface Bulb {
  x: number;
  y: number;
  colour: number;
  phase: number;
  speed: number;
}

const line = (out: Bulb[], ax: number, ay: number, bx: number, by: number, step: number, seed: number) => {
  const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / step));
  for (let i = 0; i < n; i++) {
    const k = i / n;
    const h = hash(out.length, seed, 71);
    out.push({ x: ax + (bx - ax) * k, y: ay + (by - ay) * k, colour: COLOURS[out.length % COLOURS.length], phase: h * 6.28, speed: 2 + h * 4 });
  }
};

/** Twinkling lights on the roof, round the garden and up a tree, plus a reindeer on the lawn. */
export class Julehus {
  readonly lights = new Graphics();
  private bulbs: Bulb[] = [];
  private t = 0;

  constructor() {
    const cx = (JULEHUS.x + 0.5) * PX;
    const cy = (JULEHUS.y + 0.5) * PX;
    const b = this.bulbs;
    line(b, cx - 9, cy - 1, cx, cy - 9, 1.8, 1);
    line(b, cx, cy - 9, cx + 9, cy - 1, 1.8, 2);
    const west = cx - PX * 1.5;
    const east = cx + PX * 0.45;
    const north = cy - PX * 0.9;
    const south = cy + PX * 1.3;
    line(b, west, north, east, north, 2.4, 3);
    line(b, east, north, east, south, 2.4, 4);
    line(b, east, south, west, south, 2.4, 5);
    line(b, west, south, west, north, 2.4, 6);
    const tx = cx - PX * 1.05;
    const ty = cy - PX * 0.2;
    for (let i = 0; i < 4; i++) {
      line(b, tx - 6 + i * 1.5, ty + 6 - i * 3.5, tx + 6 - i * 1.5, ty + 6 - i * 3.5, 2.2, 10 + i);
    }
    b.push({ x: tx, y: ty - 9, colour: 0xffe680, phase: 0, speed: 0 });
    const rx = cx - PX * 0.5;
    const ry = cy + PX * 0.85;
    const reindeer = b.length;
    for (const [ax, ay, bx2, by2] of [[-5, 0, 4, 0], [-4, 0, -4, 4], [3, 0, 3, 4], [4, 0, 6, -4], [6, -4, 8, -6], [6, -4, 4, -7]]) {
      line(b, rx + ax, ry + ay, rx + bx2, ry + by2, 2, 20);
    }
    for (const bulb of b.slice(reindeer)) {
      bulb.colour = 0xe8f4ff;
      bulb.speed = 0.6;
    }
    this.lights.alpha = 0;
  }

  /** On from dusk through Christmas, brightest when it is fully dark. */
  animate(dt: number, day: number, darkness: number, detail: boolean) {
    const on = day <= LIGHTS_DOWN_DAY ? Math.min(1, Math.max(0, (darkness - 0.15) / 0.4)) : 0;
    this.lights.alpha = on;
    if (on === 0) {
      return;
    }
    this.t += dt;
    const g = this.lights.clear();
    const cx = (JULEHUS.x + 0.1) * PX;
    const cy = (JULEHUS.y + 0.6) * PX;
    const hue = COLOURS[Math.floor(this.t * 0.8) % COLOURS.length];
    for (const [r, a] of [[PX * 5, 0.05], [PX * 3, 0.08], [PX * 1.7, 0.1]]) {
      g.circle(cx, cy, r).fill({ color: hue, alpha: a });
    }
    if (!detail) {
      g.circle(cx, cy, PX * 1.2).fill({ color: hue, alpha: 0.7 });
      return;
    }
    for (const bulb of this.bulbs) {
      const lit = bulb.speed === 0 ? 1 : 0.35 + 0.65 * Math.max(0, Math.sin(this.t * bulb.speed + bulb.phase));
      g.circle(bulb.x, bulb.y, 3.2).fill({ color: bulb.colour, alpha: 0.3 * lit });
      g.circle(bulb.x, bulb.y, 1.5).fill({ color: bulb.colour, alpha: lit });
    }
  }

  near(x: number, y: number) {
    return Math.abs(x - JULEHUS.x) <= 1.5 && Math.abs(y - JULEHUS.y) <= 1.5;
  }
}
