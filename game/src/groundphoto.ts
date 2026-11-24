import { GameMap } from "./map";
import { hash } from "./render";
import { Flag, Terrain } from "./terrain";
import { Condition, TrackNetwork } from "./tracks";

/** What a ground-level photo shows: where the camera stands, what it looks at, and the light. */
export interface GroundShot {
  map: GameMap;
  tracks: TrackNetwork;
  /** Camera and the point it looks at, in tile units. */
  camera: [number, number];
  target: [number, number];
  /** 0 at night … 1 in full daylight. */
  daylight: number;
  hour: number;
  snowing: boolean;
  /** How the track looks where it is: grooves crisp, worn, icy or snowed in. */
  condition: (x: number, y: number) => Condition;
  subject?: { kind: "skier" | "snowcat" | "moose"; x: number; y: number; colour?: number };
  /** Coloured Christmas lights on a house tile. */
  festive?: [number, number];
  /** A photo taken to show off the weather: facing the sun, with rays and a lens flare. */
  brag?: boolean;
  /** Street lamps in tile units, for night shots. */
  lamps: [number, number][];
  seed: number;
}

/** Where the winter sun stands at an hour, as a direction on the map (x east, y south). */
export function sunDirection(hour: number): [number, number] {
  const az = ((hour - 12.5) * 15 * Math.PI) / 180;
  return [-Math.sin(az), Math.cos(az)];
}

const W = 480;
const H = 300;
const FOV = (64 * Math.PI) / 180;
const FOCAL = W / 2 / Math.tan(FOV / 2);
const HORIZON = H * 0.44;
const EYE = 1.7;
const TILE = 25;
const MAX_DIST = 5000;
const TREE_RANGE = 420;
const HOUSE_RANGE = 900;
const NEAR = 0.4;

type RGB = [number, number, number];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const scale = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];
const hex = (n: number): RGB => [(n >> 16) & 255, (n >> 8) & 255, n & 255];
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

interface Segment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  len: number;
  kind: "track" | "road" | "forest_road" | "rail";
  /** Track condition at the segment, for how the grooves look. */
  look?: Condition;
}

/** Render a ground-level snapshot of the game world; a small software renderer with a depth buffer. */
export function groundPhoto(shot: GroundShot): HTMLCanvasElement {
  const { map } = shot;
  const cx = shot.camera[0] * TILE;
  const cy = shot.camera[1] * TILE;
  let fx = shot.target[0] * TILE - cx;
  let fy = shot.target[1] * TILE - cy;
  const fl = Math.hypot(fx, fy) || 1;
  fx /= fl;
  fy /= fl;
  // Map y runs south, so turning the forward vector a quarter clockwise points right.
  const rx = -fy;
  const ry = fx;

  const elevAt = (mx: number, my: number): number => {
    const tx = Math.min(map.width - 1.001, Math.max(0, mx / TILE - 0.5));
    const ty = Math.min(map.height - 1.001, Math.max(0, my / TILE - 0.5));
    const x0 = Math.floor(tx);
    const y0 = Math.floor(ty);
    const u = tx - x0;
    const v = ty - y0;
    const e = (x: number, y: number) => map.elevation[map.index(x, y)];
    return (e(x0, y0) * (1 - u) + e(x0 + 1, y0) * u) * (1 - v) + (e(x0, y0 + 1) * (1 - u) + e(x0 + 1, y0 + 1) * u) * v;
  };
  /** Height and its slope east and south at a point, from the same bilinear cell. */
  const surface = (mx: number, my: number): [number, number, number] => {
    const tx = Math.min(map.width - 1.001, Math.max(0, mx / TILE - 0.5));
    const ty = Math.min(map.height - 1.001, Math.max(0, my / TILE - 0.5));
    const x0 = Math.floor(tx);
    const y0 = Math.floor(ty);
    const u = tx - x0;
    const v = ty - y0;
    const i = map.index(x0, y0);
    const e00 = map.elevation[i];
    const e10 = map.elevation[i + 1];
    const e01 = map.elevation[i + map.width];
    const e11 = map.elevation[i + map.width + 1];
    const h = (e00 * (1 - u) + e10 * u) * (1 - v) + (e01 * (1 - u) + e11 * u) * v;
    const gx = ((e10 - e00) * (1 - v) + (e11 - e01) * v) / TILE;
    const gy = ((e01 - e00) * (1 - u) + (e11 - e10) * u) / TILE;
    return [h, gx, gy];
  };
  const eye = elevAt(cx, cy) + EYE;

  // Light: a low winter sun from the south at midday, a blue night, warm at dusk.
  const dl = clamp01(shot.daylight);
  const az = ((shot.hour - 12.5) * 15 * Math.PI) / 180;
  const alt = (Math.max(0.05, dl) * 14 * Math.PI) / 180;
  const sun = { x: -Math.sin(az) * Math.cos(alt), y: Math.cos(az) * Math.cos(alt), z: Math.sin(alt) };
  const overcast = shot.snowing ? 1 : 0;
  const dusk = clamp01(1 - Math.abs(dl - 0.35) / 0.3);
  const night = clamp01(1 - dl / 0.25);
  let skyTop: RGB = mix([90, 138, 206], [150, 160, 175], overcast);
  let skyLow: RGB = mix([214, 228, 240], [196, 202, 210], overcast);
  skyTop = mix(skyTop, [70, 84, 140], dusk * (1 - overcast));
  skyLow = mix(skyLow, [244, 178, 140], dusk * (1 - overcast));
  skyTop = mix(skyTop, [6, 12, 30], night);
  skyLow = mix(skyLow, [28, 42, 76], night);
  const fogColour = skyLow;
  const fogRange = shot.snowing ? 700 : 2600;
  const brightness = 0.25 + 0.75 * dl;
  const lit: RGB = mix(mix([255, 252, 246], [244, 214, 196], dusk), [190, 205, 235], night);
  const shade: RGB = mix([168, 186, 216], [120, 132, 168], night);

  const data = new Uint8ClampedArray(W * H * 4);
  const depth = new Float32Array(W * H).fill(Infinity);
  const put = (i: number, c: RGB) => {
    data[i * 4] = c[0];
    data[i * 4 + 1] = c[1];
    data[i * 4 + 2] = c[2];
    data[i * 4 + 3] = 255;
  };
  const fog = (c: RGB, d: number): RGB => mix(c, fogColour, 1 - Math.exp(-d / fogRange));

  // Sky, with stars on a clear night.
  for (let y = 0; y < H; y++) {
    const c = mix(skyTop, skyLow, clamp01(y / HORIZON) ** 1.5);
    for (let x = 0; x < W; x++) {
      put(y * W + x, c);
    }
  }
  if (night > 0.5 && !shot.snowing) {
    for (let i = 0; i < 160; i++) {
      const x = Math.floor(hash(i, shot.seed, 11) * W);
      const y = Math.floor(hash(i, shot.seed, 12) * HORIZON);
      const b = 120 + hash(i, shot.seed, 13) * 135;
      put(y * W + x, [b, b, b * 1.05]);
    }
  }
  const sunScreen = (() => {
    const z = sun.x * fx + sun.y * fy;
    const x = sun.x * rx + sun.y * ry;
    return z > 0.1 ? { x: W / 2 + (x / z) * FOCAL, y: HORIZON - (sun.z / z) * FOCAL } : null;
  })();
  const showSun = !!sunScreen && dl > 0.4 && !shot.snowing;
  if (sunScreen && showSun) {
    const halo = shot.brag ? 70 : 40;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const d = Math.hypot(x - sunScreen.x, y - sunScreen.y);
        const ray = shot.brag ? Math.max(0, Math.cos(Math.atan2(y - sunScreen.y, x - sunScreen.x) * 8)) ** 6 * Math.exp(-d / 110) * 0.35 : 0;
        const glow = Math.exp(-d / halo) * 0.6 + (d < 7 ? 1 : 0) + ray;
        if (glow > 0.01) {
          const i = (y * W + x) * 4;
          data[i] = Math.min(255, data[i] + 255 * glow);
          data[i + 1] = Math.min(255, data[i + 1] + 235 * glow);
          data[i + 2] = Math.min(255, data[i + 2] + 190 * glow);
        }
      }
    }
  }

  // Lines near the camera: track, roads and railway, bucketed by tile for quick lookups.
  const reach = Math.ceil(TREE_RANGE / TILE) + 2;
  const ctx0 = Math.floor(shot.camera[0]);
  const cty0 = Math.floor(shot.camera[1]);
  const buckets = new Map<number, Segment[]>();
  const addSegment = (s: Segment, pad: number) => {
    const x0 = Math.floor((Math.min(s.ax, s.bx) - pad) / TILE);
    const x1 = Math.floor((Math.max(s.ax, s.bx) + pad) / TILE);
    const y0 = Math.floor((Math.min(s.ay, s.by) - pad) / TILE);
    const y1 = Math.floor((Math.max(s.ay, s.by) + pad) / TILE);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const k = y * 100000 + x;
        const list = buckets.get(k);
        if (list) {
          list.push(s);
        } else {
          buckets.set(k, [s]);
        }
      }
    }
  };
  for (let y = cty0 - reach; y <= cty0 + reach; y++) {
    for (let x = ctx0 - reach; x <= ctx0 + reach; x++) {
      if (!map.inside(x, y) || !shot.tracks.has(x, y)) {
        continue;
      }
      for (const [nx, ny] of shot.tracks.neighbours(x, y)) {
        if (ny * 100000 + nx > y * 100000 + x) {
          const [ax, ay, bx, by] = [(x + 0.5) * TILE, (y + 0.5) * TILE, (nx + 0.5) * TILE, (ny + 0.5) * TILE];
          addSegment({ ax, ay, bx, by, len: Math.hypot(bx - ax, by - ay), kind: "track", look: shot.condition(x, y) }, 6);
        }
      }
    }
  }
  const near = (px: number, py: number) => Math.abs(px - shot.camera[0]) < reach && Math.abs(py - shot.camera[1]) < reach;
  for (const line of map.lines) {
    if (line.kind !== "road" && line.kind !== "forest_road" && line.kind !== "rail") {
      continue;
    }
    for (let i = 1; i < line.pts.length; i++) {
      const [a, b] = [line.pts[i - 1], line.pts[i]];
      if (!near(a[0], a[1]) && !near(b[0], b[1])) {
        continue;
      }
      const [ax, ay, bx, by] = [a[0] * TILE, a[1] * TILE, b[0] * TILE, b[1] * TILE];
      addSegment({ ax, ay, bx, by, len: Math.hypot(bx - ax, by - ay), kind: line.kind }, 8);
    }
  }
  /** The nearest line at a point, with the signed distance across it and the distance along it. */
  const lineAt = (mx: number, my: number): { s: Segment; across: number; along: number; end: boolean } | null => {
    const list = buckets.get(Math.floor(my / TILE) * 100000 + Math.floor(mx / TILE));
    if (!list) {
      return null;
    }
    let best: { s: Segment; across: number; along: number; end: boolean } | null = null;
    for (const s of list) {
      const dx = (s.bx - s.ax) / s.len;
      const dy = (s.by - s.ay) / s.len;
      const raw = (mx - s.ax) * dx + (my - s.ay) * dy;
      const t = Math.max(0, Math.min(s.len, raw));
      const px = s.ax + dx * t;
      const py = s.ay + dy * t;
      const across = (mx - px) * -dy + (my - py) * dx;
      const d = Math.hypot(mx - px, my - py);
      // The track wins where it crosses a road: that is what the photo is about.
      const rank = d - (s.kind === "track" ? 1 : 0);
      if (!best || rank < Math.abs(best.across) - (best.s.kind === "track" ? 1 : 0)) {
        best = { s, across: Math.sign(across || 1) * d, along: t, end: raw !== t };
      }
    }
    return best;
  };
  const HALF_WIDTH = { track: 2.3, road: 3.6, forest_road: 2.4, rail: 2.2 } as const;

  const groundColour = (mx: number, my: number, dist: number, nx: number, ny: number, nz: number): RGB => {
    const tx = Math.floor(mx / TILE);
    const ty = Math.floor(my / TILE);
    const terrain = map.inside(tx, ty) ? map.terrainAt(tx, ty) : Terrain.Forest;
    const ndotl = Math.max(0, nx * sun.x + ny * sun.y + nz * sun.z);
    const light = clamp01(0.35 + ndotl * 1.6 * (1 - overcast * 0.7) + overcast * 0.25);
    let c = mix(shade, lit, light);
    if (terrain === Terrain.Water) {
      c = mix(c, [205, 220, 236], 0.35);
    } else if (terrain === Terrain.Forest && dist > 40) {
      c = mix(c, [150, 168, 182], 0.25);
    }
    if (dist < TREE_RANGE + 40) {
      const line = lineAt(mx, my);
      if (line && Math.abs(line.across) < HALF_WIDTH[line.s.kind] + 1) {
        const a = line.across;
        const w = HALF_WIDTH[line.s.kind];
        const detail = clamp01(1 - dist / 25);
        if (Math.abs(a) > w) {
          c = scale(c, 1.03);
        } else if (line.s.kind === "track") {
          const look = line.s.look ?? "ok";
          const groove = (o: number) => Math.abs(a - o) < 0.06;
          const grooved = !line.end && look !== "snowed" && look !== "bare" && (groove(0.95) || groove(1.25));
          c = mix(c, [226, 236, 250], 0.35);
          if (look === "icy") {
            c = mix(c, [180, 196, 212], 0.55);
          }
          if (grooved) {
            c = mix(c, [120, 140, 175], 0.55 * (0.4 + detail * 0.6));
          } else if (!line.end && a < 0.75 && look !== "snowed" && detail > 0) {
            c = scale(c, 1 + 0.07 * detail * Math.sin((a * 2 * Math.PI) / 0.14));
          }
        } else if (line.s.kind === "rail") {
          const rail = Math.abs(Math.abs(a) - 0.72) < 0.05;
          const sleeper = Math.abs(a) < 1.3 && Math.sin((line.along * 2 * Math.PI) / 0.65) > 0.4;
          c = rail ? [70, 70, 75] : sleeper ? mix(c, [95, 80, 70], 0.6) : mix(c, [140, 135, 135], 0.5);
        } else {
          const wheel = Math.abs(Math.abs(a) - 1.6) < 0.45;
          c = mix(c, line.s.kind === "road" ? [150, 150, 155] : [205, 205, 210], wheel ? 0.75 : 0.45);
        }
      }
    }
    return fog(scale(c, brightness * 0.9 + 0.1), dist);
  };

  // Terrain: march each screen column from the camera outwards (voxel space), filling upwards.
  for (let col = 0; col < W; col++) {
    const ang = Math.atan((col + 0.5 - W / 2) / FOCAL);
    const ca = Math.cos(ang);
    const dx = fx * ca + rx * Math.sin(ang);
    const dy = fy * ca + ry * Math.sin(ang);
    let ybuf = H;
    let dist = NEAR;
    while (dist < MAX_DIST && ybuf > 0) {
      const mx = cx + dx * dist;
      const my = cy + dy * dist;
      const z = dist * ca;
      const tx = Math.floor(mx / TILE);
      const ty = Math.floor(my / TILE);
      const inside = map.inside(tx, ty);
      const [ground, gx, gy] = surface(mx, my);
      let h = ground;
      const canopy = inside && dist > TREE_RANGE && map.terrainAt(tx, ty) === Terrain.Forest && !map.has(tx, ty, Flag.Road);
      if (canopy) {
        h += 16;
      }
      const sy = HORIZON - ((h - eye) / z) * FOCAL;
      const iy = Math.max(0, Math.ceil(sy));
      if (iy < ybuf) {
        let c: RGB;
        if (canopy) {
          const speck = hash(Math.floor(mx / 7), Math.floor(my / 7), 5);
          c = fog(scale(mix([40, 62, 56], [205, 214, 226], 0.25 + speck * 0.3), brightness * 0.9 + 0.1), dist);
        } else {
          const n = Math.hypot(gx, gy, 1);
          c = groundColour(mx, my, dist, -gx / n, -gy / n, 1 / n);
        }
        for (let y = iy; y < ybuf; y++) {
          const i = y * W + col;
          put(i, c);
          depth[i] = z;
        }
        ybuf = iy;
      }
      dist += Math.max(0.03, dist * 0.008);
    }
  }

  // Everything standing up is drawn as triangles with a per-pixel depth test.
  const toCam = (mx: number, my: number, mz: number) => {
    const dx = mx - cx;
    const dy = my - cy;
    return { x: dx * rx + dy * ry, y: mz - eye, z: dx * fx + dy * fy };
  };
  const project = (p: { x: number; y: number; z: number }) => ({ sx: W / 2 + (p.x / p.z) * FOCAL, sy: HORIZON - (p.y / p.z) * FOCAL, iz: 1 / p.z });
  const triangle = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, c: { x: number; y: number; z: number }, colour: RGB) => {
    if (a.z < NEAR || b.z < NEAR || c.z < NEAR) {
      return;
    }
    const pa = project(a);
    const pb = project(b);
    const pc = project(c);
    const minX = Math.max(0, Math.floor(Math.min(pa.sx, pb.sx, pc.sx)));
    const maxX = Math.min(W - 1, Math.ceil(Math.max(pa.sx, pb.sx, pc.sx)));
    const minY = Math.max(0, Math.floor(Math.min(pa.sy, pb.sy, pc.sy)));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(pa.sy, pb.sy, pc.sy)));
    const area = (pb.sx - pa.sx) * (pc.sy - pa.sy) - (pc.sx - pa.sx) * (pb.sy - pa.sy);
    if (Math.abs(area) < 1e-6 || minX > maxX || minY > maxY) {
      return;
    }
    const col = fog(colour, (a.z + b.z + c.z) / 3);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const w0 = ((pb.sx - px) * (pc.sy - py) - (pc.sx - px) * (pb.sy - py)) / area;
        const w1 = ((pc.sx - px) * (pa.sy - py) - (pa.sx - px) * (pc.sy - py)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) {
          continue;
        }
        const z = 1 / (w0 * pa.iz + w1 * pb.iz + w2 * pc.iz);
        const i = y * W + x;
        if (z < depth[i]) {
          depth[i] = z;
          put(i, col);
        }
      }
    }
  };
  const quad = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, c: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }, colour: RGB) => {
    triangle(a, b, c, colour);
    triangle(a, c, d, colour);
  };
  const inView = (mx: number, my: number, range: number) => {
    const p = toCam(mx, my, 0);
    return p.z > NEAR && p.z < range && Math.abs(p.x) < p.z * 0.75 + 20;
  };
  const tone = (c: RGB) => scale(c, brightness * 0.9 + 0.1);

  // Cartoon spruces: puffy tiers with drooping, scalloped branch tips, wavy snow caps and an outline.
  const tree = (mx: number, my: number, height: number, seed: number) => {
    const c = toCam(mx, my, elevAt(mx, my));
    if (c.z < NEAR + 1) {
      return;
    }
    const k = FOCAL / c.z;
    const sx = W / 2 + c.x * k;
    const base = HORIZON - c.y * k;
    const h = height * k;
    const radius = height * 0.3 * k;
    if (h < 1.5 || sx + radius < 0 || sx - radius > W || base - h > H) {
      return;
    }
    const z = c.z;
    const green = fog(tone(mix([34, 74, 52], [56, 96, 64], hash(seed, 1, 3))), z);
    const dark = fog(tone([22, 46, 36]), z);
    const edge = fog(tone([16, 32, 28]), z);
    const snowLit = fog(tone(mix(shade, lit, 0.9)), z);
    const snowShade = fog(tone(mix(shade, lit, 0.45)), z);
    const trunk = fog(tone([92, 62, 44]), z);
    const plot = (x: number, y: number, col: RGB) => {
      if (x < 0 || x >= W || y < 0 || y >= H) {
        return;
      }
      const i = y * W + x;
      if (z < depth[i]) {
        depth[i] = z;
        put(i, col);
      }
    };
    const tw = Math.max(0.6, height * 0.025 * k);
    for (let y = Math.floor(base - h * 0.06); y <= Math.ceil(base); y++) {
      for (let x = Math.floor(sx - tw); x <= Math.ceil(sx + tw); x++) {
        plot(x, y, trunk);
      }
    }
    const tiers = 4;
    const phase = hash(seed, 2, 5) * 6.28;
    for (let t = tiers - 1; t >= 0; t--) {
      const bottom = base - h * (0.04 + t * 0.2);
      const top = t === tiers - 1 ? base - h : base - h * (0.4 + t * 0.2);
      const w = radius * (1 - t * 0.19);
      const droop = h * 0.075;
      const span = bottom - top;
      const scallops = t < 2 ? 2.5 : 1.5;
      for (let y = Math.floor(top); y <= Math.ceil(bottom + droop); y++) {
        const f = Math.min(1, Math.max(0, (y - top) / span));
        const half = w * Math.pow(f, 0.55);
        for (let x = Math.floor(sx - half - 1); x <= Math.ceil(sx + half + 1); x++) {
          const dx = x + 0.5 - sx;
          const u = dx / w;
          const tip = bottom + droop * Math.sqrt(Math.abs(Math.cos(u * Math.PI * scallops)));
          if (Math.abs(dx) > half || y > tip) {
            continue;
          }
          const rim = Math.abs(dx) > half - 1.2 || y > tip - 1.2;
          const snowLine = top + span * (0.38 + 0.13 * Math.sin(u * 7 + phase + t * 1.7));
          let col: RGB;
          if (rim) {
            col = edge;
          } else if (y < snowLine) {
            col = dx > -w * 0.15 ? snowLit : snowShade;
          } else {
            col = dx > w * 0.2 ? green : dark;
          }
          plot(x, y, col);
        }
      }
    }
  };
  // Alpine slopes and lift lines are cleared of forest.
  const clearings: { ax: number; ay: number; bx: number; by: number; half: number }[] = [];
  for (const [lines, half] of [[map.alpine?.slopes ?? [], 22], [map.alpine?.lifts ?? [], 12]] as const) {
    for (const line of lines) {
      for (let i = 1; i < line.pts.length; i++) {
        const [a, b] = [line.pts[i - 1], line.pts[i]];
        clearings.push({ ax: a[0] * TILE, ay: a[1] * TILE, bx: b[0] * TILE, by: b[1] * TILE, half });
      }
    }
  }
  const cleared = (mx: number, my: number) =>
    clearings.some((c) => {
      const [dx, dy] = [c.bx - c.ax, c.by - c.ay];
      const t = clamp01(((mx - c.ax) * dx + (my - c.ay) * dy) / (dx * dx + dy * dy || 1));
      return Math.hypot(mx - c.ax - dx * t, my - c.ay - dy * t) < c.half;
    });
  const blocked = (mx: number, my: number) => {
    const l = lineAt(mx, my);
    return (!!l && Math.abs(l.across) < HALF_WIDTH[l.s.kind] + 2.5) || cleared(mx, my);
  };
  const trees: { x: number; y: number; h: number; seed: number; d: number }[] = [];
  const treeReach = Math.ceil(TREE_RANGE / TILE);
  for (let ty = cty0 - treeReach; ty <= cty0 + treeReach; ty++) {
    for (let tx = ctx0 - treeReach; tx <= ctx0 + treeReach; tx++) {
      if (!map.inside(tx, ty) || map.has(tx, ty, Flag.Building) || map.has(tx, ty, Flag.Rail) || map.has(tx, ty, Flag.Piste)) {
        continue;
      }
      const terrain = map.terrainAt(tx, ty);
      const count = terrain === Terrain.Forest ? 7 : terrain === Terrain.Bog ? 2 : terrain === Terrain.Built ? 1 : terrain === Terrain.Open ? (hash(tx, ty, 9) < 0.3 ? 1 : 0) : 0;
      for (let k = 0; k < count; k++) {
        const mx = (tx + hash(tx, ty, 20 + k)) * TILE;
        const my = (ty + hash(tx, ty, 40 + k)) * TILE;
        if (!inView(mx, my, TREE_RANGE) || blocked(mx, my)) {
          continue;
        }
        trees.push({ x: mx, y: my, h: (terrain === Terrain.Bog ? 5 : 11) + hash(tx, ty, 60 + k) * 11, seed: tx * 31 + ty * 17 + k, d: toCam(mx, my, 0).z });
      }
    }
  }

  // Houses: a box with a snowy gable roof, windows lit after dark.
  const WALLS: RGB[] = [[150, 52, 42], [150, 52, 42], [204, 164, 74], [232, 232, 226], [120, 50, 44]];
  const house = (tx: number, ty: number) => {
    const mx = (tx + 0.5) * TILE;
    const my = (ty + 0.5) * TILE;
    if (!inView(mx, my, HOUSE_RANGE)) {
      return;
    }
    const base = elevAt(mx, my);
    const turn = hash(tx, ty, 77) < 0.5 ? 0 : Math.PI / 2;
    const [ux, uy] = [Math.cos(turn), Math.sin(turn)];
    const [vx, vy] = [-uy, ux];
    const [hl, hw, wall, roof] = [6, 4.5, 5, 3.2];
    const at = (a: number, b: number, z: number) => toCam(mx + ux * a + vx * b, my + uy * a + vy * b, base + z);
    const colour = tone(WALLS[Math.floor(hash(tx, ty, 78) * WALLS.length)]);
    const corners: [number, number][] = [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]];
    for (let i = 0; i < 4; i++) {
      const [a, b] = [corners[i], corners[(i + 1) % 4]];
      quad(at(a[0], a[1], 0), at(b[0], b[1], 0), at(b[0], b[1], wall), at(a[0], a[1], wall), scale(colour, i % 2 ? 0.85 : 1));
      const lit = night > 0.3 && hash(tx, ty, 80 + i) < 0.7;
      const glass: RGB = lit ? [255, 214, 130] : tone([60, 70, 90]);
      const [nx, ny] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const nl = Math.hypot(nx, ny);
      const [ox, oy] = [(nx / nl) * 0.06, (ny / nl) * 0.06];
      for (const f of [0.3, 0.7]) {
        const [wx, wy] = [a[0] + (b[0] - a[0]) * f + ox, a[1] + (b[1] - a[1]) * f + oy];
        const [ex, ey] = [(b[0] - a[0]) * 0.06, (b[1] - a[1]) * 0.06];
        quad(at(wx - ex, wy - ey, 1.8), at(wx + ex, wy + ey, 1.8), at(wx + ex, wy + ey, 3.2), at(wx - ex, wy - ey, 3.2), glass);
      }
    }
    const snow = tone(mix(shade, lit, 0.8));
    quad(at(-hl - 0.4, -hw - 0.4, wall), at(hl + 0.4, -hw - 0.4, wall), at(hl + 0.4, 0, wall + roof), at(-hl - 0.4, 0, wall + roof), scale(snow, 0.92));
    quad(at(-hl - 0.4, hw + 0.4, wall), at(hl + 0.4, hw + 0.4, wall), at(hl + 0.4, 0, wall + roof), at(-hl - 0.4, 0, wall + roof), snow);
    triangle(at(-hl, -hw, wall), at(-hl, hw, wall), at(-hl, 0, wall + roof), colour);
    triangle(at(hl, -hw, wall), at(hl, hw, wall), at(hl, 0, wall + roof), colour);
  };
  const houseReach = Math.ceil(HOUSE_RANGE / TILE);
  for (let ty = cty0 - houseReach; ty <= cty0 + houseReach; ty++) {
    for (let tx = ctx0 - houseReach; tx <= ctx0 + houseReach; tx++) {
      if (map.inside(tx, ty) && map.has(tx, ty, Flag.Building) && !map.has(tx, ty, Flag.Road)) {
        house(tx, ty);
      }
    }
  }
  trees.sort((a, b) => b.d - a.d);
  for (const t of trees) {
    tree(t.x, t.y, t.h, t.seed);
  }

  // The subject of the photo: cartoon shapes in screen space, outlined, drawn back to front.
  const glows: { mx: number; my: number; mz: number; colour: RGB; size: number }[] = [];
  const subject = shot.subject;
  if (subject) {
    const mx = subject.x * TILE;
    const my = subject.y * TILE;
    const ground = elevAt(mx, my);
    const c = toCam(mx, my, ground);
    if (c.z > NEAR + 0.5) {
      const k = FOCAL / c.z;
      const ox = W / 2 + c.x * k;
      const oy = HORIZON - c.y * k;
      const outline = fog(tone([24, 22, 26]), c.z);
      /**
       * Shapes in metres right of and above the subject's feet, later ones in front. The outline goes
       * round the whole figure, and round a shape of its own only where `seam` asks for it.
       */
      const parts: { box: [number, number, number, number]; inside: (u: number, v: number) => boolean; colour: RGB; seam: boolean }[] = [];
      const shape = (x0: number, y0: number, x1: number, y1: number, inside: (u: number, v: number) => boolean, colour: RGB, seam = false) => {
        parts.push({ box: [x0, y0, x1, y1], inside, colour: fog(tone(colour), c.z), seam });
      };
      const paint = () => {
        const u0 = Math.min(...parts.map((p) => p.box[0]));
        const v0 = Math.min(...parts.map((p) => p.box[1]));
        const u1 = Math.max(...parts.map((p) => p.box[2]));
        const v1 = Math.max(...parts.map((p) => p.box[3]));
        const top = (px: number, py: number): number => {
          const [u, v] = [(px + 0.5 - ox) / k, (oy - py - 0.5) / k];
          for (let j = parts.length - 1; j >= 0; j--) {
            if (parts[j].inside(u, v)) {
              return j;
            }
          }
          return -1;
        };
        for (let py = Math.max(0, Math.floor(oy - v1 * k) - 1); py <= Math.min(H - 1, Math.ceil(oy - v0 * k) + 1); py++) {
          for (let px = Math.max(0, Math.floor(ox + u0 * k) - 1); px <= Math.min(W - 1, Math.ceil(ox + u1 * k) + 1); px++) {
            const j = top(px, py);
            const i = py * W + px;
            if (j < 0 || c.z >= depth[i]) {
              continue;
            }
            const around = [top(px - 1, py), top(px + 1, py), top(px, py - 1), top(px, py + 1)];
            const rim = around.some((n) => n < 0 || (parts[j].seam && n < j));
            depth[i] = c.z;
            put(i, rim ? outline : parts[j].colour);
          }
        }
      };
      const ellipse = (u0: number, v0: number, ru: number, rv: number, colour: RGB, seam = false) =>
        shape(u0 - ru, v0 - rv, u0 + ru, v0 + rv, (u, v) => ((u - u0) / ru) ** 2 + ((v - v0) / rv) ** 2 <= 1, colour, seam);
      const capsule = (u0: number, v0: number, u1: number, v1: number, r: number, colour: RGB, seam = false) =>
        shape(Math.min(u0, u1) - r, Math.min(v0, v1) - r, Math.max(u0, u1) + r, Math.max(v0, v1) + r, (u, v) => {
          const [du, dv] = [u1 - u0, v1 - v0];
          const t = clamp01(((u - u0) * du + (v - v0) * dv) / (du * du + dv * dv || 1));
          return Math.hypot(u - u0 - du * t, v - v0 - dv * t) <= r;
        }, colour, seam);
      const rounded = (u0: number, v0: number, u1: number, v1: number, r: number, colour: RGB, seam = false) =>
        shape(u0, v0, u1, v1, (u, v) => {
          const qu = Math.max(Math.abs(u - (u0 + u1) / 2) - ((u1 - u0) / 2 - r), 0);
          const qv = Math.max(Math.abs(v - (v0 + v1) / 2) - ((v1 - v0) / 2 - r), 0);
          return Math.hypot(qu, qv) <= r;
        }, colour, seam);

      if (subject.kind === "skier") {
        const jacket = hex(subject.colour ?? 0xc8342b);
        const trousers: RGB = [44, 48, 64];
        const pole: RGB = [70, 74, 84];
        for (const s of [-1, 1]) {
          capsule(s * 0.12, -0.02, s * 0.1, 0.22, 0.045, [200, 44, 40]);
        }
        for (const s of [-1, 1]) {
          capsule(s * 0.42, 0.02, s * 0.33, 0.92, 0.025, pole);
        }
        capsule(-0.11, 0.06, -0.09, 0.82, 0.085, trousers);
        capsule(0.11, 0.1, 0.09, 0.82, 0.085, trousers, true);
        rounded(-0.23, 0.78, 0.23, 1.42, 0.14, jacket, true);
        for (const s of [-1, 1]) {
          capsule(s * 0.2, 1.3, s * 0.33, 0.95, 0.065, scale(jacket, 0.85), true);
        }
        ellipse(0, 1.55, 0.115, 0.13, [232, 192, 160], true);
        ellipse(0, 1.61, 0.125, 0.09, [240, 200, 40], true);
        ellipse(0, 1.72, 0.05, 0.05, [250, 250, 250], true);
      } else if (subject.kind === "snowcat") {
        const red: RGB = [214, 70, 34];
        const belt: RGB = [46, 46, 52];
        for (const s of [-1, 1]) {
          rounded(s * 1.75 - 0.55, 0.05, s * 1.75 + 0.55, 1.25, 0.4, belt, true);
          for (let j = 0; j < 4; j++) {
            rounded(s * 1.75 - 0.4, 0.3 + j * 0.24, s * 1.75 + 0.4, 0.36 + j * 0.24, 0.03, [92, 92, 100]);
          }
        }
        rounded(-1.3, 0.75, 1.3, 1.95, 0.3, red, true);
        rounded(-1.0, 1.75, 1.0, 2.95, 0.35, scale(red, 0.92), true);
        rounded(-0.75, 2.05, 0.75, 2.75, 0.18, night > 0.3 ? [170, 140, 96] : [70, 96, 130], true);
        ellipse(0, 3.05, 0.14, 0.12, [255, 160, 40], true);
        rounded(-1.85, 0.1, 1.85, 0.55, 0.2, [150, 150, 158], true);
        rounded(-1.8, 0.0, 1.8, 0.14, 0.06, [205, 210, 220], true);
        for (const s of [-1, 1]) {
          ellipse(s * 1.0, 1.45, 0.12, 0.1, [230, 40, 30], true);
        }
        if (night > 0.2) {
          for (const side of [-1.0, 1.0]) {
            glows.push({ mx: mx + rx * side, my: my + ry * side, mz: ground + 1.45, colour: [255, 40, 30], size: 0.12 });
          }
          glows.push({ mx, my, mz: ground + 3.05, colour: [255, 150, 40], size: 0.18 });
          glows.push({ mx: mx + fx * 9, my: my + fy * 9, mz: ground + 0.3, colour: [255, 240, 200], size: 1.6 });
        }
      } else {
        const brown: RGB = [70, 48, 34];
        const legs: RGB = [120, 98, 76];
        for (const [u, back] of [[-0.85, true], [0.75, true], [-0.7, false], [0.9, false]] as [number, boolean][]) {
          capsule(u, 1.05, u + (back ? -0.05 : 0.05), 0.05, 0.09, back ? scale(legs, 0.8) : legs, !back);
        }
        ellipse(-0.05, 1.45, 1.2, 0.48, brown);
        ellipse(0.45, 1.75, 0.6, 0.35, brown);
        capsule(0.95, 1.65, 1.35, 1.9, 0.22, brown);
        ellipse(1.6, 1.82, 0.32, 0.2, brown);
        ellipse(1.88, 1.74, 0.2, 0.15, scale(brown, 1.2));
        capsule(1.3, 1.62, 1.32, 1.4, 0.06, brown);
        ellipse(1.45, 2.06, 0.08, 0.14, scale(brown, 1.1));
        capsule(-1.2, 1.55, -1.32, 1.35, 0.06, brown);
      }
      paint();
    }
  }

  // After dark: street lamps, outside lights, and Christmas lights.
  if (night > 0.3) {
    for (const [lx, ly] of shot.lamps) {
      if (inView(lx * TILE, ly * TILE, 1500)) {
        glows.push({ mx: lx * TILE, my: ly * TILE, mz: elevAt(lx * TILE, ly * TILE) + 8, colour: [255, 214, 140], size: 0.45 });
      }
    }
    if (shot.festive) {
      const [hx, hy] = shot.festive;
      const colours: RGB[] = [[255, 60, 60], [60, 220, 90], [80, 140, 255], [255, 210, 60], [255, 255, 255], [255, 120, 220]];
      const mx = (hx + 0.5) * TILE;
      const my = (hy + 0.5) * TILE;
      const base = elevAt(mx, my);
      for (let i = 0; i < 70; i++) {
        const a = (i / 70) * Math.PI * 2;
        const ring = i % 3 === 0 ? 7.5 : 11;
        glows.push({ mx: mx + Math.cos(a) * ring, my: my + Math.sin(a) * ring, mz: base + (i % 3 === 0 ? 5.2 : 1.2 + (i % 2) * 0.5), colour: colours[i % colours.length], size: 0.7 });
      }
      const [deerX, deerY] = [mx - 8, my + 7];
      const deer: [number, number][] = [];
      for (let i = 0; i <= 8; i++) {
        deer.push([i * 0.2, 1.1]);
      }
      for (const leg of [0.1, 0.4, 1.2, 1.5]) {
        for (let j = 0; j < 4; j++) {
          deer.push([leg, j * 0.27]);
        }
      }
      for (const [a, z] of [[1.7, 1.3], [1.85, 1.5], [2.0, 1.65], [2.25, 1.6], [1.95, 1.9], [1.8, 2.1], [2.1, 2.1], [0, 1.25]] as [number, number][]) {
        deer.push([a, z]);
      }
      for (const [a, z] of deer) {
        glows.push({ mx: deerX + rx * a, my: deerY + ry * a, mz: base + z, colour: [230, 240, 255], size: 0.12 });
      }
    }
  }
  for (const g of glows) {
    const p = toCam(g.mx, g.my, g.mz);
    if (p.z < NEAR) {
      continue;
    }
    const s = project(p);
    const r = Math.min(6, Math.max(1.2, (g.size / p.z) * FOCAL));
    const reachPx = r * 6;
    const fade = Math.exp(-p.z / (fogRange * 1.5));
    for (let y = Math.max(0, Math.floor(s.sy - reachPx)); y <= Math.min(H - 1, Math.ceil(s.sy + reachPx)); y++) {
      for (let x = Math.max(0, Math.floor(s.sx - reachPx)); x <= Math.min(W - 1, Math.ceil(s.sx + reachPx)); x++) {
        const i = y * W + x;
        const d = Math.hypot(x - s.sx, y - s.sy);
        const core = d < r * 0.6 && depth[i] > p.z - 1 ? 1 : 0;
        const k = (core + Math.exp(-d / r) * 0.35) * fade;
        if (k > 0.01) {
          data[i * 4] = Math.min(255, data[i * 4] + g.colour[0] * k);
          data[i * 4 + 1] = Math.min(255, data[i * 4 + 1] + g.colour[1] * k);
          data[i * 4 + 2] = Math.min(255, data[i * 4 + 2] + g.colour[2] * k);
        }
      }
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(new ImageData(data, W, H), 0, 0);
  if (shot.snowing) {
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    for (let i = 0; i < 260; i++) {
      const r = 0.6 + hash(i, shot.seed, 31) ** 3 * 2.4;
      ctx.beginPath();
      ctx.arc(hash(i, shot.seed, 32) * W, hash(i, shot.seed, 33) * H, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (shot.brag && sunScreen && showSun) {
    // A lens flare: rings strung along the line from the sun through the middle of the picture.
    ctx.globalCompositeOperation = "lighter";
    for (const [t, r, a] of [[0.45, 10, 0.12], [0.8, 18, 0.08], [1.25, 7, 0.14], [1.6, 26, 0.06]]) {
      const x = sunScreen.x + (W / 2 - sunScreen.x) * t * 2;
      const y = sunScreen.y + (H / 2 - sunScreen.y) * t * 2;
      ctx.fillStyle = `rgba(255, 236, 190, ${a})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
  }
  const vignette = ctx.createRadialGradient(W / 2, H / 2, H * 0.4, W / 2, H / 2, Math.hypot(W, H) / 2);
  vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
  vignette.addColorStop(1, "rgba(0, 0, 0, 0.35)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, W, H);
  return canvas;
}
