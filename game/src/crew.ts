import { Container, Graphics } from "pixi.js";
import { PX } from "./render";

/**
 * The keyboard cursor: a trail-marker stake that walks the map tile by tile and, in
 * track-laying mode, leaves track behind it.
 */
export class TrackCrew {
  readonly layer = new Container();
  x: number;
  y: number;
  building = false;
  private readonly frame = new Graphics();
  private readonly stake = new Graphics();
  private time = 0;
  private bonk = 0;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
    this.stake
      .ellipse(0, 0, 3.5, 1.4)
      .fill({ color: 0x3c548c, alpha: 0.3 })
      .rect(-0.8, -16, 1.6, 16)
      .fill(0x5b3d2a)
      .poly([0.8, -16, 9, -13.5, 0.8, -11])
      .fill(0xe8591a)
      .stroke({ width: 0.8, color: 0x8a2e0a, join: "round" });
    this.stake.scale.set(1.5);
    this.layer.addChild(this.frame, this.stake);
  }

  /** Something blocked the step: shake and flash red for a moment. */
  refuse() {
    this.bonk = 0.35;
  }

  update(dt: number) {
    this.time += dt;
    this.bonk = Math.max(0, this.bonk - dt);
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 6);
    const shake = this.bonk > 0 ? Math.sin(this.bonk * 60) * 2 : 0;
    const colour = this.bonk > 0 ? 0xd0342c : this.building ? 0x1f5fd1 : 0xffffff;

    this.frame.clear();
    const pad = 1 + pulse * 1.5;
    this.frame
      .roundRect(this.x * PX - pad + shake, this.y * PX - pad, PX + pad * 2, PX + pad * 2, 3)
      .stroke({ width: 3.5, color: 0x23323d, alpha: 0.5 })
      .roundRect(this.x * PX - pad + shake, this.y * PX - pad, PX + pad * 2, PX + pad * 2, 3)
      .stroke({ width: 2, color: colour });
    if (this.building) {
      this.frame.roundRect(this.x * PX + shake, this.y * PX, PX, PX, 2).fill({ color: 0x1f5fd1, alpha: 0.15 + pulse * 0.1 });
    }
    this.stake.position.set(this.x * PX + PX / 2 + shake, this.y * PX + PX * 0.7);
    this.stake.rotation = this.building ? Math.sin(this.time * 9) * 0.06 : 0;
  }
}
