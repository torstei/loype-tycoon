import { Container, Graphics, Text } from "pixi.js";
import { GameClock } from "./clock";
import { GameMap } from "./map";
import { PX } from "./render";
import { SkierSprite } from "./skiers";
import { TrackNetwork } from "./tracks";

/** The valley floor, where he trains the dogs. */
const VALLEY_BELOW = 215;
const SPEED = 95;
const SESSION_TILES = 140;
const WINDOWS: [number, number][] = [[5.5, 8.5], [20, 23.5]];
const BEARD = 0xc0561e;

const QUOTES = [
  "Manu! Nanook! Ikke den elgen!",
  "Hei hei! Vi bare suser forbi!",
  "Nanook, VENSTRE! …Den andre venstre.",
  "Manu har funnet noe ekkelt i snøen.",
  "De er ikke farlige, de vil bare løpe!",
  "Fint spor! Hundene godkjenner.",
  "Vi har vært ute siden fem. Hundene altså. Jeg har ikke hatt noe valg.",
  "Nanook spiste nettopp en vott. Er den din?",
];

/** A husky in side view, facing right, feet at the origin. */
class Husky {
  readonly root = new Container();
  private readonly legs: Graphics[];
  private readonly tail = new Graphics();

  constructor(coat: number) {
    this.legs = [-3, -1.8, 2, 3.2].map((x) => {
      const leg = new Graphics().moveTo(0, 0).lineTo(0, 3).stroke({ width: 1, color: 0x3b3f46, cap: "round" });
      leg.position.set(x, -3);
      return leg;
    });
    this.tail.position.set(-4.2, -5);
    this.tail.arc(0, -1.6, 1.6, Math.PI * 0.5, Math.PI * 1.9).stroke({ width: 1.2, color: coat, cap: "round" });
    const body = new Graphics()
      .ellipse(0, -4.6, 4.4, 2.2)
      .fill(coat)
      .stroke({ width: 0.6, color: 0x2b2e33 })
      .ellipse(0.4, -3.6, 3, 1)
      .fill(0xf4f6f8)
      .poly([3.4, -6, 4.6, -8.6, 5.4, -6.4])
      .fill(coat)
      .poly([4.8, -6.2, 5.8, -8.8, 6.4, -6.4])
      .fill(coat)
      .ellipse(5.6, -5.6, 2.2, 1.6)
      .fill(coat)
      .stroke({ width: 0.6, color: 0x2b2e33 })
      .ellipse(6.4, -5.1, 1.4, 0.9)
      .fill(0xf4f6f8)
      .circle(7.6, -5.2, 0.45)
      .fill(0x1d1d22)
      .circle(5.9, -6.1, 0.3)
      .fill(0x4aa8e0)
      .rect(-1, -6.6, 2, 0.8)
      .fill(0xe8591a);
    this.root.addChild(this.tail, ...this.legs, body);
  }

  gallop(phase: number) {
    // Front and hind pairs reach and gather out of step: a bounding gait.
    this.legs.forEach((leg, i) => {
      const pair = i < 2 ? 0 : Math.PI * 0.6;
      leg.rotation = Math.sin(phase + pair + (i % 2) * 0.4) * 0.7;
    });
    this.tail.rotation = Math.sin(phase * 0.5) * 0.15;
    this.root.y = -Math.abs(Math.sin(phase)) * 0.8;
  }
}

/** A red-bearded man skijoring through the valley at dawn and late at night with Manu and Nanook. */
export class Skijorer {
  readonly layer = new Container();
  private readonly skier = new SkierSprite(0x2f7d4a, 0x23323d, 1.25, { beard: BEARD, poles: false });
  private readonly dogs = [new Husky(0x8e959f), new Husky(0x5d636c)];
  private readonly dogRoots = this.dogs.map(() => new Container());
  private readonly line = new Graphics();
  /** Placed above the night overlay by the caller. */
  readonly bubble = new Container();
  private bubbleTtl = 0;
  private active = false;
  private sessionKey = "";
  private px = 0;
  private py = 0;
  private heading = 0;
  private shown = 0;
  private stride = 0;
  private travelled = 0;
  private previous: [number, number] | null = null;
  private target: [number, number] = [0, 0];
  private route: [number, number][] | null = null;

  constructor(private readonly map: GameMap) {
    this.dogRoots.forEach((r, i) => r.addChild(this.dogs[i].root));
    this.layer.addChild(this.line, this.skier.root, ...this.dogRoots);
    this.layer.visible = false;
  }

  /** Paths and forest roads on the valley floor, for mornings before anyone has built track there. */
  private fallbackRoute(): [number, number][] | null {
    const candidates = this.map.lines.filter((l) => {
      if (l.kind !== "path" && l.kind !== "forest_road") {
        return false;
      }
      const tiles = l.pts.map(([x, y]) => [Math.floor(x), Math.floor(y)] as [number, number]).filter(([x, y]) => this.map.inside(x, y));
      if (tiles.length < 4) {
        return false;
      }
      const mean = tiles.reduce((s, [x, y]) => s + this.map.elevationAt(x, y), 0) / tiles.length;
      const length = l.pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - l.pts[i - 1][0], p[1] - l.pts[i - 1][1]) : 0), 0);
      return mean < VALLEY_BELOW && length > 15;
    });
    if (candidates.length === 0) {
      return null;
    }
    const l = candidates[Math.floor(Math.random() * candidates.length)];
    return [...l.pts, ...[...l.pts].reverse()].map(([x, y]) => [x - 0.5, y - 0.5] as [number, number]);
  }

  private valleyTracks(tracks: TrackNetwork): [number, number][] {
    return [...tracks.each()].filter(([x, y]) => this.map.elevationAt(x, y) < VALLEY_BELOW);
  }

  private start(tracks: TrackNetwork) {
    const valley = this.valleyTracks(tracks);
    this.route = null;
    if (valley.length >= 8) {
      const [x, y] = valley[Math.floor(Math.random() * valley.length)];
      this.px = x + 0.5;
      this.py = y + 0.5;
      this.target = [x, y];
    } else {
      this.route = this.fallbackRoute();
      if (!this.route) {
        return;
      }
      const first = this.route.shift()!;
      [this.px, this.py] = [first[0] + 0.5, first[1] + 0.5];
      this.target = first;
    }
    this.previous = null;
    this.travelled = 0;
    this.active = true;
    this.layer.visible = true;
  }

  update(hours: number, clock: GameClock, tracks: TrackNetwork) {
    const h = clock.hourOfDay;
    const window = WINDOWS.findIndex(([a, b]) => h >= a && h < b);
    if (!this.active && window >= 0) {
      const key = `${clock.day}:${window}`;
      if (key !== this.sessionKey) {
        this.sessionKey = key;
        // Some days the dogs get their way and it is a long walk instead.
        if (Math.random() < 0.8) {
          this.start(tracks);
        }
      }
    }
    if (!this.active) {
      return;
    }
    let budget = hours * SPEED;
    while (budget > 0 && this.active) {
      const cx = this.target[0] + 0.5;
      const cy = this.target[1] + 0.5;
      const dist = Math.hypot(cx - this.px, cy - this.py);
      if (dist > 0.05) {
        this.heading = Math.atan2(cy - this.py, cx - this.px);
      }
      if (dist > budget) {
        this.px += ((cx - this.px) / dist) * budget;
        this.py += ((cy - this.py) / dist) * budget;
        this.stride += budget * 1.4;
        return;
      }
      this.px = cx;
      this.py = cy;
      budget -= dist;
      this.stride += dist * 1.4;
      this.travelled += 1;
      this.next(tracks);
    }
  }

  private next(tracks: TrackNetwork) {
    if (this.travelled >= SESSION_TILES) {
      this.finish();
      return;
    }
    if (this.route) {
      const n = this.route.shift();
      if (!n) {
        this.finish();
        return;
      }
      this.target = [n[0], n[1]];
      return;
    }
    const [x, y] = this.target;
    const options = tracks
      .neighbours(x, y)
      .filter(([nx, ny]) => this.map.elevationAt(nx, ny) < VALLEY_BELOW + 15)
      .filter(([nx, ny]) => !this.previous || nx !== this.previous[0] || ny !== this.previous[1]);
    const choices = options.length > 0 ? options : tracks.neighbours(x, y);
    if (choices.length === 0) {
      this.finish();
      return;
    }
    this.previous = this.target;
    this.target = choices[Math.floor(Math.random() * choices.length)];
  }

  private finish() {
    this.active = false;
    this.layer.visible = false;
    this.bubbleTtl = 0;
    this.bubble.removeChildren().forEach((c) => c.destroy({ children: true }));
  }

  /** Click on him: one of the dogs is up to something. */
  poke(wx: number, wy: number): boolean {
    if (!this.active || !this.layer.visible) {
      return false;
    }
    const x = this.px * PX;
    const y = this.py * PX;
    const dogX = x + Math.cos(this.shown) * 14;
    const dogY = y + Math.sin(this.shown) * 14;
    if (Math.hypot(wx - x, wy - (y - 8)) > 16 && Math.hypot(wx - dogX, wy - dogY) > 12) {
      return false;
    }
    this.say(QUOTES[Math.floor(Math.random() * QUOTES.length)]);
    return true;
  }

  private say(text: string) {
    this.bubble.removeChildren().forEach((c) => c.destroy({ children: true }));
    const t = new Text({
      text,
      style: { fontFamily: "system-ui, sans-serif", fontSize: 11, fontWeight: "600", fill: 0x23323d },
      resolution: 3,
    });
    const w = t.width + 10;
    const h = t.height + 6;
    const g = new Graphics()
      .roundRect(-w / 2, -h - 6, w, h, 5)
      .moveTo(-4, -6.5)
      .lineTo(0, 0)
      .lineTo(4, -6.5)
      .fill(0xffffff)
      .roundRect(-w / 2, -h - 6, w, h, 5)
      .stroke({ width: 1.2, color: 0x23323d });
    t.position.set(-w / 2 + 5, -h - 3);
    this.bubble.addChild(g, t);
    this.bubbleTtl = 4;
  }

  animate(dt: number, detail: boolean, darkness: number, lights: Graphics) {
    if (!this.active) {
      return;
    }
    this.layer.visible = detail;
    let turn = this.heading - this.shown;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    this.shown += turn * Math.min(1, dt * 8);
    const a = this.shown;
    const x = this.px * PX;
    const y = this.py * PX + 2;
    this.skier.pose(this.stride, a);
    this.skier.root.position.set(x, y);

    const dogPhase = this.stride * 2.6;
    const facing = Math.cos(a) < 0 ? -1 : 1;
    const perpX = -Math.sin(a);
    const perpY = Math.cos(a);
    this.line.clear();
    this.dogRoots.forEach((root, i) => {
      const lateral = i === 0 ? -3 : 3;
      const ahead = 14 + i * 1.5;
      root.position.set(x + Math.cos(a) * ahead + perpX * lateral, y + Math.sin(a) * ahead + perpY * lateral);
      root.scale.x = facing;
      this.dogs[i].gallop(dogPhase + i * 1.3);
      this.line.moveTo(x, y - 7).lineTo(root.x - Math.cos(a) * 3, root.y - 5);
    });
    this.line.stroke({ width: 0.7, color: 0xe8591a });
    // Dogs further down the screen are drawn in front.
    const [near, far] = this.dogRoots[0].y > this.dogRoots[1].y ? [this.dogRoots[0], this.dogRoots[1]] : [this.dogRoots[1], this.dogRoots[0]];
    // Whatever is lower on the screen is nearer the viewer and drawn on top.
    const order = Math.sin(a) > 0.4 ? [this.skier.root, far, near] : [far, near, this.skier.root];
    order.forEach((c, i) => this.layer.setChildIndex(c, i + 1));

    this.bubble.visible = detail && this.bubbleTtl > 0;
    if (this.bubbleTtl > 0) {
      this.bubbleTtl -= dt;
      this.bubble.position.set(x, y - 18);
      this.bubble.alpha = Math.min(1, this.bubbleTtl * 3);
    }

    if (detail && darkness > 0.15) {
      const reach = 40;
      const spread = 0.42;
      lights
        .moveTo(x + Math.cos(a) * 3, y + Math.sin(a) * 3)
        .lineTo(x + Math.cos(a - spread) * reach, y + Math.sin(a - spread) * reach)
        .lineTo(x + Math.cos(a + spread) * reach, y + Math.sin(a + spread) * reach)
        .closePath()
        .fill({ color: 0xfff4c8, alpha: 0.3 * darkness });
      const headY = y - (Math.abs(Math.cos(a)) >= 0.42 ? 11 : 12.5) * 1.25;
      lights.circle(x, headY, 4).fill({ color: 0xfff4c8, alpha: 0.25 * darkness });
      lights.circle(x, headY, 1.3).fill({ color: 0xfffbe8, alpha: darkness });
    }
  }

  get visibleAt(): { x: number; y: number } | null {
    return this.active ? { x: this.px * PX, y: this.py * PX } : null;
  }
}
