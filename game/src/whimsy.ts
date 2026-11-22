import { Container, Graphics, Text } from "pixi.js";
import { GameMap } from "./map";
import { hash, housePosition, PX } from "./render";
import { remoteness } from "./remote";
import { Flag, Terrain } from "./terrain";
import { TrackNetwork } from "./tracks";

export interface View {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const MOOSE_QUOTES = [
  "Dette er MIN skog.",
  "Har du smurt med riktig voks?",
  "Jeg tråkker der jeg vil.",
  "Løypemaskin? Aldri hørt om.",
  "Elgen har alltid forkjørsrett.",
  "Klister? I DENNE kulda?",
  "Mmm… bjørkeknopper.",
  "Fin løype. Synd om noen gikk i den.",
  "Har du sett kalven min?",
  "Jeg er IKKE en hjort.",
  "Sporløs-appen sier jo at det er fint her.",
];

function bubble(text: string): Container {
  const c = new Container();
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
  c.addChild(g, t);
  return c;
}

class Bubbles {
  private items: { c: Container; ttl: number; follow: () => { x: number; y: number } }[] = [];

  constructor(private readonly layer: Container) {}

  say(text: string, follow: () => { x: number; y: number }, seconds = 3.5) {
    const c = bubble(text);
    this.layer.addChild(c);
    this.items.push({ c, ttl: seconds, follow });
  }

  update(dt: number) {
    for (const it of this.items) {
      it.ttl -= dt;
      const p = it.follow();
      it.c.position.set(p.x, p.y);
      it.c.alpha = Math.min(1, it.ttl * 3);
    }
    for (const it of this.items.filter((i) => i.ttl <= 0)) {
      it.c.destroy({ children: true });
    }
    this.items = this.items.filter((i) => i.ttl > 0);
  }
}

const MOOSE_BROWN = 0x6b4a2f;
const MOOSE_DARK = 0x2e1f14;

function mooseLeg(colour: number): Graphics {
  return new Graphics().rect(-0.8, 0, 1.6, 4.6).fill(colour).rect(-0.9, 4.2, 1.8, 1).fill(0x1a120c);
}

/** A moose built from parts so legs, head, ear and tail can move independently. Faces right. */
class MooseBody {
  readonly root = new Container();
  private readonly legs: Graphics[];
  private readonly torso = new Container();
  private readonly head = new Container();
  private readonly ear: Graphics;
  private readonly tail: Graphics;

  constructor() {
    const shadow = new Graphics().ellipse(1, 1, 9, 2.5).fill({ color: 0x3c548c, alpha: 0.22 });
    const hips: [number, number][] = [[-5.2, 0x24180f], [-3.2, 0x3a281a], [4.2, 0x24180f], [6.2, 0x3a281a]];
    this.legs = hips.map(([x, colour]) => {
      const leg = mooseLeg(colour);
      leg.position.set(x, -4.4);
      return leg;
    });
    this.tail = new Graphics().roundRect(-0.6, 0, 1.4, 2.6, 0.6).fill(MOOSE_DARK);
    this.tail.position.set(-7.2, -7.8);
    const trunk = new Graphics()
      .poly([3, -8.5, 6, -9.5, 7.2, -6.2, 4, -4])
      .fill(MOOSE_BROWN)
      .ellipse(0, -6, 7.5, 3.8)
      .fill(MOOSE_BROWN)
      .stroke({ width: 1, color: MOOSE_DARK })
      .ellipse(-2, -8.5, 3, 1.6)
      .fill(0xf4f8fc);
    this.torso.addChild(this.tail, trunk);

    this.ear = new Graphics().ellipse(0, -1.2, 0.8, 1.6).fill(MOOSE_BROWN).stroke({ width: 0.6, color: MOOSE_DARK });
    this.ear.position.set(1.2, -3.2);
    const skull = new Graphics()
      .poly([-0.5, 0.5, 1.5, -3.8, 4, -3.6, 7.6, -1.6, 8.4, 0.8, 6.8, 2.2, 2.5, 1.8])
      .fill(MOOSE_BROWN)
      .stroke({ width: 1, color: MOOSE_DARK })
      .ellipse(7.6, 0.6, 1.7, 1.5)
      .fill(0x5a3c25)
      .stroke({ width: 0.8, color: MOOSE_DARK })
      .circle(8.3, 0.2, 0.35)
      .fill(MOOSE_DARK)
      .poly([2.2, 1.6, 2.6, 4.2, 3.4, 1.8])
      .fill(MOOSE_DARK)
      .poly([1.6, -3.6, -1.2, -7.6, 0.8, -6.4, 1.4, -8.6, 2.6, -6.6, 4, -8.4, 3.4, -3.6])
      .fill(0xd9c39a)
      .stroke({ width: 0.8, color: 0x8a7350 })
      .circle(3.6, -2.1, 0.6)
      .fill(MOOSE_DARK);
    this.head.addChild(this.ear, skull);
    this.head.position.set(5.8, -8.2);
    this.torso.addChild(this.head);

    this.root.addChild(shadow, ...this.legs, this.torso);
  }

  /** stride: walk-cycle phase in radians; amp: 0 standing still … 1 full stride. */
  pose(stride: number, amp: number, headAngle: number, earFlick: number, tailFlick: number, breath: number) {
    this.legs.forEach((leg, i) => {
      const diagonalPair = i === 0 || i === 3 ? 0 : Math.PI;
      leg.rotation = Math.sin(stride + diagonalPair) * 0.45 * amp;
    });
    this.torso.y = -Math.abs(Math.cos(stride)) * 0.6 * amp;
    this.torso.scale.y = 1 + breath * 0.02;
    this.head.rotation = headAngle + Math.sin(stride * 2) * 0.06 * amp;
    this.ear.rotation = earFlick;
    this.tail.rotation = tailFlick;
  }
}

/** Tiles per game hour: an unhurried moose. */
const MOOSE_SPEED = 15;

const TRAMPLE_QUOTES = ["Nypreppet! Mine favoritter.", "Så fint og flatt å gå her.", "Hvem har laget denne fine stien til meg?", "Klopp, klopp, klopp."];

/** What a moose decided this step, for the caller to react to. */
type MooseEvent = "track" | null;

class Moose {
  readonly sprite = new Container();
  x: number;
  y: number;
  private tx: number;
  private ty: number;
  private rest = 0;
  /** Tiles left to follow a track before wandering off again. */
  private trackSteps = 0;
  /** Game hours before this moose fancies another walk along a track. */
  private trackCooldown = Math.random() * 4;
  private walkedTrack = false;
  private previousTile: [number, number] | null = null;
  private tile: [number, number];
  private moved = 0;
  private time = Math.random() * 10;
  private stride = 0;
  private amp = 0;
  private facing = 1;
  private targetFacing = 1;
  private headAngle = 0;
  private grazing = true;
  private moodTimer = 0;
  private earTimer = 0;
  private tailTimer = 0;
  private readonly body = new MooseBody();

  constructor(
    private readonly map: GameMap,
    private readonly remote: Float32Array,
    x: number,
    y: number,
  ) {
    this.x = this.tx = x;
    this.y = this.ty = y;
    this.tile = [Math.floor(x / PX), Math.floor(y / PX)];
    this.body.root.scale.set(1.7);
    this.sprite.addChild(this.body.root);
  }

  private walkable(tx: number, ty: number): boolean {
    return this.map.inside(tx, ty) && this.map.terrainAt(tx, ty) !== Terrain.Built && !this.map.has(tx, ty, Flag.Building);
  }

  private remoteAt(tx: number, ty: number): number {
    return this.remote[this.map.index(tx, ty)];
  }

  /** Somewhere nearby, preferably further from people. */
  private chooseWanderTarget() {
    const [cx, cy] = this.tile;
    let best: [number, number] | null = null;
    let bestScore = -1;
    for (let tries = 0; tries < 14; tries++) {
      const nx = cx + Math.round((Math.random() - 0.5) * 28);
      const ny = cy + Math.round((Math.random() - 0.5) * 28);
      if (!this.walkable(nx, ny)) {
        continue;
      }
      const score = (0.05 + this.remoteAt(nx, ny) ** 2) * Math.random();
      if (score > bestScore) {
        bestScore = score;
        best = [nx, ny];
      }
    }
    if (best) {
      this.tx = (best[0] + 0.5) * PX;
      this.ty = (best[1] + 0.5) * PX;
    }
  }

  /** Next tile along the track, never straight back where it came from if it can help it. */
  private followTrack(tracks: TrackNetwork): boolean {
    const [x, y] = this.tile;
    const options = tracks
      .neighbours(x, y)
      .filter(([nx, ny]) => !this.previousTile || nx !== this.previousTile[0] || ny !== this.previousTile[1])
      .filter(([nx, ny]) => this.remoteAt(nx, ny) > 0.1);
    if (options.length === 0) {
      return false;
    }
    const [nx, ny] = options[Math.floor(Math.random() * options.length)];
    this.tx = (nx + 0.5) * PX;
    this.ty = (ny + 0.5) * PX;
    return true;
  }

  /** Move and decide in game time. */
  simulate(hours: number, tracks: TrackNetwork, now: number, peopleNear: (x: number, y: number) => boolean): MooseEvent {
    let event: MooseEvent = null;
    this.trackCooldown -= hours;
    if (this.rest > 0) {
      this.rest -= hours;
      return null;
    }
    let budget = hours * MOOSE_SPEED * PX;
    while (budget > 0) {
      const dx = this.tx - this.x;
      const dy = this.ty - this.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.5) {
        // Moose shy away from people: skiers nearby, or a stretch they use a lot, ends the walk.
        const disturbed = peopleNear(...this.tile) || Math.random() < tracks.disturbance(...this.tile) * 0.3;
        if (this.trackSteps > 0 && !disturbed && tracks.has(...this.tile) && this.followTrack(tracks)) {
          this.trackSteps--;
          continue;
        }
        if (this.trackSteps > 0 || this.walkedTrack) {
          this.trackCooldown = 4 + Math.random() * 6;
          this.walkedTrack = false;
        }
        this.trackSteps = 0;
        this.rest = 0.3 + Math.random() * 1.2;
        this.chooseWanderTarget();
        return event;
      }
      const step = Math.min(d, budget);
      this.x += (dx / d) * step;
      this.y += (dy / d) * step;
      this.moved += step;
      budget -= step;
      if (Math.abs(dx) > 0.5) {
        this.targetFacing = dx < 0 ? -1 : 1;
      }
      const tile: [number, number] = [Math.floor(this.x / PX), Math.floor(this.y / PX)];
      if (tile[0] !== this.tile[0] || tile[1] !== this.tile[1]) {
        this.previousTile = this.tile;
        this.tile = tile;
        if (tracks.has(...tile)) {
          const remote = this.remoteAt(...tile);
          if (peopleNear(...tile)) {
            // Skiers right there: step back into the trees.
            tracks.trample(tile[0], tile[1], 0.25, now);
            this.trackSteps = 0;
            this.chooseWanderTarget();
          } else if (this.trackSteps > 0) {
            tracks.trample(tile[0], tile[1], 0.6, now);
          } else {
            tracks.trample(tile[0], tile[1], 0.25, now);
            // Out in the wilds a groomed track is the best path a moose ever had.
            const quiet = 1 - tracks.disturbance(...tile);
            if (this.trackCooldown <= 0 && Math.random() < (0.05 + 0.55 * remote) * quiet) {
              this.walkedTrack = true;
              this.trackSteps = Math.round(6 + Math.random() * 20 * remote);
              this.tx = this.x;
              this.ty = this.y;
              event = "track";
            }
          }
        }
      }
    }
    return event;
  }

  animate(dt: number) {
    this.time += dt;
    const walking = this.moved > 0.01;
    this.stride += this.moved * 0.45;
    this.moved = 0;
    if (!walking) {
      this.moodTimer -= dt;
      if (this.moodTimer <= 0) {
        this.grazing = Math.random() < 0.7;
        this.moodTimer = 1.5 + Math.random() * 3;
        if (!this.grazing) {
          this.earTimer = 0.4;
        }
      }
    }

    const approach = (v: number, target: number, rate: number) => v + (target - v) * Math.min(1, dt * rate);
    this.amp = approach(this.amp, walking ? 1 : 0, 6);
    this.facing = approach(this.facing, this.targetFacing, 7);
    const headTarget = walking ? 0 : this.grazing ? 0.8 + Math.sin(this.time * 7) * 0.06 : -0.12;
    this.headAngle = approach(this.headAngle, headTarget, 3);

    this.earTimer -= dt;
    this.tailTimer -= dt;
    if (this.tailTimer < -2 && Math.random() < dt * 0.5) {
      this.tailTimer = 0.5;
    }
    if (this.earTimer < -3 && Math.random() < dt * 0.3) {
      this.earTimer = 0.4;
    }
    const earFlick = this.earTimer > 0 ? Math.sin(this.earTimer * 40) * 0.5 : 0;
    const tailFlick = this.tailTimer > 0 ? Math.sin(this.tailTimer * 30) * 0.6 : 0;

    this.body.pose(this.stride, this.amp, this.headAngle, earFlick, tailFlick, Math.sin(this.time * 2.2));
    this.sprite.scale.x = this.facing;
    this.sprite.position.set(this.x, this.y);
  }
}

/** The rail line as one polyline in world pixels, joined from the map's rail segments. */
function railPath(map: GameMap): [number, number][] {
  const parts = map.lines.filter((l) => l.kind === "rail").map((l) => l.pts.map(([x, y]) => [x * PX, y * PX] as [number, number]));
  if (parts.length === 0) {
    return [];
  }
  const length = (p: [number, number][]) => p.reduce((s, q, i) => (i ? s + Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) : 0), 0);
  parts.sort((a, b) => length(b) - length(a));
  let chain = parts.shift()!;
  const near = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]) < PX * 0.6;
  for (let grew = true; grew; ) {
    grew = false;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const [head, tail] = [chain[0], chain[chain.length - 1]];
      let joined: [number, number][] | null = null;
      if (near(tail, p[0])) joined = [...chain, ...p.slice(1)];
      else if (near(tail, p[p.length - 1])) joined = [...chain, ...p.slice(0, -1).reverse()];
      else if (near(head, p[p.length - 1])) joined = [...p.slice(0, -1), ...chain];
      else if (near(head, p[0])) joined = [...p.slice(1).reverse(), ...chain];
      if (joined) {
        chain = joined;
        parts.splice(i, 1);
        grew = true;
        break;
      }
    }
  }
  return chain;
}

function drawCarriage(front: boolean, back: boolean): Graphics {
  const g = new Graphics()
    .roundRect(-10, -4, 20, 8, 3)
    .fill(0xc8342b)
    .stroke({ width: 1, color: 0x5a1612 })
    .rect(-8.5, -1.2, 17, 2.4)
    .fill(0xfafafa)
    .rect(-7, -3, 14, 1)
    .fill(0x8f97a3);
  if (front) {
    g.roundRect(7, -3, 2.5, 6, 1).fill(0x23323d);
  }
  if (back) {
    g.roundRect(-9.5, -3, 2.5, 6, 1).fill(0x23323d);
  }
  return g;
}

class Train {
  readonly sprite = new Container();
  private readonly cars: Graphics[];
  private readonly cumulative: number[] = [0];
  private readonly stops: number[];
  private d: number;
  private dir = 1;
  private wait = 0;
  private lastStop = -1;
  readonly length: number;

  constructor(
    private readonly path: [number, number][],
    stations: { x: number; y: number }[],
    private readonly bubbles: Bubbles,
  ) {
    for (let i = 1; i < path.length; i++) {
      this.cumulative.push(this.cumulative[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
    }
    this.length = this.cumulative[this.cumulative.length - 1];
    this.stops = stations
      .map((s) => {
        let best = 0;
        let bestD = Infinity;
        path.forEach((p, i) => {
          const dd = Math.hypot(p[0] - s.x, p[1] - s.y);
          if (dd < bestD) {
            bestD = dd;
            best = i;
          }
        });
        return bestD < PX * 4 ? this.cumulative[best] : -1;
      })
      .filter((d) => d >= 0);
    this.cars = [0, 1, 2, 3].map((i) => drawCarriage(i === 0, i === 3));
    this.sprite.addChild(...this.cars);
    this.d = this.length * 0.1;
  }

  private at(d: number): { x: number; y: number; angle: number } {
    d = Math.max(0, Math.min(this.length, d));
    let i = 1;
    while (i < this.cumulative.length - 1 && this.cumulative[i] < d) i++;
    const [a, b] = [this.path[i - 1], this.path[i]];
    const seg = this.cumulative[i] - this.cumulative[i - 1] || 1;
    const t = (d - this.cumulative[i - 1]) / seg;
    return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, angle: Math.atan2(b[1] - a[1], b[0] - a[0]) };
  }

  position() {
    return this.at(this.d);
  }

  update(dt: number) {
    if (this.wait > 0) {
      this.wait -= dt;
      if (this.wait <= 0) {
        this.bubbles.say(Math.random() < 0.2 ? "Tuut! (8 min forsinket)" : "Tuut tuut!", () => {
          const p = this.position();
          return { x: p.x, y: p.y - 6 };
        }, 2.5);
      }
    } else {
      const ahead = this.stops.filter((s) => (s - this.d) * this.dir > 0.5 && s !== this.lastStop);
      const next = ahead.length ? ahead.reduce((a, b) => (Math.abs(a - this.d) < Math.abs(b - this.d) ? a : b)) : null;
      const toEnd = this.dir > 0 ? this.length - this.d : this.d;
      const brake = Math.min(next === null ? Infinity : Math.abs(next - this.d), toEnd);
      const speed = Math.max(6, Math.min(45, brake * 0.6));
      this.d += this.dir * speed * dt;
      if (next !== null && (next - this.d) * this.dir <= 0.5) {
        this.d = next;
        this.lastStop = next;
        this.wait = 4;
      } else if (this.d <= 0 || this.d >= this.length) {
        this.d = Math.max(0, Math.min(this.length, this.d));
        this.dir = -this.dir;
        this.lastStop = -1;
        this.wait = 6;
      }
    }
    this.cars.forEach((car, i) => {
      const p = this.at(this.d - this.dir * i * 21);
      car.position.set(p.x, p.y);
      car.rotation = p.angle;
    });
  }
}

export class Whimsy {
  readonly layer = new Container();
  /** Speech bubbles; the caller puts them above the night overlay so they stay readable. */
  readonly bubbleLayer = new Container();
  private readonly smoke = new Graphics();
  private readonly bubbles: Bubbles;
  readonly moose: Moose[] = [];
  private readonly chimneys: { x: number; y: number; phase: number }[] = [];
  readonly train: Train | null;
  readonly remote: Float32Array;
  private time = 0;
  detail = true;

  constructor(private readonly map: GameMap) {
    this.bubbles = new Bubbles(this.bubbleLayer);

    const path = railPath(map);
    const stations = map.pois.filter((p) => p.kind === "station").map((p) => ({ x: (p.x + 0.5) * PX, y: (p.y + 0.5) * PX }));
    this.train = path.length > 1 ? new Train(path, stations, this.bubbles) : null;

    for (let ty = 0; ty < map.height; ty++) {
      for (let tx = 0; tx < map.width; tx++) {
        if (map.has(tx, ty, Flag.Building) && !map.has(tx, ty, Flag.Road) && hash(tx, ty, 90) < 0.18) {
          const h = housePosition(tx, ty);
          this.chimneys.push({ x: h.x + 10.7, y: h.y - 14, phase: hash(tx, ty, 91) });
        }
      }
    }

    this.remote = remoteness(map);
    const wilds: [number, number][] = [];
    for (let ty = 0; ty < map.height; ty++) {
      for (let tx = 0; tx < map.width; tx++) {
        if (map.terrainAt(tx, ty) === Terrain.Forest && map.flags[map.index(tx, ty)] === 0 && this.remote[map.index(tx, ty)] > 0.5) {
          wilds.push([tx, ty]);
        }
      }
    }
    for (let i = 0; i < 9 && wilds.length; i++) {
      const [tx, ty] = wilds[Math.floor(hash(i, 7, 92) * wilds.length)];
      this.moose.push(new Moose(map, this.remote, (tx + 0.5) * PX, (ty + 0.5) * PX));
    }

    this.layer.addChild(this.smoke, ...this.moose.map((m) => m.sprite));
    if (this.train) {
      this.layer.addChild(this.train.sprite);
    }
  }

  /** Clicking a moose makes it talk. Returns true when the click landed on one. */
  poke(wx: number, wy: number): boolean {
    const m = this.moose.find((m) => Math.hypot(m.x - wx, m.y - 12 - wy) < 18);
    if (!m || !this.detail) {
      return false;
    }
    this.bubbles.say(MOOSE_QUOTES[Math.floor(Math.random() * MOOSE_QUOTES.length)], () => ({ x: m.x, y: m.y - 30 }));
    return true;
  }

  /** The moose live in game time: they stand still when the game is paused. */
  simulate(hours: number, tracks: TrackNetwork, now: number, peopleNear: (x: number, y: number) => boolean) {
    const steps = Math.max(1, Math.ceil(hours / 0.05));
    for (const m of this.moose) {
      for (let i = 0; i < steps; i++) {
        if (m.simulate(hours / steps, tracks, now, peopleNear) === "track" && this.detail && Math.random() < 0.3) {
          this.bubbles.say(TRAMPLE_QUOTES[Math.floor(Math.random() * TRAMPLE_QUOTES.length)], () => ({ x: m.x, y: m.y - 30 }));
        }
      }
    }
  }

  update(dt: number, view: View) {
    this.time += dt;
    for (const m of this.moose) {
      m.animate(dt);
      m.sprite.visible = this.detail;
    }
    this.train?.update(dt);
    this.bubbles.update(dt);

    this.smoke.clear();
    if (!this.detail) {
      return;
    }
    for (const c of this.chimneys) {
      if (c.x < view.x0 || c.x > view.x1 || c.y < view.y0 - 30 || c.y > view.y1) {
        continue;
      }
      for (let k = 0; k < 4; k++) {
        const t = (this.time * 0.3 + c.phase + k / 4) % 1;
        this.smoke.circle(c.x + t * 9 + Math.sin((t + c.phase) * 9) * 1.5, c.y - t * 22, 1.8 + t * 3.8);
        this.smoke.fill({ color: 0x8f9bb0, alpha: 0.75 * (1 - t) });
      }
    }
  }
}

export type PrecipKind = "snow" | "rain" | "none";

/** Screen-space snow or rain over the whole view, as heavy as the weather says. */
export class Precipitation {
  readonly layer = new Graphics();
  private flakes: { x: number; y: number; r: number; v: number; phase: number }[] = [];
  enabled = true;

  constructor(count = 260) {
    for (let i = 0; i < count; i++) {
      this.flakes.push({ x: Math.random(), y: Math.random(), r: 0.8 + Math.random() * 1.8, v: 0.03 + Math.random() * 0.05, phase: Math.random() * 6 });
    }
  }

  /** intensity: 0 … 1, roughly mm per hour / 2. */
  update(dt: number, width: number, height: number, kind: PrecipKind, intensity: number) {
    this.layer.clear();
    const active = this.enabled && kind !== "none" ? Math.round(this.flakes.length * Math.min(1, intensity)) : 0;
    this.layer.visible = active > 0;
    if (active === 0) {
      return;
    }
    const rain = kind === "rain";
    for (let i = 0; i < active; i++) {
      const f = this.flakes[i];
      f.y += f.v * dt * (rain ? 9 : 0.6 + f.r * 0.3);
      f.phase += dt;
      if (f.y > 1.02) {
        f.y = -0.02;
        f.x = Math.random();
      }
      const x = f.x * width;
      const y = f.y * height;
      if (rain) {
        this.layer.moveTo(x, y).lineTo(x - 3, y + 9 + f.r * 3);
      } else {
        this.layer.circle(x + Math.sin(f.phase) * 8 * f.r, y, f.r);
      }
    }
    if (rain) {
      this.layer.stroke({ width: 1.1, color: 0x6f86a8, alpha: 0.6 });
    } else {
      this.layer.fill({ color: 0xffffff, alpha: 0.9 });
      this.layer.stroke({ width: 0.8, color: 0x7f93b3, alpha: 0.55 });
    }
  }
}
