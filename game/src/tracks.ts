import { GameMap } from "./map";
import { BUILD_COST, Flag, FOREST_ROAD_COST } from "./terrain";
import { Weather } from "./weather";

/** Below this snow depth a groomer only scrapes gravel. */
export const MIN_GROOMING_DEPTH = 15;

/** The tiller needs this much snow (cm) to mill ice without bringing up gravel. */
export const TILLER_DEPTH = 20;

/** Freshly groomed snow sets in this many cold hours; until then it wears much faster. */
export const SETTING_HOURS = 3;

/**
 * How much of the ice the tiller breaks up, by air temperature: best a few degrees below zero; in
 * thaw it makes slush that freezes back to ice, and in hard frost the crystals will not bind.
 */
export function tillerResult(t: number): number {
  if (t > 0) {
    return 0.3;
  }
  if (t > -2) {
    return 0.6;
  }
  if (t >= -12) {
    return 0.9;
  }
  return t >= -18 ? 0.75 : 0.6;
}

/** Steeper than this (in %), no snowcat goes. */
export const MAX_SLOPE = 40;

/** How a track tile gets across a road or the railway. */
export enum Crossing {
  None = 0,
  /** Straight over the road: skis off, look both ways. */
  AtGrade = 1,
  Culvert = 2,
  Bridge = 3,
  /** A bridge or underpass that was already there. */
  Existing = 4,
  /** Under the railway, built by the club at great expense. */
  Underpass = 5,
}

export type Obstacle = "road" | "rail";

export interface CrossingOption {
  type: Crossing;
  name: string;
  price: number;
  note: string;
}

export interface RoadTraffic {
  describe: string;
  levelPrice: number;
  levelNote: string;
  /** Wider roads need longer culverts and bridges. */
  structureFactor: number;
  /** What each level crossing does to a skier's mood. */
  skierPenalty: number;
  /** Longest wait for a gap in the traffic, in game hours. */
  skierWait: number;
  groomerWait: number;
  /** Chance per level crossing that the snowcat holds up the traffic. */
  incident: number;
}

export const ROAD_TRAFFIC: Record<1 | 2 | 3, RoadTraffic> = {
  1: {
    describe: "Lite trafikk. En og annen traktor.",
    levelPrice: 200,
    levelNote: "Helt greit her. Skiløperne knapt merker det, men maskina kan ikke preppe asfalt.",
    structureFactor: 0.6,
    skierPenalty: 0.98,
    skierWait: 0.02,
    groomerWait: 0,
    incident: 0,
  },
  2: {
    describe: "Fylkesvei. Biler i 50–60 km/t.",
    levelPrice: 400,
    levelNote: "Skiløperne må ta av seg skiene og se seg godt for. Maskina kan ikke preppe asfalt.",
    structureFactor: 1,
    skierPenalty: 0.9,
    skierWait: 0.08,
    groomerWait: 0.08,
    incident: 0,
  },
  3: {
    describe: "Riksvei. Vogntog i 70 km/t, døgnet rundt.",
    levelPrice: 1_500,
    levelNote: "Et eventyr. Skiløperne står i kø for en luke i trafikken, og Gunnar likeså. Det vil bli skrevet om i Facebook-gruppa.",
    structureFactor: 2.2,
    skierPenalty: 0.72,
    skierWait: 0.25,
    groomerWait: 0.3,
    incident: 0.04,
  },
};

/** A planovergang: the barriers come down for every train, for skiers and snowcat alike. */
export const RAIL_LEVEL_CROSSING: RoadTraffic = {
  describe: "Planovergang med bommer. Toget kommer når det kommer.",
  levelPrice: 2_500,
  levelNote: "Bommen går ned for hvert tog. Skiløperne venter, Gunnar venter, og maskina kan ikke preppe skinner.",
  structureFactor: 1,
  skierPenalty: 0.85,
  skierWait: 0.15,
  groomerWait: 0.15,
  incident: 0,
};

export function roadTraffic(level: number): RoadTraffic {
  return ROAD_TRAFFIC[Math.max(1, Math.min(3, level)) as 1 | 2 | 3];
}

export function crossingOptions(obstacle: Obstacle, traffic: number, levelCrossing = false): CrossingOption[] {
  if (obstacle === "rail") {
    const underpass = { type: Crossing.Underpass, name: "Undergang under jernbanen", price: 120_000, note: "Jernbaneeieren krever betong, sikring og tre skjemaer i trippel." };
    if (!levelCrossing) {
      return [{ ...underpass, note: `Det eneste lovlige. ${underpass.note}` }];
    }
    return [
      { type: Crossing.AtGrade, name: "Over planovergangen", price: RAIL_LEVEL_CROSSING.levelPrice, note: RAIL_LEVEL_CROSSING.levelNote },
      underpass,
    ];
  }
  const t = roadTraffic(traffic);
  const structure = (price: number) => Math.round((price * t.structureFactor) / 500) * 500;
  return [
    { type: Crossing.AtGrade, name: "Rett over veien", price: t.levelPrice, note: t.levelNote },
    { type: Crossing.Culvert, name: "Kulvert under veien", price: structure(18_000), note: "Sporet går under veien. Ingen klager." },
    { type: Crossing.Bridge, name: "Skibru over veien", price: structure(30_000), note: "Flott utsikt over trafikken. Folk elsker en bru." },
  ];
}

export const CROSSING_NAMES: Record<Crossing, string> = {
  [Crossing.None]: "",
  [Crossing.AtGrade]: "rett over veien eller skinnene",
  [Crossing.Culvert]: "kulvert under veien",
  [Crossing.Bridge]: "skibru over veien",
  [Crossing.Existing]: "eksisterende bru/undergang",
  [Crossing.Underpass]: "undergang under jernbanen",
};
const ORTHOGONAL = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAGONAL = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const NEIGHBOURS = [...ORTHOGONAL, ...DIAGONAL];

export type Condition = "fresh" | "ok" | "worn" | "snowed" | "icy" | "bare";

export const CONDITION_NAMES: Record<Condition, string> = {
  fresh: "nypreppet",
  ok: "grei",
  worn: "slitt",
  snowed: "nedsnødd",
  icy: "isete",
  bare: "for lite snø",
};

export class TrackNetwork {
  private readonly tiles = new Set<number>();
  /** Per-tile state, indexed like the map. Only meaningful where there is track. */
  readonly fresh: Float32Array;
  readonly newSnow: Float32Array;
  readonly ice: Float32Array;
  readonly wet: Float32Array;
  /** Hours freshly groomed snow still needs, cold and left alone, before it has set. */
  readonly setting: Float32Array;
  /** How well the tiller broke up the ice at the last grooming, 0 … 1; -1 where there was no ice to mill. */
  readonly tilled: Float32Array;
  readonly groomedAt: Float64Array;
  readonly crossing: Uint8Array;
  readonly trampledAt: Float64Array;
  /** Recent skier passes, fading with a half-life of about 17 game hours. */
  readonly usage: Float32Array;

  constructor(private readonly map: GameMap) {
    const n = map.width * map.height;
    this.fresh = new Float32Array(n);
    this.newSnow = new Float32Array(n);
    this.ice = new Float32Array(n);
    this.wet = new Float32Array(n);
    this.setting = new Float32Array(n);
    this.tilled = new Float32Array(n).fill(-1);
    this.groomedAt = new Float64Array(n).fill(-Infinity);
    this.crossing = new Uint8Array(n);
    this.trampledAt = new Float64Array(n).fill(-Infinity);
    this.usage = new Float32Array(n);
  }

  has(x: number, y: number): boolean {
    return this.map.inside(x, y) && this.tiles.has(this.map.index(x, y));
  }

  traffic(x: number, y: number): number {
    return this.map.traffic(x, y);
  }

  roadName(x: number, y: number): string | null {
    return this.map.roadName(x, y);
  }

  index(x: number, y: number): number {
    return this.map.index(x, y);
  }

  /** What has to be crossed here, or null if the tile is open ground or already has a passage. */
  /**
   * Roads and forest roads are built to be driven, so the snowcat follows them whatever the
   * terrain beside them does; at 25 m a road in a cutting looks like a cliff.
   */
  graded(x: number, y: number): boolean {
    return this.map.has(x, y, Flag.Road) || this.map.has(x, y, Flag.ForestRoad);
  }

  /** An unploughed forest road away from the main roads: ready-made track. */
  onForestRoad(x: number, y: number): boolean {
    return this.map.has(x, y, Flag.ForestRoad) && !this.map.has(x, y, Flag.Road) && !this.map.has(x, y, Flag.Rail);
  }

  /** A planovergang: the one place the railway may be crossed on the level. */
  levelCrossing(x: number, y: number): boolean {
    return this.map.inside(x, y) && this.map.has(x, y, Flag.LevelCrossing);
  }

  /** A bridge or underpass that carries a road: track there has to share the asphalt. */
  passageOnRoad(x: number, y: number): boolean {
    return this.map.inside(x, y) && this.map.has(x, y, Flag.Passage) && this.map.has(x, y, Flag.Road);
  }

  /** What an at-grade crossing here does to skiers and snowcats, taking the busiest road of the crossing. */
  atGradeTraffic(x: number, y: number): RoadTraffic {
    if (this.map.has(x, y, Flag.Rail) && !this.map.has(x, y, Flag.Passage)) {
      return RAIL_LEVEL_CROSSING;
    }
    const atGrade = ([nx, ny]: [number, number]) => this.crossing[this.index(nx, ny)] === Crossing.AtGrade;
    return roadTraffic(Math.max(this.traffic(x, y), ...this.neighbours(x, y).filter(atGrade).map(([nx, ny]) => this.traffic(nx, ny))));
  }

  obstacle(x: number, y: number): Obstacle | null {
    if (!this.map.inside(x, y) || this.map.has(x, y, Flag.Passage)) {
      return null;
    }
    return this.map.has(x, y, Flag.Rail) ? "rail" : this.map.has(x, y, Flag.Road) ? "road" : null;
  }

  /** Price of a new track tile before any crossing, or null where track cannot go. */
  cost(x: number, y: number): number | null {
    if (!this.map.inside(x, y)) {
      return null;
    }
    const corridor = this.map.has(x, y, Flag.Rail) || this.map.has(x, y, Flag.Road);
    // A house touching the edge of a road tile does not stand on the road itself.
    if (this.map.has(x, y, Flag.Building) && !corridor) {
      return null;
    }
    // Roads and the railway run through built-up land; crossing them is priced separately.
    const base = BUILD_COST[this.map.terrainAt(x, y)] ?? (corridor ? 150 : null);
    if (base === null) {
      return null;
    }
    if (this.onForestRoad(x, y)) {
      return FOREST_ROAD_COST;
    }
    const slope = this.map.slopeAt(x, y);
    if (slope > MAX_SLOPE && !this.graded(x, y)) {
      return null;
    }
    const road = this.passageOnRoad(x, y) ? roadTraffic(this.traffic(x, y)).levelPrice : 0;
    return Math.round(base * (1 + Math.min(slope, MAX_SLOPE) / 16)) + road;
  }

  /** Why track cannot be built here, in words for the player; null where cost() allows it. */
  blockReason(x: number, y: number): string | null {
    if (!this.map.inside(x, y)) {
      return "Utenfor kartet";
    }
    const corridor = this.map.has(x, y, Flag.Rail) || this.map.has(x, y, Flag.Road);
    if (this.map.has(x, y, Flag.Building) && !corridor) {
      return "Det står et hus her";
    }
    if (BUILD_COST[this.map.terrainAt(x, y)] === null && !corridor) {
      return "Tettbebyggelse: hager, innkjørsler og naboer som klager";
    }
    if (this.map.slopeAt(x, y) > MAX_SLOPE && !this.graded(x, y)) {
      return `For bratt (${Math.round(this.map.slopeAt(x, y))} %) — løypemaskina klarer maks ${MAX_SLOPE} %`;
    }
    return null;
  }

  add(x: number, y: number, crossing = Crossing.None) {
    const i = this.map.index(x, y);
    this.tiles.add(i);
    const passage = this.map.has(x, y, Flag.Passage) && (this.map.has(x, y, Flag.Rail) || this.map.has(x, y, Flag.Road));
    // Through an existing bridge or underpass the track either has the structure to itself or shares the road on it.
    this.crossing[i] = !passage ? crossing : this.passageOnRoad(x, y) ? Crossing.AtGrade : Crossing.Existing;
    // A new track is just a line of footprints until a groomer has been along.
    this.fresh[i] = 0.35;
    this.newSnow[i] = 0;
    this.ice[i] = 0;
    this.wet[i] = 0;
    this.setting[i] = 0;
    this.tilled[i] = -1;
    this.groomedAt[i] = -Infinity;
    this.trampledAt[i] = -Infinity;
    this.usage[i] = 0;
  }

  /**
   * The tiles of the crossing a track tile is part of: track straight across the same road or
   * railway, one tile to the next, all built the same way. Null where the tile crosses nothing.
   */
  crossingAt(x: number, y: number): [number, number][] | null {
    const obstacle = this.obstacle(x, y);
    if (!this.has(x, y) || !obstacle) {
      return null;
    }
    const type = this.crossing[this.index(x, y)];
    const seen = new Set([this.index(x, y)]);
    const out: [number, number][] = [[x, y]];
    for (let k = 0; k < out.length; k++) {
      for (const [nx, ny] of this.neighbours(...out[k])) {
        const i = this.index(nx, ny);
        if (!seen.has(i) && this.obstacle(nx, ny) === obstacle && this.crossing[i] === type) {
          seen.add(i);
          out.push([nx, ny]);
        }
      }
    }
    return out;
  }

  /** What a crossing straight over could be rebuilt as, each priced for the whole crossing; empty for any other. */
  rebuildOptions(tiles: [number, number][]): CrossingOption[] {
    const [x, y] = tiles[0];
    const obstacle = this.obstacle(x, y);
    if (!obstacle || this.crossing[this.index(x, y)] !== Crossing.AtGrade) {
      return [];
    }
    const traffic = Math.max(...tiles.map(([tx, ty]) => this.traffic(tx, ty)));
    const level = tiles.some(([tx, ty]) => this.levelCrossing(tx, ty));
    return crossingOptions(obstacle, traffic, level)
      .filter((o) => o.type !== Crossing.AtGrade)
      .map((o) => ({ ...o, price: o.price * tiles.length }));
  }

  /** Rebuild a crossing: the new structure carries fresh track that has yet to be groomed. */
  rebuild(tiles: [number, number][], type: Crossing) {
    for (const [x, y] of tiles) {
      this.add(x, y, type);
    }
  }

  neighbours(x: number, y: number): [number, number][] {
    return NEIGHBOURS.map(([dx, dy]) => [x + dx, y + dy] as [number, number]).filter(([nx, ny]) => this.has(nx, ny));
  }

  /** 0 (unskiable) … 1 (perfect corduroy). */
  quality(x: number, y: number, weather: Weather): number {
    const i = this.map.index(x, y);
    if (this.crossing[i] === Crossing.AtGrade) {
      return 0.5;
    }
    const depth = weather.snowDepthAt(this.map.elevationAt(x, y));
    const snowFactor = Math.min(1, depth / MIN_GROOMING_DEPTH);
    // Skis still run in a snowed-in track, just slower: half as good at worst.
    const buried = 1 - 0.5 * Math.min(1, this.newSnow[i] / 15);
    return this.fresh[i] * buried * (1 - 0.6 * this.ice[i]) * snowFactor;
  }

  condition(x: number, y: number, weather: Weather): Condition {
    const i = this.map.index(x, y);
    if (this.crossing[i] === Crossing.AtGrade) {
      return "ok";
    }
    if (weather.snowDepthAt(this.map.elevationAt(x, y)) < MIN_GROOMING_DEPTH * 0.6) {
      return "bare";
    }
    if (this.newSnow[i] >= 4) {
      return "snowed";
    }
    if (this.ice[i] >= 0.5) {
      return "icy";
    }
    const q = this.quality(x, y, weather);
    return q > 0.75 ? "fresh" : q > 0.45 ? "ok" : "worn";
  }

  /** Whether a groomer would make a noticeable difference here. */
  needsGrooming(x: number, y: number, weather: Weather, now: number): boolean {
    const i = this.map.index(x, y);
    if (now - this.groomedAt[i] < 12 || this.crossing[i] === Crossing.AtGrade) {
      return false;
    }
    const depth = weather.snowDepthAt(this.map.elevationAt(x, y));
    return depth >= MIN_GROOMING_DEPTH && (this.newSnow[i] >= 3 || (this.ice[i] >= 0.4 && depth >= TILLER_DEPTH) || this.fresh[i] < 0.7);
  }

  /** A moose walked here: deep hoofprints in the corduroy until the next grooming. */
  trample(x: number, y: number, amount: number, now: number) {
    const i = this.map.index(x, y);
    this.fresh[i] = Math.max(0, this.fresh[i] - amount);
    this.trampledAt[i] = now;
  }

  trampled(x: number, y: number): boolean {
    const i = this.map.index(x, y);
    return this.trampledAt[i] > this.groomedAt[i];
  }

  /** A skier passed: counts towards how busy, and so how un-moosey, this stretch is. */
  use(x: number, y: number) {
    this.usage[this.map.index(x, y)] += 1;
  }

  /** 0 (nobody comes here) … 1 (busy enough that moose keep away). */
  disturbance(x: number, y: number): number {
    return 1 - Math.exp(-this.usage[this.map.index(x, y)] / 15);
  }

  /** Skis wear the corduroy down a little with every pass, and much faster before it has set. */
  wear(x: number, y: number, amount: number) {
    const i = this.map.index(x, y);
    const soft = 1 + 1.5 * Math.min(1, this.setting[i] / SETTING_HOURS);
    this.fresh[i] = Math.max(0, this.fresh[i] - amount * soft);
  }

  groom(x: number, y: number, weather: Weather, now: number) {
    const i = this.map.index(x, y);
    const elevation = this.map.elevationAt(x, y);
    const depth = weather.snowDepthAt(elevation);
    const t = weather.localTemperature(elevation);
    this.fresh[i] = depth >= MIN_GROOMING_DEPTH ? 1 : Math.max(this.fresh[i], depth / MIN_GROOMING_DEPTH * 0.5);
    this.newSnow[i] = 0;
    if (this.ice[i] >= 0.1) {
      const result = depth >= TILLER_DEPTH ? tillerResult(t) : 0.15;
      this.ice[i] *= 1 - result;
      this.tilled[i] = result;
      // Too cold, and the milled crystals stay loose sugar instead of binding.
      if (t < -15 && depth >= TILLER_DEPTH) {
        this.fresh[i] = Math.min(this.fresh[i], 0.8);
      }
    } else {
      this.tilled[i] = -1;
    }
    this.wet[i] *= t > 0 ? 0.8 : 0.5;
    this.setting[i] = SETTING_HOURS;
    this.groomedAt[i] = now;
  }

  /** Let the weather work on every track tile. snow is cm, rain mm, both at the reference elevation. */
  applyWeather(hours: number, weather: Weather, snow: number, rain: number) {
    const fade = Math.exp(-hours / 24);
    for (const i of this.tiles) {
      this.usage[i] *= fade;
      const elevation = this.map.elevation[i];
      const t = weather.localTemperature(elevation);
      const snowHere = t < 0.8 ? snow : 0;
      const rainHere = t < 0.8 ? 0 : rain;
      this.newSnow[i] += snowHere;
      // Sets fastest in frost, slowly around zero, not at all in a thaw.
      const sets = t < -1 ? 1 : t <= 1 ? 0.4 : 0;
      this.setting[i] = Math.max(0, this.setting[i] - hours * sets);
      this.fresh[i] = Math.max(0, this.fresh[i] - hours * 0.006 - weather.wind * hours * 0.0008);
      if (t > 0) {
        this.fresh[i] = Math.max(0, this.fresh[i] - hours * 0.015 * t);
        this.wet[i] = Math.min(1, this.wet[i] + hours * 0.03 * t);
        this.newSnow[i] = Math.max(0, this.newSnow[i] - hours * 0.2 * t);
      }
      if (rainHere > 0) {
        this.fresh[i] = Math.max(0, this.fresh[i] - rainHere * 0.04);
        this.wet[i] = Math.min(1, this.wet[i] + rainHere * 0.15);
      }
      if (t < -1 && this.wet[i] > 0) {
        const freeze = Math.min(this.wet[i], hours * 0.1);
        this.wet[i] -= freeze;
        this.ice[i] = Math.min(1, this.ice[i] + freeze * 0.9);
      }
    }
  }

  remove(x: number, y: number) {
    const i = this.map.index(x, y);
    this.tiles.delete(i);
    this.crossing[i] = Crossing.None;
  }

  get size(): number {
    return this.tiles.size;
  }

  /** A tile whose only links are two perpendicular straight neighbours: drawn as a diagonal shortcut. */
  private isCorner(x: number, y: number): boolean {
    const straight = ORTHOGONAL.filter(([dx, dy]) => this.has(x + dx, y + dy));
    const diagonal = DIAGONAL.some(([dx, dy]) => this.has(x + dx, y + dy));
    return (
      straight.length === 2 &&
      !diagonal &&
      straight[0][0] * straight[1][0] + straight[0][1] * straight[1][1] === 0
    );
  }

  /** Line segments between tile centres, in tile units, with staircase corners cut. */
  segments(): { lines: [number, number, number, number][]; dots: [number, number][] } {
    const lines: [number, number, number, number][] = [];
    const dots: [number, number][] = [];
    for (const [x, y] of this.each()) {
      const corner = this.isCorner(x, y);
      let linked = corner;
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
        if (!this.has(x + dx, y + dy)) {
          continue;
        }
        const diagonal = dx !== 0 && dy !== 0;
        const draw = diagonal
          ? [[x + dx, y], [x, y + dy]].every(([cx, cy]) => !this.has(cx, cy) || this.isCorner(cx, cy))
          : !corner && !this.isCorner(x + dx, y + dy);
        if (draw) {
          lines.push([x + 0.5, y + 0.5, x + dx + 0.5, y + dy + 0.5]);
          linked = true;
        }
      }
      if (!linked) {
        dots.push([x + 0.5, y + 0.5]);
      }
    }
    return { lines, dots };
  }

  *each(): Generator<[number, number]> {
    for (const i of this.tiles) {
      yield [i % this.map.width, Math.floor(i / this.map.width)];
    }
  }
}

/** Tiles on the line between two tiles, so a fast drag leaves no gaps. */
export function* lineTiles(x0: number, y0: number, x1: number, y1: number): Generator<[number, number]> {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    yield [x0, y0];
    if (x0 === x1 && y0 === y1) {
      return;
    }
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}
