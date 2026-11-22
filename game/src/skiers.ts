import { Container, Graphics, Text } from "pixi.js";
import { GameClock, holiday, isWeekend, sunTimes } from "./clock";
import { GameMap } from "./map";
import { PX } from "./render";
import { Flag } from "./terrain";
import { Crossing, roadTraffic, TrackNetwork } from "./tracks";
import { Weather } from "./weather";

export type TrailheadKind = "station" | "parking" | "homes";

export interface Trailhead {
  kind: TrailheadKind;
  name: string;
  x: number;
  y: number;
  /** Station: skiers per train. Parking and homes: skiers per hour at a busy peak. */
  rate: number;
  /** How far away, in tiles, a track still counts as reachable on foot. */
  reach: number;
  entry: [number, number] | null;
  /** Track tiles reachable from the entry. */
  network: number;
  today: number;
}

interface SkierKind {
  name: string;
  speed: number;
  minTiles: number;
  maxTiles: number;
  donation: number;
  /** How much worse a poor track feels to this kind of skier. */
  fussiness: number;
  slopeDislike: number;
  wear: number;
  jacket: number[];
  scale: number;
}

const KINDS: Record<"family" | "fitness" | "racer", SkierKind> = {
  family: { name: "søndagsfamilie", speed: 30, minTiles: 50, maxTiles: 120, donation: 30, fussiness: 0.6, slopeDislike: 1.5, wear: 0.0015, jacket: [0xe8591a, 0xf2c12e, 0x3aa35a, 0xd64a8a], scale: 1.1 },
  fitness: { name: "mosjonist", speed: 48, minTiles: 110, maxTiles: 280, donation: 25, fussiness: 1, slopeDislike: 0.5, wear: 0.002, jacket: [0x2f5fb0, 0xc8342b, 0x23323d, 0x6a3fa0], scale: 1.2 },
  racer: { name: "lycraløper", speed: 70, minTiles: 240, maxTiles: 520, donation: 6, fussiness: 1.8, slopeDislike: 0, wear: 0.003, jacket: [0xf7e01a, 0x18c0d8, 0xff3fa0], scale: 1.2 },
};

const COMPLAINTS = {
  icy: ["Au! Is!", "Hvem har strødd skøytebane her?", "Glassføre. Takk for det."],
  snowed: ["Hvor ble sporet av?", "Brøyt da, folkens!", "Jeg ser ikke sporet!"],
  bare: ["Steinføre…", "Mine stakkars ski!", "Er dette en grusvei?"],
  worn: ["Sporet er helt nedkjørt.", "Har dere glemt løypemaskina?"],
  fresh: ["Nydelig spor!", "Dette er livet!", "Strålende preppet!", "Rett i Vipps-en!"],
  short: ["Var det alt?", "Rundt og rundt og rundt…"],
  road: ["Ta av skiene, ta på skiene…", "Bilene stopper ikke for skiløpere!", "Hvem legger løype over en bilvei?", "Asfalt. Mine stakkars ski."],
  trunk: ["Et vogntog! Et VOGNTOG!", "Jeg har stått her i ti minutter!", "Hvem fant på å legge løypa over Rv. 4?!", "Livet passerte revy. To ganger."],
};

function pick<T>(xs: T[]): T {
  return xs[Math.floor(Math.random() * xs.length)];
}

const PANTS = 0x23323d;
const SKIN = 0xf2c9a0;

export interface Looks {
  beard?: number;
  poles?: boolean;
}

function stick(length: number, width: number, colour: number): Graphics {
  return new Graphics().moveTo(0, 0).lineTo(0, length).stroke({ width, color: colour, cap: "round" });
}

/** Side view, facing right, feet at the origin. */
class SideFigure {
  readonly root = new Container();
  private readonly legs = [0, 1].map(() => stick(5, 1.5, PANTS));
  private readonly arms: Graphics[];
  private readonly poles = [0, 1].map(() => stick(8, 0.6, 0x55606b));

  constructor(jacket: number, hat: number, looks: Looks) {
    this.arms = [0, 1].map(() => stick(3.2, 1.2, jacket));
    const body = new Container();
    const beard = new Graphics();
    if (looks.beard !== undefined) {
      beard.poly([0.2, -5.2, 2.3, -5.4, 1.6, -3.4, 0.6, -3.8]).fill(looks.beard);
    }
    body.addChild(
      new Graphics().roundRect(-1.4, -4.2, 2.8, 4.6, 1.2).fill(jacket).stroke({ width: 0.6, color: 0x1d1d22 }),
      new Graphics()
        .circle(0.6, -5.8, 1.5)
        .fill(SKIN)
        .stroke({ width: 0.5, color: 0x5a3c25 })
        .poly([-1, -6.2, 0.6, -8.2, 2.2, -6.2])
        .fill(hat)
        .circle(0.6, -8.4, 0.7)
        .fill(0xffffff),
      beard,
    );
    body.position.set(0, -5);
    body.rotation = 0.25;
    for (const leg of this.legs) leg.position.set(0, -5);
    for (const arm of this.arms) arm.position.set(0.4, -8.8);
    for (const pole of this.poles) pole.position.set(0.4, -8.8);
    this.root.addChild(this.poles[1], this.arms[1], this.legs[1], this.legs[0], body, this.arms[0], this.poles[0]);
    for (const pole of this.poles) pole.visible = looks.poles !== false;
  }

  pose(s: number) {
    for (const [i, sign] of [[0, 1], [1, -1]] as const) {
      this.legs[i].rotation = -s * 0.45 * sign;
      this.arms[i].rotation = s * 0.9 * sign;
      // Poles plant behind the hand of the arm swinging back.
      this.poles[i].rotation = s * 0.6 * sign + 0.25;
    }
  }
}

/** Seen from in front (coming towards the viewer) or from behind (skiing away). */
class EndFigure {
  readonly root = new Container();
  private readonly legs = [0, 1].map(() => stick(5, 1.5, PANTS));
  private readonly arms: Graphics[];
  private readonly poles = [0, 1].map(() => new Graphics());

  constructor(jacket: number, hat: number, front: boolean, looks: Looks) {
    this.arms = [0, 1].map(() => stick(3.2, 1.2, jacket));
    this.legs.forEach((leg, i) => leg.position.set(i === 0 ? -0.9 : 0.9, -5));
    this.arms.forEach((arm, i) => arm.position.set(i === 0 ? -1.7 : 1.7, -8.6));
    const head = new Graphics().circle(0, -10.4, 1.5).fill(front ? SKIN : 0x6b4a2f).stroke({ width: 0.5, color: 0x5a3c25 });
    if (front) {
      head.circle(-0.55, -10.5, 0.25).circle(0.55, -10.5, 0.25).fill(0x23323d);
      if (looks.beard !== undefined) {
        head.poly([-1.4, -10, 1.4, -10, 0.9, -8.1, 0, -7.6, -0.9, -8.1]).fill(looks.beard);
      }
    }
    head.poly([-1.6, -11, 0, -13, 1.6, -11]).fill(hat).circle(0, -13.2, 0.7).fill(0xffffff);
    const torso = new Graphics().roundRect(-1.7, -9.2, 3.4, 4.6, 1.2).fill(jacket).stroke({ width: 0.6, color: 0x1d1d22 });
    if (!front) {
      torso.roundRect(-1.1, -8.6, 2.2, 2.4, 0.6).fill({ color: 0x000000, alpha: 0.18 });
    }
    this.root.addChild(...this.poles, ...this.legs, torso, ...this.arms, head);
    for (const pole of this.poles) pole.visible = looks.poles !== false;
  }

  pose(s: number) {
    for (const [i, sign] of [[0, 1], [1, -1]] as const) {
      const side = i === 0 ? -1 : 1;
      // Seen end-on, a leg swinging forward mostly just looks shorter.
      this.legs[i].scale.y = 1 - Math.max(0, s * sign) * 0.25;
      this.arms[i].scale.y = 1 - Math.abs(s) * 0.35;
      this.arms[i].rotation = side * (0.25 + Math.max(0, -s * sign) * 0.25) * -1;
      const handX = side * (2.3 + Math.max(0, -s * sign) * 0.6);
      const handY = -6 - Math.max(0, s * sign) * 0.8;
      this.poles[i].clear().moveTo(handX, handY).lineTo(side * 3.4, 0.4 - s * sign * 1.2).stroke({ width: 0.6, color: 0x55606b });
    }
  }
}

/**
 * A little cross-country skier in diagonal stride. Skis and shadow lie on the ground and
 * turn with the track; the upright figure shows its side, front or back depending on heading.
 */
export class SkierSprite {
  readonly root = new Container();
  private readonly ground = new Container();
  private readonly skis = [0, 1].map(() => new Graphics().roundRect(-4.5, -0.55, 9, 1.1, 0.5).fill(0x3b2a20));
  private readonly side: SideFigure;
  private readonly front: EndFigure;
  private readonly back: EndFigure;
  private readonly upright = new Container();

  constructor(jacket: number, hat: number, scale: number, looks: Looks = {}) {
    this.ground.addChild(new Graphics().ellipse(0, 0, 5, 1.6).fill({ color: 0x3c548c, alpha: 0.22 }), ...this.skis);
    this.side = new SideFigure(jacket, hat, looks);
    this.front = new EndFigure(jacket, hat, true, looks);
    this.back = new EndFigure(jacket, hat, false, looks);
    this.upright.addChild(this.side.root, this.front.root, this.back.root);
    this.root.addChild(this.ground, this.upright);
    this.root.scale.set(scale);
  }

  pose(stride: number, heading: number) {
    const s = Math.sin(stride);
    const c = Math.cos(heading);
    const along = Math.sin(heading);
    this.ground.rotation = heading;
    this.skis[0].x = s * 2.2;
    this.skis[1].x = -s * 2.2;
    this.skis[0].y = -0.9;
    this.skis[1].y = 0.9;

    const sideways = Math.abs(c) >= 0.42;
    this.side.root.visible = sideways;
    this.front.root.visible = !sideways && along > 0;
    this.back.root.visible = !sideways && along <= 0;
    if (sideways) {
      this.side.root.scale.x = c < 0 ? -1 : 1;
      this.side.pose(s);
    } else {
      (along > 0 ? this.front : this.back).pose(s);
    }
  }
}

class Skier {
  readonly sprite: SkierSprite;
  px: number;
  py: number;
  private target: [number, number];
  private previous: [number, number] | null = null;
  private readonly visited = new Set<number>();
  private travelled = 0;
  private qualitySum = 0;
  /** Multiplied down a little at every level crossing, a lot at a busy one. */
  private roadMood = 1;
  /** Game hours left standing at the roadside waiting for a gap. */
  private waiting = 0;
  private home: [number, number][] | null = null;
  private stride = Math.random() * 6;
  private readonly lane = (Math.random() - 0.5) * 3;
  private heading = 0;
  private shownHeading = 0;
  done = false;
  satisfaction = 0;
  said = false;

  constructor(
    readonly kind: SkierKind,
    readonly start: [number, number],
    readonly trailhead: Trailhead,
    private readonly goal: number,
  ) {
    this.sprite = new SkierSprite(pick(kind.jacket), pick([0xc8342b, 0x2f5fb0, 0xf2c12e, 0xffffff, 0x3aa35a]), kind.scale);
    this.px = start[0] + 0.5;
    this.py = start[1] + 0.5;
    this.target = start;
  }

  get tile(): [number, number] {
    return [Math.floor(this.px), Math.floor(this.py)];
  }

  update(hours: number, map: GameMap, tracks: TrackNetwork, weather: Weather, say: (s: Skier, text: string) => void) {
    if (this.waiting > 0) {
      const w = Math.min(this.waiting, hours);
      this.waiting -= w;
      hours -= w;
    }
    let budget = hours * this.kind.speed;
    while (budget > 0 && !this.done && this.waiting <= 0) {
      const cx = this.target[0] + 0.5;
      const cy = this.target[1] + 0.5;
      const dist = Math.hypot(cx - this.px, cy - this.py);
      if (dist > 0.05) {
        this.heading = Math.atan2(cy - this.py, cx - this.px);
      }
      if (dist > budget) {
        this.px += ((cx - this.px) / dist) * budget;
        this.py += ((cy - this.py) / dist) * budget;
        this.stride += budget * 2.2;
        return;
      }
      this.px = cx;
      this.py = cy;
      budget -= dist;
      this.stride += dist * 2.2;
      this.arrive(map, tracks, weather, say);
    }
  }

  private arrive(map: GameMap, tracks: TrackNetwork, weather: Weather, say: (s: Skier, text: string) => void) {
    const [x, y] = this.target;
    if (!tracks.has(x, y)) {
      this.finish(0.2);
      return;
    }
    this.travelled++;
    this.visited.add(map.index(x, y));
    const q = tracks.quality(x, y, weather);
    this.qualitySum += Math.pow(q, 0.6 * this.kind.fussiness);
    tracks.wear(x, y, this.kind.wear);
    const atGrade = (t: [number, number] | null) => !!t && tracks.crossing[map.index(t[0], t[1])] === Crossing.AtGrade;
    // Penalties and waiting apply once per crossing, not once per tile of road width.
    if (atGrade([x, y]) && !atGrade(this.previous)) {
      const level = Math.max(tracks.traffic(x, y), ...tracks.neighbours(x, y).filter(atGrade).map(([nx, ny]) => tracks.traffic(nx, ny)));
      const traffic = roadTraffic(level);
      this.roadMood *= traffic.skierPenalty;
      this.waiting = Math.random() * traffic.skierWait;
      if (!this.said && Math.random() < (level >= 3 ? 0.5 : level === 2 ? 0.25 : 0.05)) {
        this.said = true;
        say(this, pick(level >= 3 ? COMPLAINTS.trunk : COMPLAINTS.road));
      }
    } else if (!this.said && Math.random() < 0.015) {
      const c = tracks.condition(x, y, weather);
      if (c !== "ok") {
        this.said = true;
        say(this, pick(COMPLAINTS[c]));
      }
    }

    if (this.home) {
      if (this.home.length === 0) {
        this.finish();
        return;
      }
      this.previous = this.target;
      this.target = this.home.shift()!;
      return;
    }
    if (this.travelled >= this.goal / 2) {
      this.home = pathHome(tracks, [x, y], this.start) ?? [];
      this.previous = this.target;
      this.target = this.home.shift() ?? this.start;
      return;
    }
    const options = tracks.neighbours(x, y).filter(([nx, ny]) => !this.previous || nx !== this.previous[0] || ny !== this.previous[1]);
    const choices = options.length > 0 ? options : tracks.neighbours(x, y);
    if (choices.length === 0) {
      this.finish();
      return;
    }
    const here = map.elevationAt(x, y);
    const weights = choices.map(([nx, ny]) => {
      const fresh = this.visited.has(map.index(nx, ny)) ? 0.25 : 1;
      const climb = Math.max(0, map.elevationAt(nx, ny) - here) / map.tileSize;
      return Math.pow(0.15 + tracks.quality(nx, ny, weather), 2) * fresh * Math.exp(-climb * 10 * this.kind.slopeDislike);
    });
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    let chosen = choices[choices.length - 1];
    for (let i = 0; i < choices.length; i++) {
      r -= weights[i];
      if (r <= 0) {
        chosen = choices[i];
        break;
      }
    }
    this.previous = this.target;
    this.target = chosen;
  }

  /** Done for the day: how happy were they? */
  private finish(penalty = 1) {
    this.done = true;
    const avg = this.travelled > 0 ? this.qualitySum / this.travelled : 0;
    const variety = this.travelled > 0 ? Math.min(1, (this.visited.size / this.travelled) * 1.8) : 0;
    const longEnough = Math.min(1, this.travelled / this.goal + 0.3);
    this.satisfaction = Math.max(0, Math.min(1, avg * (0.7 + 0.3 * variety) * longEnough * penalty * this.roadMood));
  }

  animate(dt: number, visible: boolean) {
    this.sprite.root.visible = visible;
    if (!visible) {
      this.shownHeading = this.heading;
      return;
    }
    // Turn smoothly so the zigzag of tile-to-tile steps reads as one curve.
    let turn = this.heading - this.shownHeading;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    this.shownHeading += turn * Math.min(1, dt * 8);
    this.sprite.pose(this.stride, this.shownHeading);
    const nx = -Math.sin(this.shownHeading) * this.lane;
    const ny = Math.cos(this.shownHeading) * this.lane;
    this.sprite.root.position.set(this.px * PX + nx, this.py * PX + 2 + ny);
  }

  /** A beam on the snow ahead and the lamp itself, drawn above the night overlay. */
  drawHeadlamp(g: Graphics, darkness: number) {
    const { x, y } = this.sprite.root.position;
    const a = this.shownHeading;
    const reach = 32;
    const spread = 0.38;
    g.moveTo(x + Math.cos(a) * 3, y + Math.sin(a) * 3)
      .lineTo(x + Math.cos(a - spread) * reach, y + Math.sin(a - spread) * reach)
      .lineTo(x + Math.cos(a + spread) * reach, y + Math.sin(a + spread) * reach)
      .closePath()
      .fill({ color: 0xfff4c8, alpha: 0.3 * darkness });
    const headY = y - (Math.abs(Math.cos(a)) >= 0.42 ? 11 : 12.5) * this.kind.scale;
    g.circle(x, headY, 3.5).fill({ color: 0xfff4c8, alpha: 0.25 * darkness });
    g.circle(x, headY, 1.2).fill({ color: 0xfffbe8, alpha: darkness });
  }

  get bored(): boolean {
    return this.travelled > 0 && this.visited.size / this.travelled < 0.5;
  }
}

function pathHome(tracks: TrackNetwork, from: [number, number], to: [number, number]): [number, number][] | null {
  const key = (p: [number, number]) => `${p[0]},${p[1]}`;
  const prev = new Map<string, [number, number] | null>([[key(from), null]]);
  const queue: [number, number][] = [from];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    if (cur[0] === to[0] && cur[1] === to[1]) {
      const path: [number, number][] = [];
      for (let p: [number, number] | null = cur; p && key(p) !== key(from); p = prev.get(key(p))!) {
        path.unshift(p);
      }
      return path;
    }
    for (const n of tracks.neighbours(...cur)) {
      if (!prev.has(key(n))) {
        prev.set(key(n), cur);
        queue.push(n);
      }
    }
  }
  return null;
}

function componentOf(tracks: TrackNetwork, start: [number, number]): Set<string> {
  const seen = new Set([`${start[0]},${start[1]}`]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    for (const n of tracks.neighbours(...queue[i])) {
      const k = `${n[0]},${n[1]}`;
      if (!seen.has(k)) {
        seen.add(k);
        queue.push(n);
      }
    }
  }
  return seen;
}

/** Stations, car parks and clusters of houses that skiers set out from. */
export function findTrailheads(map: GameMap): Trailhead[] {
  const heads: Trailhead[] = [];
  for (const p of map.pois) {
    if (p.kind === "station") {
      heads.push({ kind: "station", name: `${p.name} stasjon`, x: p.x, y: p.y, rate: 9, reach: 5, entry: null, network: 0, today: 0 });
    } else if (p.kind === "parking") {
      heads.push({ kind: "parking", name: p.name ? `P ${p.name}` : "Parkering", x: p.x, y: p.y, rate: 8, reach: 4, entry: null, network: 0, today: 0 });
    }
  }
  const cell = 10;
  for (let cy = 0; cy < map.height; cy += cell) {
    for (let cx = 0; cx < map.width; cx += cell) {
      let n = 0;
      let sx = 0;
      let sy = 0;
      for (let y = cy; y < Math.min(map.height, cy + cell); y++) {
        for (let x = cx; x < Math.min(map.width, cx + cell); x++) {
          if (map.has(x, y, Flag.Building)) {
            n++;
            sx += x;
            sy += y;
          }
        }
      }
      if (n >= 6) {
        const x = Math.round(sx / n);
        const y = Math.round(sy / n);
        const near = map.pois
          .filter((p) => p.kind === "place" && p.name)
          .sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
        heads.push({ kind: "homes", name: near ? `boligfeltet ved ${near.name}` : "boligfeltet", x, y, rate: Math.min(6, n * 0.12), reach: 8, entry: null, network: 0, today: 0 });
      }
    }
  }
  return heads;
}

const MEMBERSHIP_FEE = 400;

export interface DayStats {
  skiers: number;
  donations: number;
  members: number;
  satisfaction: number;
  finished: number;
}

export class Crowd {
  readonly layer = new Container();
  readonly bubbles = new Container();
  readonly trailheads: Trailhead[];
  readonly skiers: Skier[] = [];
  /** 0 … 1: what people say about the club's tracks. */
  reputation = 0.5;
  /** The day's føremelding promised more than the tracks could deliver. */
  hype = false;
  readonly lights = new Graphics();
  private darkShare = 0;
  today: DayStats = { skiers: 0, donations: 0, members: 0, satisfaction: 0, finished: 0 };
  private arrivals = new Map<Trailhead, number>();
  private talk: { c: Container; ttl: number; skier: Skier }[] = [];
  private popups: { t: Text; ttl: number }[] = [];

  constructor(
    private readonly map: GameMap,
    private readonly earn: (amount: number) => void,
  ) {
    this.trailheads = findTrailheads(map);
  }

  /** Which trailheads have a track close enough to walk to, and how much track they lead to. */
  connect(tracks: TrackNetwork) {
    const sizes = new Map<string, number>();
    for (const h of this.trailheads) {
      h.entry = null;
      h.network = 0;
      let best = Infinity;
      for (let dy = -h.reach; dy <= h.reach; dy++) {
        for (let dx = -h.reach; dx <= h.reach; dx++) {
          const d = Math.hypot(dx, dy);
          if (d <= h.reach && d < best && tracks.has(h.x + dx, h.y + dy)) {
            best = d;
            h.entry = [h.x + dx, h.y + dy];
          }
        }
      }
      if (h.entry) {
        const key = `${h.entry[0]},${h.entry[1]}`;
        if (!sizes.has(key)) {
          const component = componentOf(tracks, h.entry);
          for (const k of component) {
            sizes.set(k, component.size);
          }
        }
        h.network = sizes.get(key)!;
      }
    }
  }

  /** How keen people are to go skiing right now, 0 … ~3. */
  appetite(clock: GameClock, weather: Weather, tracks: TrackNetwork): number {
    const day = clock.day;
    const h = clock.hourOfDay;
    const { sunrise, sunset } = sunTimes(day);
    const weekend = isWeekend(day);
    const mid = (sunrise + sunset) / 2;
    const bell = (centre: number, half: number) => Math.max(0, 1 - Math.pow((h - centre) / half, 2));
    const daytime = h < sunrise || h > sunset - 0.5 ? 0 : bell(mid, (sunset - sunrise) / 2) * (weekend ? 1 : 0.35);
    // After work, and a few before it: headlamp skiing.
    const evening = bell(18.75, 2.75) * (weekend ? 0.12 : 0.3);
    const early = h < sunrise ? bell(7, 1.3) * (weekend ? 0 : 0.12) : 0;
    const dark = h < sunrise || h > sunset;
    const out = daytime + (dark ? evening + early : 0);
    this.darkShare = out > 0 ? (dark ? 1 : 0) : 0;
    let sky = 1;
    if (weather.precipRate > 0) {
      sky = weather.temperature > 0.8 ? 0.12 : weather.precipRate > 1 ? 0.6 : 0.9;
    } else {
      sky = 1.25;
    }
    if (weather.temperature < -15) {
      sky *= 0.5;
    }
    const km = (tracks.size * this.map.tileSize) / 1000;
    const size = Math.min(2, 0.5 + km / 6);
    return out * holiday(day).factor * sky * size * (0.3 + 1.4 * this.reputation) * (this.hype ? 1.25 : 1);
  }

  update(hours: number, clock: GameClock, weather: Weather, tracks: TrackNetwork) {
    if (hours <= 0) {
      return;
    }
    const appetite = this.appetite(clock, weather, tracks);
    const before = clock.hours - hours;
    const trainArrived = Math.floor(before - 0.25) !== Math.floor(clock.hours - 0.25);
    for (const h of this.trailheads) {
      if (!h.entry || appetite <= 0) {
        continue;
      }
      let n = 0;
      if (h.kind === "station") {
        n = trainArrived ? Math.round(h.rate * appetite * (0.6 + Math.random() * 0.8)) : 0;
      } else {
        const acc = (this.arrivals.get(h) ?? Math.random()) + h.rate * appetite * hours;
        n = Math.floor(acc);
        this.arrivals.set(h, acc - n);
      }
      for (let i = 0; i < n && this.skiers.length < 400; i++) {
        this.spawn(h);
      }
    }

    const say = (s: Skier, text: string) => this.say(s, text);
    for (const s of this.skiers) {
      s.update(hours, this.map, tracks, weather, say);
    }
    for (const s of this.skiers.filter((s) => s.done)) {
      this.leave(s);
    }
  }

  private spawn(h: Trailhead) {
    const r = Math.random();
    const kind = this.darkShare > 0 ? (r < 0.08 ? KINDS.family : r < 0.75 ? KINDS.fitness : KINDS.racer)
      : h.kind === "homes" ? (r < 0.55 ? KINDS.family : r < 0.92 ? KINDS.fitness : KINDS.racer)
      : h.kind === "station" ? (r < 0.35 ? KINDS.family : r < 0.85 ? KINDS.fitness : KINDS.racer)
      : r < 0.3 ? KINDS.family : r < 0.7 ? KINDS.fitness : KINDS.racer;
    // Nobody plans a 10 km trip on a 500 m loop: the trip shrinks to what is on offer.
    const wanted = kind.minTiles + Math.random() * (kind.maxTiles - kind.minTiles);
    const goal = Math.max(10, Math.min(wanted, h.network * 1.6));
    const skier = new Skier(kind, h.entry!, h, goal);
    this.skiers.push(skier);
    this.layer.addChild(skier.sprite.root);
    h.today++;
    this.today.skiers++;
  }

  private leave(s: Skier) {
    this.skiers.splice(this.skiers.indexOf(s), 1);
    s.sprite.root.destroy({ children: true });
    this.talk = this.talk.filter((t) => {
      if (t.skier === s) {
        t.c.destroy({ children: true });
        return false;
      }
      return true;
    });
    if (this.hype && s.satisfaction < 0.7) {
      s.satisfaction *= 0.75;
    }
    const donation = Math.round(s.kind.donation * s.satisfaction * (Math.random() < 0.6 ? 1 : 0));
    this.reputation = Math.max(0.05, this.reputation + (s.satisfaction - this.reputation) * 0.004);
    this.today.finished++;
    this.today.satisfaction += s.satisfaction;
    if (s.satisfaction > 0.6 && Math.random() < 0.03 * s.satisfaction) {
      this.earn(MEMBERSHIP_FEE);
      this.today.members++;
      this.popup(`Nytt medlem! +${MEMBERSHIP_FEE} kr`, s.px * PX, s.py * PX - 14);
    } else if (donation > 0) {
      this.earn(donation);
      this.today.donations += donation;
      this.popup(`+${donation} kr`, s.px * PX, s.py * PX - 14);
    } else if (s.bored && Math.random() < 0.3) {
      this.popup(pick(COMPLAINTS.short), s.px * PX, s.py * PX - 14);
    }
  }

  private say(s: Skier, text: string) {
    if (this.talk.length > 6) {
      return;
    }
    const t = new Text({
      text,
      style: { fontFamily: "system-ui, sans-serif", fontSize: 10, fontWeight: "600", fill: 0x23323d },
      resolution: 3,
    });
    const w = t.width + 8;
    const h = t.height + 4;
    const c = new Container();
    const g = new Graphics()
      .roundRect(-w / 2, -h - 5, w, h, 4)
      .moveTo(-3, -5.5)
      .lineTo(0, 0)
      .lineTo(3, -5.5)
      .fill(0xffffff)
      .roundRect(-w / 2, -h - 5, w, h, 4)
      .stroke({ width: 1, color: 0x23323d });
    t.position.set(-w / 2 + 4, -h - 3);
    c.addChild(g, t);
    this.bubbles.addChild(c);
    this.talk.push({ c, ttl: 3, skier: s });
  }

  private popup(text: string, x: number, y: number) {
    const t = new Text({
      text,
      style: { fontFamily: "system-ui, sans-serif", fontSize: 11, fontWeight: "800", fill: 0x1f8a3a, stroke: { color: 0xffffff, width: 3 } },
      resolution: 3,
    });
    t.anchor.set(0.5, 1);
    t.position.set(x, y);
    this.bubbles.addChild(t);
    this.popups.push({ t, ttl: 1.6 });
  }

  /** Close the books for the day and start a fresh tally. */
  endDay(): DayStats {
    const stats = { ...this.today };
    this.today = { skiers: 0, donations: 0, members: 0, satisfaction: 0, finished: 0 };
    this.hype = false;
    for (const h of this.trailheads) {
      h.today = 0;
    }
    return stats;
  }

  animate(dt: number, detail: boolean, darkness: number) {
    this.lights.clear();
    for (const s of this.skiers) {
      s.animate(dt, detail);
      if (detail && darkness > 0.15) {
        s.drawHeadlamp(this.lights, darkness);
      }
    }
    for (const t of this.talk) {
      t.ttl -= dt;
      t.c.position.set(t.skier.px * PX, t.skier.py * PX - 14);
      t.c.alpha = Math.min(1, t.ttl * 3);
      t.c.visible = detail;
    }
    for (const t of this.talk.filter((t) => t.ttl <= 0)) {
      t.c.destroy({ children: true });
    }
    this.talk = this.talk.filter((t) => t.ttl > 0);
    for (const p of this.popups) {
      p.ttl -= dt;
      p.t.y -= dt * 14;
      p.t.alpha = Math.min(1, p.ttl * 2);
      p.t.visible = detail;
    }
    for (const p of this.popups.filter((p) => p.ttl <= 0)) {
      p.t.destroy();
    }
    this.popups = this.popups.filter((p) => p.ttl > 0);
  }
}
