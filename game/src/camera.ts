import { Container } from "pixi.js";

/** Fixed zoom steps; below OVERVIEW_BELOW the cartoon overview map replaces the detail view. */
export const ZOOM_LEVELS = [0.22, 0.32, 0.5, 0.7, 1, 1.4, 2, 3];
export const OVERVIEW_BELOW = 0.45;

export class Camera {
  private level: number;
  private target: number;
  private anchor: { sx: number; sy: number; wx: number; wy: number } | null = null;

  constructor(
    private readonly world: Container,
    start = 4,
  ) {
    this.level = start;
    this.target = ZOOM_LEVELS[start];
    world.scale.set(this.target);
  }

  get scale(): number {
    return this.world.scale.x;
  }

  centreOn(wx: number, wy: number, screenW: number, screenH: number) {
    this.world.position.set(screenW / 2 - wx * this.scale, screenH / 2 - wy * this.scale);
  }

  /** Step the zoom level, keeping the world point under (sx, sy) in place. */
  zoomAt(sx: number, sy: number, steps: number) {
    this.level = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, this.level + steps));
    this.target = ZOOM_LEVELS[this.level];
    const w = this.world.toLocal({ x: sx, y: sy });
    this.anchor = { sx, sy, wx: w.x, wy: w.y };
  }

  pan(dx: number, dy: number) {
    this.world.x += dx;
    this.world.y += dy;
    if (this.anchor) {
      this.anchor.sx += dx;
      this.anchor.sy += dy;
    }
  }

  update(dt: number) {
    if (!this.anchor) {
      return;
    }
    let s = this.scale + (this.target - this.scale) * Math.min(1, dt * 14);
    if (Math.abs(s - this.target) < 0.002) {
      s = this.target;
    }
    this.world.scale.set(s);
    this.world.position.set(this.anchor.sx - this.anchor.wx * s, this.anchor.sy - this.anchor.wy * s);
    if (s === this.target) {
      this.anchor = null;
    }
  }
}
