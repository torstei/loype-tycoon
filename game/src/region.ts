import { GameMap, Poi } from "./map";

/** A point in degrees, as copied from any web map. */
export type LatLon = { lat: number; lon: number };
/** A spot on the map: a named place on it (of a kind, when several share the name), or a point. */
export type Spot = { place: string; kind?: Poi["kind"] } | LatLon;

/** The local names the game uses in its texts. */
export interface Names {
  /** The local paper, which comes out on Thursdays. */
  newspaper: string;
  /** The Facebook group where skiers and the snowcat driver post. */
  group: string;
  /** The other, unofficial group quoted in the ski report. */
  unofficialGroup: string;
  /** The railway through the map. */
  railway: string;
  /** Where the trains go, one way and the other. */
  trainEnds: string[];
  /** The alpine slopes and their lifts. */
  skiArea: string;
  /** The shooting club whose members can run the waffle stand at weekends. */
  waffleClub: string;
}

/**
 * maps/<name>.region.json: what a person decides about a map, kept apart from the generated map
 * so that regenerating it loses nothing. Every field is optional.
 */
export interface RegionFile {
  title?: string;
  start?: Spot;
  names?: Partial<Names>;
  /** Metres above sea level: the valley floor the weather is for, and a height that keeps its snow longer. */
  climate?: { valley?: number; high?: number };
  /** A house whose Christmas lights the whole place drives past in December. */
  christmasHouse?: Spot & { street: string };
  /** Corrections to the places on the generated map. */
  places?: {
    rename?: Record<string, string>;
    hide?: string[];
    add?: (LatLon & { kind: Poi["kind"]; name: string })[];
  };
}

export interface Region {
  title: string;
  /** The tile the game starts at. */
  start: [number, number];
  names: Names;
  climate: { valley: number; high: number };
  christmasHouse: { x: number; y: number; street: string } | null;
  /** Whether a railway crosses the map, so there is a train to write about. */
  railwayOnMap: boolean;
}

/** The region being played, filled in by applyRegion before the game starts. */
export const region: Region = {
  title: "",
  start: [0, 0],
  names: { newspaper: "", group: "", unofficialGroup: "", railway: "", trainEnds: [], skiArea: "", waffleClub: "" },
  climate: { valley: 200, high: 500 },
  christmasHouse: null,
  railwayOnMap: false,
};

/** How much higher the snowy upper slopes are than the valley, when the region file does not say. */
const HIGH_ABOVE_VALLEY = 300;

/**
 * A latitude and longitude in metres east and north on EPSG:25833 (ETRS89 / UTM zone 33N), the
 * projection of the map grid. Agrees with PROJ to the centimetre across mainland Norway.
 */
export function utm33(lat: number, lon: number): [number, number] {
  const a = 6378137;
  const f = 1 / 298.257222101;
  const k0 = 0.9996;
  const e2 = f * (2 - f);
  const n = f / (2 - f);
  const phi = (lat * Math.PI) / 180;
  const dl = ((lon - 15) * Math.PI) / 180;
  // Krüger's series, to the sixth order in n.
  const A = (a / (1 + n)) * (1 + n ** 2 / 4 + n ** 4 / 64);
  const alpha = [n / 2 - (2 / 3) * n ** 2 + (5 / 16) * n ** 3, (13 / 48) * n ** 2 - (3 / 5) * n ** 3, (61 / 240) * n ** 3];
  const e = Math.sqrt(e2);
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - e * Math.atanh(e * Math.sin(phi)));
  const xi = Math.atan2(t, Math.cos(dl));
  const eta = Math.atanh(Math.sin(dl) / Math.sqrt(1 + t * t));
  let x = xi;
  let y = eta;
  alpha.forEach((al, i) => {
    const j = 2 * (i + 1);
    x += al * Math.sin(j * xi) * Math.cosh(j * eta);
    y += al * Math.cos(j * xi) * Math.sinh(j * eta);
  });
  return [500000 + k0 * A * y, k0 * A * x];
}

/** The local tile of a spot, or null when the place is unknown or the point is off the map. */
function locate(map: GameMap, spot: Spot): [number, number] | null {
  if ("place" in spot) {
    const p = map.pois.find((q) => q.name === spot.place && (!spot.kind || q.kind === spot.kind));
    return p ? [p.x, p.y] : null;
  }
  const [east, north] = utm33(spot.lat, spot.lon);
  return map.fromGrid([Math.floor(east / map.grid.size), Math.floor(north / map.grid.size)]);
}

/**
 * Where the game starts when the region file does not say: the station named after the map, else the
 * station, parking or named place nearest the middle of the map, else the middle itself.
 */
function startPoint(map: GameMap, title: string): [number, number] {
  const [mx, my] = [map.width / 2, map.height / 2];
  const nearest = (kind: Poi["kind"]) =>
    map.pois.filter((p) => p.kind === kind && (kind !== "place" || p.name)).sort((a, b) => Math.hypot(a.x - mx, a.y - my) - Math.hypot(b.x - mx, b.y - my))[0];
  const p = map.pois.find((q) => q.kind === "station" && q.name === title) ?? nearest("station") ?? nearest("parking") ?? nearest("place");
  return p ? [p.x, p.y] : [Math.floor(mx), Math.floor(my)];
}

/** Fetch a map's region file; a map without one plays with names made from its title. */
export async function loadRegionFile(name: string): Promise<RegionFile> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}maps/${name}.region.json`);
    return res.ok && res.headers.get("content-type")?.includes("json") ? ((await res.json()) as RegionFile) : {};
  } catch {
    return {};
  }
}

/** Correct the map's places and fill in the region from its file, with defaults for whatever it leaves out. */
export function applyRegion(map: GameMap, file: RegionFile) {
  const places = file.places ?? {};
  for (const p of map.pois) {
    if (p.name && places.rename?.[p.name]) {
      p.name = places.rename[p.name];
    }
  }
  const hidden = new Set(places.hide ?? []);
  map.pois.splice(0, map.pois.length, ...map.pois.filter((p) => !p.name || !hidden.has(p.name)));
  for (const added of places.add ?? []) {
    const at = locate(map, added);
    if (at) {
      map.pois.push({ kind: added.kind, name: added.name, x: at[0], y: at[1] });
    }
  }

  const title = file.title ?? map.title;
  region.title = title;
  region.start = (file.start && locate(map, file.start)) || startPoint(map, title);
  region.names = {
    newspaper: "Lokalavisa",
    group: `Preppestatus ${title}`,
    unofficialGroup: `Skiføre i ${title} (uoffisiell)`,
    railway: "jernbanen",
    trainEnds: [],
    skiArea: "alpinbakken",
    waffleClub: `${title} Skytterlag`,
    ...file.names,
  };
  const valley = file.climate?.valley ?? map.elevationAt(...region.start);
  region.climate = { valley, high: file.climate?.high ?? valley + HIGH_ABOVE_VALLEY };
  const house = file.christmasHouse ? locate(map, file.christmasHouse) : null;
  region.railwayOnMap = map.lines.some((l) => l.kind === "rail");
  region.christmasHouse = house && file.christmasHouse ? { x: house[0], y: house[1], street: file.christmasHouse.street } : null;
}

/** A name for use mid-sentence or at the start of one: "jernbanen" becomes "Jernbanen". */
export const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
