import { Container, Sprite, Texture } from "pixi.js";
import { GameMap } from "./map";
import { CHUNK, landscapeFields, LandscapeFields, PX, renderChunk } from "./render";

/** Chunks kept drawn at once; each is 800×800 px, so this caps the landscape at about 100 MB. */
const MAX_CHUNKS = 40;

/**
 * The detailed landscape, drawn chunk by chunk as it comes into view and forgotten again when
 * it has been out of view the longest. The overview map underneath stands in until a chunk is ready.
 */
export class LandscapeChunks {
  readonly layer = new Container();
  readonly fields: LandscapeFields;
  private readonly chunks = new Map<string, { sprite: Sprite; used: number }>();
  private frame = 0;
  private readonly cols: number;
  private readonly rows: number;

  constructor(private readonly map: GameMap) {
    this.fields = landscapeFields(map);
    this.cols = Math.ceil(map.width / CHUNK);
    this.rows = Math.ceil(map.height / CHUNK);
  }

  /** Make sure the chunks covering a world-pixel rectangle are drawn, a few per frame. */
  update(x0: number, y0: number, x1: number, y1: number, budgetMs = 12) {
    this.frame++;
    const size = CHUNK * PX;
    const cx0 = Math.max(0, Math.floor(x0 / size));
    const cy0 = Math.max(0, Math.floor(y0 / size));
    const cx1 = Math.min(this.cols - 1, Math.floor(x1 / size));
    const cy1 = Math.min(this.rows - 1, Math.floor(y1 / size));
    const midX = (x0 + x1) / 2 / size;
    const midY = (y0 + y1) / 2 / size;
    const missing: [number, number][] = [];
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = this.chunks.get(`${cx},${cy}`);
        if (c) {
          c.used = this.frame;
        } else {
          missing.push([cx, cy]);
        }
      }
    }
    // Nearest the middle of the screen first; always at least one per frame.
    missing.sort((a, b) => Math.hypot(a[0] + 0.5 - midX, a[1] + 0.5 - midY) - Math.hypot(b[0] + 0.5 - midX, b[1] + 0.5 - midY));
    const start = performance.now();
    for (const [cx, cy] of missing) {
      this.draw(cx, cy);
      if (performance.now() - start > budgetMs) {
        break;
      }
    }
    this.evict();
  }

  /** Draw everything at once; for screenshots and tests. */
  drawAll() {
    for (let cy = 0; cy < this.rows; cy++) {
      for (let cx = 0; cx < this.cols; cx++) {
        if (!this.chunks.has(`${cx},${cy}`)) {
          this.draw(cx, cy);
        }
      }
    }
  }

  get size(): number {
    return this.chunks.size;
  }

  private draw(cx: number, cy: number) {
    const sprite = new Sprite(Texture.from(renderChunk(this.map, cx, cy, this.fields)));
    sprite.position.set(cx * CHUNK * PX, cy * CHUNK * PX);
    this.layer.addChild(sprite);
    this.chunks.set(`${cx},${cy}`, { sprite, used: this.frame });
  }

  private evict() {
    if (this.chunks.size <= MAX_CHUNKS) {
      return;
    }
    const oldest = [...this.chunks.entries()].sort((a, b) => a[1].used - b[1].used);
    for (const [key, c] of oldest.slice(0, this.chunks.size - MAX_CHUNKS)) {
      if (c.used === this.frame) {
        break;
      }
      c.sprite.destroy({ texture: true, textureSource: true });
      this.chunks.delete(key);
    }
  }
}
