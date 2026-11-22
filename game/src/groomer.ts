import { Container, Graphics, Text } from "pixi.js";
import { GameMap } from "./map";
import { PX } from "./render";
import { TrackNetwork } from "./tracks";
import { Weather } from "./weather";

/** Tiles per game hour: 10 km/h, about what a real snowcat manages. */
const SPEED = 40;
const COST_PER_TILE = 10;
const MAX_SHIFT_HOURS = 10;
const MIN_JOB_TILES = 4;

export const GARAGE_COST = 20_000;
export const GARAGE_WITH_MACHINE_COST = 80_000;

const NAMES = ["Gamle Gunnar", "Snøfrid", "Tråkk-Trine", "Diesel-Dagfinn", "Kari Kjetting", "Preppe-Per"];

export type Schedule = "night" | "always";

type State = "home" | "grooming" | "returning";

export interface Ledger {
  spend(amount: number): boolean;
}

function inWindow(schedule: Schedule, hourOfDay: number): boolean {
  return schedule === "always" || hourOfDay >= 18 || hourOfDay < 7;
}

function drawGarage(): Container {
  const c = new Container();
  const g = new Graphics()
    .ellipse(PX * 0.6, PX * 0.95, PX * 1.1, PX * 0.25)
    .fill({ color: 0x3c548c, alpha: 0.25 })
    .rect(-PX * 0.35, -PX * 0.1, PX * 1.9, PX * 1.0)
    .fill(0xa8382e)
    .stroke({ width: 1, color: 0x4a1a14 })
    .rect(PX * 0.05, PX * 0.25, PX * 1.1, PX * 0.65)
    .fill(0x3a2a26)
    .stroke({ width: 1, color: 0xf4f4f4 })
    .poly([-PX * 0.55, 0, PX * 0.6, -PX * 0.75, PX * 1.75, 0])
    .fill(0xfbfdff)
    .stroke({ width: 1, color: 0x5b6270, join: "round" });
  for (let i = 1; i < 4; i++) {
    g.moveTo(PX * 0.05, PX * (0.25 + i * 0.16)).lineTo(PX * 1.15, PX * (0.25 + i * 0.16));
  }
  g.stroke({ width: 0.6, color: 0x6b5a50 });
  const sign = new Text({
    text: "LØYPELAGET",
    style: { fontFamily: "system-ui, sans-serif", fontSize: 5, fontWeight: "800", fill: 0xffffff },
    resolution: 4,
  });
  sign.anchor.set(0.5, 0.5);
  sign.position.set(PX * 0.6, PX * 0.08);
  c.addChild(g, sign);
  return c;
}

class SnowcatSprite {
  readonly root = new Container();
  readonly body = new Container();
  private readonly treads = new Graphics();
  private readonly beacon = new Graphics();
  private readonly exhaust = new Graphics();
  private treadPhase = 0;
  private time = 0;
  private puffs: { x: number; y: number; age: number }[] = [];

  constructor(colour: number) {
    const hull = new Graphics()
      .roundRect(-12, -5.5, 4.5, 11, 1.5)
      .fill(0x9aa1ab)
      .stroke({ width: 0.8, color: 0x3b3f46 });
    for (let y = -4.5; y <= 4.5; y += 1.5) {
      hull.moveTo(-12, y).lineTo(-13.2, y);
    }
    hull.stroke({ width: 0.6, color: 0x3b3f46 });
    hull
      .roundRect(-6, -4.2, 11, 8.4, 2)
      .fill(colour)
      .stroke({ width: 1, color: 0x3a1410 })
      .roundRect(-0.5, -3.4, 5, 6.8, 1.5)
      .fill(0xf4f6f8)
      .stroke({ width: 0.8, color: 0x3a1410 })
      .roundRect(2.2, -2.8, 2, 5.6, 0.8)
      .fill(0x2b3a4c)
      .roundRect(8, -7.5, 2.2, 15, 1)
      .fill(0xb7bdc6)
      .stroke({ width: 0.8, color: 0x3b3f46 })
      .moveTo(5, -3).lineTo(8, -5.5).moveTo(5, 3).lineTo(8, 5.5)
      .stroke({ width: 0.9, color: 0x3b3f46 });
    this.body.addChild(this.treads, hull, this.beacon);
    this.root.addChild(this.exhaust, this.body);
  }

  update(dt: number, moving: boolean, heading: number, darkness: number) {
    this.time += dt;
    if (moving) {
      this.treadPhase = (this.treadPhase + dt * 14) % 2;
    }
    this.body.rotation = heading;
    this.treads.clear();
    for (const y of [-6.8, 3.6]) {
      this.treads.roundRect(-8, y, 15.5, 3.2, 1.2).fill(0x26292e);
    }
    for (let x = -7.5 + this.treadPhase; x < 7.5; x += 2) {
      for (const y of [-6.8, 3.6]) {
        this.treads.moveTo(x, y).lineTo(x, y + 3.2);
      }
    }
    this.treads.stroke({ width: 0.7, color: 0x5d636c });

    const blink = moving && Math.sin(this.time * 10) > 0;
    this.beacon.clear().circle(-3, 0, 1.6).fill(blink ? 0xffa21f : 0x8a5a1a);
    if (blink && darkness > 0.2) {
      this.beacon.circle(-3, 0, 6).fill({ color: 0xffa21f, alpha: 0.25 * darkness });
    }

    if (moving && Math.random() < dt * 8) {
      const back = { x: Math.cos(heading) * -5, y: Math.sin(heading) * -5 };
      this.puffs.push({ x: back.x, y: back.y - 3, age: 0 });
    }
    this.exhaust.clear();
    for (const p of this.puffs) {
      p.age += dt;
      p.y -= dt * 6;
      p.x += dt * 3;
      this.exhaust.circle(p.x, p.y, 1 + p.age * 3).fill({ color: 0x6e7682, alpha: Math.max(0, 0.5 - p.age * 0.5) });
    }
    this.puffs = this.puffs.filter((p) => p.age < 1);
  }
}

export class Garage {
  readonly sprite: Container;

  constructor(
    readonly x: number,
    readonly y: number,
  ) {
    this.sprite = drawGarage();
    this.sprite.position.set(x * PX, y * PX);
  }

  /** The track tile the machine drives onto, or null if no track comes close enough. */
  entry(tracks: TrackNetwork): [number, number] | null {
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const d = Math.hypot(dx, dy);
        if (tracks.has(this.x + dx, this.y + dy) && d < bestD) {
          best = [this.x + dx, this.y + dy];
          bestD = d;
        }
      }
    }
    return best;
  }
}

export class Groomer {
  readonly sprite: SnowcatSprite;
  state: State = "home";
  status = "I garasjen";
  /** Position in tile units (tile centres at +0.5). */
  px: number;
  py: number;
  private heading = 0;
  private path: [number, number][] = [];
  private shift = 0;
  groomedTonight = 0;
  totalGroomed = 0;

  constructor(
    readonly name: string,
    readonly garage: Garage,
    colour: number,
  ) {
    this.sprite = new SnowcatSprite(colour);
    this.px = garage.x + 0.6;
    this.py = garage.y + 0.5;
    this.sprite.root.visible = false;
  }

  get tile(): [number, number] {
    return [Math.floor(this.px), Math.floor(this.py)];
  }

  update(hours: number, now: number, hourOfDay: number, schedule: Schedule, tracks: TrackNetwork, weather: Weather, ledger: Ledger) {
    if (this.state === "home") {
      this.considerLeaving(now, hourOfDay, schedule, tracks, weather);
      return;
    }
    this.shift += hours;
    let budget = hours * SPEED;
    while (budget > 0 && this.path.length > 0) {
      const [tx, ty] = this.path[0];
      if (!tracks.has(tx, ty) && this.state === "grooming") {
        this.path = [];
        break;
      }
      const cx = tx + 0.5;
      const cy = ty + 0.5;
      const dist = Math.hypot(cx - this.px, cy - this.py);
      if (dist > 1e-6) {
        this.heading = Math.atan2(cy - this.py, cx - this.px);
      }
      if (dist <= budget) {
        this.px = cx;
        this.py = cy;
        budget -= dist;
        this.path.shift();
        if (this.state === "grooming" && tracks.has(tx, ty) && tracks.needsGrooming(tx, ty, weather, now)) {
          if (!ledger.spend(COST_PER_TILE)) {
            this.status = "Tom for dieselpenger, kjører hjem";
            this.headHome(tracks);
            continue;
          }
          tracks.groom(tx, ty, weather, now);
          this.groomedTonight++;
          this.totalGroomed++;
        }
      } else {
        this.px += ((cx - this.px) / dist) * budget;
        this.py += ((cy - this.py) / dist) * budget;
        budget = 0;
      }
    }
    if (this.path.length > 0) {
      return;
    }
    if (this.state === "returning") {
      this.park();
      return;
    }
    const outOfTime = this.shift >= MAX_SHIFT_HOURS || !inWindow(schedule, hourOfDay);
    const next = outOfTime ? null : this.findWork(tracks, weather, now);
    if (next) {
      this.path = next;
      this.status = "Prepper";
    } else {
      this.status = outOfTime ? "Skiftet er over, kjører hjem" : "Ferdig, kjører hjem";
      this.headHome(tracks);
    }
  }

  private considerLeaving(now: number, hourOfDay: number, schedule: Schedule, tracks: TrackNetwork, weather: Weather) {
    const entry = this.garage.entry(tracks);
    if (!entry) {
      this.status = "Garasjen er ikke koblet til løypenettet";
      return;
    }
    if (!inWindow(schedule, hourOfDay)) {
      this.status = "I garasjen (venter på kvelden)";
      return;
    }
    const needy = this.reachable(entry, tracks).filter(([x, y]) => tracks.needsGrooming(x, y, weather, now));
    if (needy.length < MIN_JOB_TILES) {
      this.status = "I garasjen (alt er fint)";
      return;
    }
    this.state = "grooming";
    this.status = "Prepper";
    this.shift = 0;
    this.groomedTonight = 0;
    this.sprite.root.visible = true;
    this.path = [entry];
  }

  private reachable(start: [number, number], tracks: TrackNetwork): [number, number][] {
    const seen = new Set([`${start[0]},${start[1]}`]);
    const out: [number, number][] = [start];
    for (let i = 0; i < out.length; i++) {
      for (const n of tracks.neighbours(...out[i])) {
        const k = `${n[0]},${n[1]}`;
        if (!seen.has(k)) {
          seen.add(k);
          out.push(n);
        }
      }
    }
    return out;
  }

  /** Breadth-first path along the track to the nearest tile matching goal. */
  private pathTo(tracks: TrackNetwork, goal: (x: number, y: number) => boolean): [number, number][] | null {
    const start = this.tile;
    if (!tracks.has(...start)) {
      return null;
    }
    const prev = new Map<string, [number, number] | null>([[`${start[0]},${start[1]}`, null]]);
    const queue: [number, number][] = [start];
    for (let i = 0; i < queue.length; i++) {
      const cur = queue[i];
      if (i > 0 && goal(...cur)) {
        const path: [number, number][] = [];
        for (let p: [number, number] | null = cur; p && (p[0] !== start[0] || p[1] !== start[1]); p = prev.get(`${p[0]},${p[1]}`)!) {
          path.unshift(p);
        }
        return path;
      }
      for (const n of tracks.neighbours(...cur)) {
        const k = `${n[0]},${n[1]}`;
        if (!prev.has(k)) {
          prev.set(k, cur);
          queue.push(n);
        }
      }
    }
    return null;
  }

  private findWork(tracks: TrackNetwork, weather: Weather, now: number): [number, number][] | null {
    const here = this.tile;
    if (tracks.has(...here) && tracks.needsGrooming(...here, weather, now)) {
      return [here];
    }
    return this.pathTo(tracks, (x, y) => tracks.needsGrooming(x, y, weather, now));
  }

  private headHome(tracks: TrackNetwork) {
    this.state = "returning";
    const entry = this.garage.entry(tracks);
    const home: [number, number] = [this.garage.x, this.garage.y];
    const [ex, ey] = entry ?? home;
    const route = entry ? this.pathTo(tracks, (x, y) => x === ex && y === ey) : null;
    this.path = [...(route ?? []), home];
  }

  private park() {
    this.state = "home";
    this.sprite.root.visible = false;
    this.px = this.garage.x + 0.6;
    this.py = this.garage.y + 0.5;
    this.status = `I garasjen (preppet ${((this.groomedTonight * 25) / 1000).toFixed(1)} km sist tur)`;
  }

  animate(dt: number, darkness: number) {
    this.sprite.update(dt, this.state !== "home", this.heading, darkness);
    this.sprite.root.position.set(this.px * PX, this.py * PX);
  }

  /** Headlight cone in world pixels, drawn above the night overlay. */
  drawLights(g: Graphics, darkness: number) {
    if (this.state === "home" || darkness < 0.05) {
      return;
    }
    const x = this.px * PX;
    const y = this.py * PX;
    const a = this.heading;
    const reach = 46;
    const spread = 0.42;
    g.moveTo(x + Math.cos(a) * 8, y + Math.sin(a) * 8)
      .lineTo(x + Math.cos(a - spread) * reach, y + Math.sin(a - spread) * reach)
      .lineTo(x + Math.cos(a + spread) * reach, y + Math.sin(a + spread) * reach)
      .closePath()
      .fill({ color: 0xfff1b0, alpha: 0.28 * darkness });
  }
}

const COLOURS = [0xc8342b, 0xe8791a, 0x2f7d4a, 0x2f5fb0, 0x8a3fa0, 0xc8a02b];

export class Fleet {
  readonly garages: Garage[] = [];
  readonly groomers: Groomer[] = [];
  readonly garageLayer = new Container();
  readonly machineLayer = new Container();
  readonly lights = new Graphics();
  schedule: Schedule = "night";

  constructor(private readonly map: GameMap) {}

  get nextGarageCost(): number {
    return this.garages.length === 0 ? GARAGE_COST : GARAGE_WITH_MACHINE_COST;
  }

  canPlace(x: number, y: number, tracks: TrackNetwork): boolean {
    return (
      this.map.inside(x, y) &&
      !tracks.has(x, y) &&
      tracks.cost(x, y) !== null &&
      !this.garages.some((g) => Math.abs(g.x - x) < 3 && Math.abs(g.y - y) < 3)
    );
  }

  place(x: number, y: number): Groomer {
    const garage = new Garage(x, y);
    this.garages.push(garage);
    this.garageLayer.addChild(garage.sprite);
    const n = this.groomers.length;
    const groomer = new Groomer(NAMES[n % NAMES.length], garage, COLOURS[n % COLOURS.length]);
    this.groomers.push(groomer);
    this.machineLayer.addChild(groomer.sprite.root);
    return groomer;
  }

  update(hours: number, now: number, hourOfDay: number, tracks: TrackNetwork, weather: Weather, ledger: Ledger) {
    if (hours <= 0) {
      return;
    }
    // Long frames at high speed are split so a machine never skips past a junction decision.
    const steps = Math.max(1, Math.ceil(hours / 0.1));
    for (let s = 0; s < steps; s++) {
      for (const g of this.groomers) {
        g.update(hours / steps, now - hours + (s + 1) * (hours / steps), hourOfDay, this.schedule, tracks, weather, ledger);
      }
    }
  }

  animate(dt: number, darkness: number) {
    this.lights.clear();
    for (const g of this.groomers) {
      g.animate(dt, darkness);
      g.drawLights(this.lights, darkness);
    }
  }
}
