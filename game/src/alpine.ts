import { Container, Graphics } from "pixi.js";
import { GameClock, isWeekend } from "./clock";
import { AlpineLift, AlpineSlope, GameMap } from "./map";
import { PX } from "./render";
import { Weather } from "./weather";

type Pt = [number, number];

/** The club's share of turning the main T-bar into a chair-lift. */
export const CHAIRLIFT_PRICE = 400_000;

/** Alpine skiers move on the same shrunken scale as everyone else in the game: tiles per game hour. */
const RIDE_SPEED = 60;
const SKI_SPEED = 160;
const WALK_SPEED = 25;
/** Slope pieces whose ends lie this close, in tiles, join into one run. */
const JOIN = 1.6;
const POLE_SPACING = 3;
const JACKETS = [0xe8591a, 0x1f5fd1, 0xf2c12e, 0x3aa35a, 0xd64a8a, 0x23323d, 0x18c0d8];

interface Run {
  pts: Pt[];
  lengths: number[];
  total: number;
}

function run(pts: Pt[]): Run {
  const lengths = [0];
  for (let i = 1; i < pts.length; i++) {
    lengths.push(lengths[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  return { pts, lengths, total: lengths[lengths.length - 1] };
}

function pointAt(r: Run, d: number): { x: number; y: number; dx: number; dy: number } {
  const t = Math.max(0, Math.min(r.total, d));
  let i = 1;
  while (i < r.lengths.length - 1 && r.lengths[i] < t) {
    i++;
  }
  const [ax, ay] = r.pts[i - 1];
  const [bx, by] = r.pts[i];
  const seg = r.lengths[i] - r.lengths[i - 1] || 1;
  const k = (t - r.lengths[i - 1]) / seg;
  return { x: ax + (bx - ax) * k, y: ay + (by - ay) * k, dx: (bx - ax) / seg, dy: (by - ay) / seg };
}

interface Lift {
  name: string;
  kind: string;
  line: Run;
  chair: boolean;
}

interface Piece {
  name: string | null;
  lit: boolean;
  line: Run;
  next: number[];
}

interface AlpineSkier {
  jacket: number;
  phase: "ride" | "ski" | "walk";
  lift: number;
  piece: number;
  walk: Run | null;
  d: number;
  /** Turns: where in its swing the skier is. */
  swing: number;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** The ski lifts and downhill slopes: decoration with life in it, and a chair-lift to buy. */
export class Alpine {
  readonly layer = new Container();
  /** Floodlights, drawn above the night. */
  readonly lights = new Graphics();
  readonly lifts: Lift[];
  private readonly pieces: Piece[];
  private readonly skiers: AlpineSkier[] = [];
  private readonly ground = new Graphics();
  private readonly moving = new Graphics();
  private open = false;
  private time = 0;

  constructor(private readonly map: GameMap) {
    const height = ([x, y]: Pt) => map.elevationAt(Math.min(map.width - 1, Math.max(0, Math.floor(x))), Math.min(map.height - 1, Math.max(0, Math.floor(y))));
    const uphill = (pts: Pt[]) => (height(pts[0]) <= height(pts[pts.length - 1]) ? pts : [...pts].reverse());
    this.lifts = (map.alpine?.lifts ?? [])
      .filter((l: AlpineLift) => l.kind !== "magic_carpet")
      .map((l: AlpineLift) => ({ name: l.name ?? "Skitrekket", kind: l.kind, line: run(uphill(l.pts)), chair: l.kind === "chair_lift" }));
    this.pieces = (map.alpine?.slopes ?? []).map((s: AlpineSlope) => ({ name: s.name, lit: s.lit, line: run(uphill(s.pts).reverse()), next: [] }));
    for (const [i, a] of this.pieces.entries()) {
      const end = a.line.pts[a.line.pts.length - 1];
      a.next = this.pieces.flatMap((b, j) => (j !== i && dist(end, b.line.pts[0]) < JOIN && height(b.line.pts[0]) >= height(b.line.pts[b.line.pts.length - 1]) ? [j] : []));
    }
    this.layer.addChild(this.ground, this.moving);
    this.drawGround();
  }

  /** The lift worth turning into a chair-lift: the longest one. */
  get mainLift(): Lift | undefined {
    return [...this.lifts].sort((a, b) => b.line.total - a.line.total)[0];
  }

  get hasChairlift(): boolean {
    return this.lifts.some((l) => l.chair);
  }

  /** Where the main lift arrives at the top, in tiles. */
  get topStation(): Pt | null {
    const lift = this.mainLift;
    return lift ? lift.line.pts[lift.line.pts.length - 1] : null;
  }

  /** Weekday evenings under the floodlights, weekend days in daylight; closed when there is no snow to ski on. */
  isOpen(clock: GameClock, weather: Weather): boolean {
    const top = this.topStation;
    if (!top || weather.snowDepthAt(this.map.elevationAt(Math.floor(top[0]), Math.floor(top[1]))) < 10) {
      return false;
    }
    const h = clock.hourOfDay;
    return isWeekend(clock.day) ? h >= 10 && h < 16 : h >= 17 && h < 21;
  }

  /** The lift whose line passes within r tiles of a tile, if any. */
  liftNear(x: number, y: number, r = 1.2): Lift | undefined {
    const p: Pt = [x + 0.5, y + 0.5];
    return this.lifts.find((l) => {
      for (let d = 0; d <= l.line.total; d += 0.5) {
        const q = pointAt(l.line, d);
        if (dist(p, [q.x, q.y]) <= r) {
          return true;
        }
      }
      return false;
    });
  }

  /** The lift with a station within r tiles of a tile, if any. */
  stationNear(x: number, y: number, r = 1.5): Lift | undefined {
    const p: Pt = [x + 0.5, y + 0.5];
    return this.lifts.find((l) => dist(p, l.line.pts[0]) <= r || dist(p, l.line.pts[l.line.pts.length - 1]) <= r);
  }

  buildChairlift() {
    const lift = this.mainLift;
    if (lift && !lift.chair) {
      lift.chair = true;
      this.drawGround();
    }
  }

  /** How many are in the slopes right now: busier at weekends, fewer in rain or biting cold. */
  private wanted(clock: GameClock, weather: Weather): number {
    if (!this.open) {
      return 0;
    }
    let n = isWeekend(clock.day) ? 34 : 18;
    if (weather.precipRate > 0 && weather.temperature > 0.5) {
      n *= 0.3;
    } else if (weather.temperature < -14) {
      n *= 0.5;
    }
    return Math.round(n * (this.hasChairlift ? 1.4 : 1));
  }

  update(hours: number, clock: GameClock, weather: Weather) {
    this.open = this.lifts.length > 0 && this.isOpen(clock, weather);
    const wanted = this.wanted(clock, weather);
    while (this.skiers.length < wanted) {
      this.spawn();
    }
    if (this.skiers.length > wanted) {
      // People go home from the bottom of a run, not from the middle of the slope.
      const leaving = this.skiers.findIndex((s) => s.phase === "walk");
      if (leaving >= 0) {
        this.skiers.splice(leaving, 1);
      }
    }
    for (const s of this.skiers) {
      this.move(s, hours);
    }
  }

  private spawn() {
    if (this.lifts.length === 0) {
      return;
    }
    const lift = Math.floor(Math.random() * this.lifts.length);
    this.skiers.push({ jacket: JACKETS[Math.floor(Math.random() * JACKETS.length)], phase: "ride", lift, piece: -1, walk: null, d: Math.random() * this.lifts[lift].line.total, swing: Math.random() * 6 });
  }

  private move(s: AlpineSkier, hours: number) {
    if (s.phase === "ride") {
      const lift = this.lifts[s.lift];
      s.d += hours * RIDE_SPEED * (lift.chair ? 1.3 : 1);
      if (s.d >= lift.line.total) {
        const top = lift.line.pts[lift.line.pts.length - 1];
        const starts = this.pieces.map((p, i) => [dist(top, p.line.pts[0]), i] as const).sort((a, b) => a[0] - b[0]);
        const near = starts.filter(([d]) => d < 4);
        const pick = near.length ? near[Math.floor(Math.random() * near.length)] : starts[0];
        if (!pick) {
          s.d = 0;
          return;
        }
        s.piece = pick[1];
        s.phase = "ski";
        s.d = 0;
      }
      return;
    }
    if (s.phase === "ski") {
      const piece = this.pieces[s.piece];
      s.d += hours * SKI_SPEED;
      s.swing += hours * 40;
      if (s.d >= piece.line.total) {
        if (piece.next.length) {
          s.piece = piece.next[Math.floor(Math.random() * piece.next.length)];
          s.d = 0;
          return;
        }
        const end = piece.line.pts[piece.line.pts.length - 1];
        const bottoms = this.lifts.map((l, i) => [dist(end, l.line.pts[0]), i] as const).sort((a, b) => a[0] - b[0]);
        const near = bottoms.filter(([d]) => d < 5);
        const [, lift] = near.length ? near[Math.floor(Math.random() * near.length)] : bottoms[0];
        s.lift = lift;
        s.walk = run([end, this.lifts[lift].line.pts[0]]);
        s.phase = "walk";
        s.d = 0;
      }
      return;
    }
    s.d += hours * WALK_SPEED;
    if (!s.walk || s.d >= s.walk.total) {
      s.phase = "ride";
      s.walk = null;
      s.d = 0;
    }
  }

  /** Cables, pylons, stations and floodlight poles: redrawn only when a lift changes. */
  private drawGround() {
    const g = this.ground.clear();
    // The slopes are cleared and groomed strips through the forest.
    for (const [width, colour, alpha] of [[PX * 1.8, 0xb8c8e2, 0.5], [PX * 1.4, 0xfbfdff, 0.75]] as const) {
      for (const p of this.pieces) {
        p.line.pts.forEach(([x, y], i) => (i === 0 ? g.moveTo(x * PX, y * PX) : g.lineTo(x * PX, y * PX)));
        g.stroke({ width, color: colour, alpha, cap: "round", join: "round" });
      }
    }
    for (const lift of this.lifts) {
      const { pts } = lift.line;
      const side = lift.chair ? 0.28 : 0;
      for (const offset of lift.chair ? [-side, side] : [0]) {
        pts.forEach(([x, y], i) => {
          const q = pointAt(lift.line, lift.line.lengths[i]);
          const px = (x - q.dy * offset) * PX;
          const py = (y + q.dx * offset) * PX;
          if (i === 0) {
            g.moveTo(px, py);
          } else {
            g.lineTo(px, py);
          }
        });
        g.stroke({ width: 1.4, color: 0x2b2f38, alpha: 0.9 });
      }
      for (let d = 2; d < lift.line.total - 1; d += lift.chair ? 4 : 3) {
        const q = pointAt(lift.line, d);
        g.circle(q.x * PX, q.y * PX, lift.chair ? 2.2 : 1.5).fill(0x4a4f5c);
        if (lift.chair) {
          g.moveTo((q.x + q.dy * side) * PX, (q.y - q.dx * side) * PX).lineTo((q.x - q.dy * side) * PX, (q.y + q.dx * side) * PX).stroke({ width: 1.5, color: 0x4a4f5c });
        }
      }
      for (const [i, end] of [pts[0], pts[pts.length - 1]].entries()) {
        const w = lift.chair ? 9 : 6;
        g.rect(end[0] * PX - w / 2, end[1] * PX - w / 2, w, w * 0.75).fill(i === 0 ? 0x9a3b2e : 0x7a4e2c).stroke({ width: 1, color: 0x3a2414 });
      }
    }
    for (const p of this.pieces.filter((p) => p.lit)) {
      for (let d = 0; d < p.line.total; d += POLE_SPACING) {
        const q = pointAt(p.line, d);
        g.circle((q.x + q.dy * 0.9) * PX, (q.y - q.dx * 0.9) * PX, 1).fill(0x3a3f4a);
      }
    }
  }

  animate(dt: number, visible: boolean, darkness: number) {
    this.layer.visible = visible;
    this.time += dt;
    const g = this.moving.clear();
    const lit = this.open && darkness > 0.25;
    this.lights.clear();
    if (lit && visible) {
      for (const p of this.pieces.filter((p) => p.lit)) {
        for (let d = 0; d < p.line.total; d += POLE_SPACING) {
          const q = pointAt(p.line, d);
          for (const [r, a] of [[1.7, 0.055], [1.15, 0.08], [0.6, 0.11]]) {
            this.lights.circle((q.x + q.dy * 0.3) * PX, (q.y - q.dx * 0.3) * PX, PX * r).fill({ color: 0xfff1b8, alpha: a * darkness });
          }
          this.lights.circle((q.x + q.dy * 0.9) * PX, (q.y - q.dx * 0.9) * PX, 1.6).fill({ color: 0xfffbe6, alpha: 0.9 });
        }
      }
    }
    if (!visible) {
      return;
    }
    if (this.open) {
      for (const lift of this.lifts.filter((l) => l.chair)) {
        // Empty chairs come down the other side.
        for (let d = (this.time * 1.2) % 2.5; d < lift.line.total; d += 2.5) {
          const q = pointAt(lift.line, lift.line.total - d);
          g.rect((q.x + q.dy * 0.28) * PX - 1.5, (q.y - q.dx * 0.28) * PX - 1, 3, 2).fill(0x3a3f4a);
        }
      }
    }
    for (const s of this.skiers) {
      let x: number;
      let y: number;
      if (s.phase === "ride") {
        const lift = this.lifts[s.lift];
        const q = pointAt(lift.line, s.d);
        const off = lift.chair ? -0.28 : 0;
        x = q.x - q.dy * off;
        y = q.y + q.dx * off;
        if (lift.chair) {
          g.rect(x * PX - 2, y * PX - 1.2, 4, 2.4).fill(0x3a3f4a);
        }
      } else if (s.phase === "ski") {
        const q = pointAt(this.pieces[s.piece].line, s.d);
        const sway = Math.sin(s.swing) * 0.6;
        x = q.x + q.dy * sway;
        y = q.y - q.dx * sway;
        const angle = Math.atan2(q.dy, q.dx) + Math.cos(s.swing) * 0.7;
        g.moveTo(x * PX - Math.cos(angle) * 3.5, y * PX - Math.sin(angle) * 3.5).lineTo(x * PX + Math.cos(angle) * 3.5, y * PX + Math.sin(angle) * 3.5).stroke({ width: 1.2, color: 0x23323d });
      } else {
        const q = s.walk ? pointAt(s.walk, s.d) : { x: 0, y: 0 };
        x = q.x;
        y = q.y;
      }
      g.circle(x * PX, y * PX - 1.5, 2.4).fill(s.jacket).stroke({ width: 0.8, color: 0xffffff });
    }
  }

  get people(): number {
    return this.skiers.length;
  }
}
