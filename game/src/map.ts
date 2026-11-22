import { Flag, Terrain } from "./terrain";

export interface Poi {
  kind: "station" | "parking" | "peak" | "place";
  name: string | null;
  x: number;
  y: number;
}

export interface MapLine {
  kind: "road" | "forest_road" | "rail" | "path" | "stream" | "piste";
  pts: [number, number][];
}

interface MapDocument {
  name: string;
  title: string;
  tileSize: number;
  width: number;
  height: number;
  terrain: number[];
  flags: number[];
  elevation: number[];
  pois: Poi[];
  lines: MapLine[];
  attribution: string;
}

export class GameMap {
  readonly name: string;
  readonly title: string;
  readonly tileSize: number;
  readonly width: number;
  readonly height: number;
  readonly terrain: Uint8Array;
  readonly flags: Uint16Array;
  readonly elevation: Int16Array;
  readonly pois: Poi[];
  readonly lines: MapLine[];
  readonly attribution: string;

  constructor(doc: MapDocument) {
    this.name = doc.name;
    this.title = doc.title;
    this.tileSize = doc.tileSize;
    this.width = doc.width;
    this.height = doc.height;
    this.terrain = Uint8Array.from(doc.terrain);
    this.flags = Uint16Array.from(doc.flags);
    this.elevation = Int16Array.from(doc.elevation);
    this.pois = doc.pois;
    this.lines = doc.lines;
    this.attribution = doc.attribution;
  }

  static async load(name: string): Promise<GameMap> {
    const res = await fetch(`${import.meta.env.BASE_URL}maps/${name}.json`);
    if (!res.ok) {
      throw new Error(`map ${name}: HTTP ${res.status}`);
    }
    return new GameMap(await res.json());
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  index(x: number, y: number): number {
    return y * this.width + x;
  }

  terrainAt(x: number, y: number): Terrain {
    return this.terrain[this.index(x, y)] as Terrain;
  }

  has(x: number, y: number, flag: Flag): boolean {
    return (this.flags[this.index(x, y)] & flag) !== 0;
  }

  elevationAt(x: number, y: number): number {
    return this.elevation[this.index(x, y)];
  }

  /** Steepest gradient to a 4-neighbour, in percent. */
  slopeAt(x: number, y: number): number {
    const h = this.elevationAt(x, y);
    let steepest = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (this.inside(x + dx, y + dy)) {
        steepest = Math.max(steepest, Math.abs(this.elevationAt(x + dx, y + dy) - h));
      }
    }
    return (steepest / this.tileSize) * 100;
  }
}
