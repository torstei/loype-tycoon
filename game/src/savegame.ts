import { Grid, GameMap, GridTile } from "./map";
import { DayStats } from "./skiers";
import { Crossing, TrackNetwork } from "./tracks";
import { DayNews, Edition } from "./varingen";
import { DayPlan } from "./weather";

export const SAVE_FORMAT = "loype-tycoon-save";
export const SAVE_VERSION = 1;

export type Slot = "auto" | "1" | "2" | "3";
export const SLOTS: Slot[] = ["auto", "1", "2", "3"];

/**
 * One track tile: grid position, then its state. Times are absolute game hours, null for never.
 * [col, row, fresh, newSnow, ice, wet, groomedAt, trampledAt, crossing, usage]
 */
export type TrackRecord = [number, number, number, number, number, number, number | null, number | null, number, number];

export interface SavedReport {
  day: number;
  honest: string;
  rosy: string;
  headline: string;
  rosyChosen: boolean;
}

export interface SaveGame {
  format: typeof SAVE_FORMAT;
  version: number;
  savedAt: string;
  /** What the player sees in the load menu: in-game date and map. */
  label: string;
  map: { name: string; title: string; version: string; grid: Grid };
  clock: { hours: number; speedIndex: number };
  budget: number;
  reputation: number;
  today: DayStats;
  hype: boolean;
  yesterday: DayStats | null;
  yesterdayHyped: boolean;
  dieselToday: number;
  incidentsToday: string[];
  incidentsYesterday: string[];
  lastReportDay: number;
  snowSinceReport: number;
  rainSinceReport: number;
  weather: { snowDepth: number; plans: DayPlan[] };
  tracks: TrackRecord[];
  garages: { tile: GridTile; totalGroomed: number }[];
  schedule: "night" | "always";
  reports: SavedReport[];
  crew: GridTile;
  /** Absent in saves from before waffle stands existed. */
  kiosks?: { tile: GridTile; tier: number; soldToday: number; broken: boolean; experts?: boolean }[];
  /** Absent in saves from before the paper existed. */
  varingen?: {
    editions: Edition[];
    week: DayNews[];
    kmAtLastEdition: number;
    bestWeek: number;
    lastDay: number;
    pressUntil: number;
    press: number;
    roadsToday: string[];
    snowToday: number;
    rainToday: number;
  };
}

const key = (slot: Slot) => `loype-tycoon:save:${slot}`;
const BOOT_KEY = "loype-tycoon:boot";

const finite = (n: number) => (Number.isFinite(n) ? n : null);
const round = (n: number, digits = 4) => Math.round(n * 10 ** digits) / 10 ** digits;

export function encodeTracks(map: GameMap, tracks: TrackNetwork): TrackRecord[] {
  const out: TrackRecord[] = [];
  for (const [x, y] of tracks.each()) {
    const i = map.index(x, y);
    const [col, row] = map.toGrid(x, y);
    out.push([
      col,
      row,
      round(tracks.fresh[i]),
      round(tracks.newSnow[i], 2),
      round(tracks.ice[i]),
      round(tracks.wet[i]),
      finite(tracks.groomedAt[i]),
      finite(tracks.trampledAt[i]),
      tracks.crossing[i],
      round(tracks.usage[i], 2),
    ]);
  }
  return out;
}

export interface TrackRestore {
  restored: number;
  /** Outside the map, or where track can no longer be built. */
  dropped: number;
  /** Kept, but the crossing had to change because the road or railway did. */
  changed: number;
}

/**
 * Lay saved track back onto a map by grid position. When the map has changed since the save,
 * tiles that no longer fit are dropped and crossings follow what is there now.
 */
export function decodeTracks(map: GameMap, tracks: TrackNetwork, records: TrackRecord[]): TrackRestore {
  const result: TrackRestore = { restored: 0, dropped: 0, changed: 0 };
  for (const [col, row, fresh, newSnow, ice, wet, groomedAt, trampledAt, crossing, usage] of records) {
    const local = map.fromGrid([col, row]);
    if (!local || tracks.cost(...local) === null) {
      result.dropped++;
      continue;
    }
    const [x, y] = local;
    const obstacle = tracks.obstacle(x, y);
    let type = crossing as Crossing;
    if (obstacle === "rail" && type !== Crossing.Underpass && !(type === Crossing.AtGrade && tracks.levelCrossing(x, y))) {
      // A railway now runs here and the saved track has no way under it.
      result.dropped++;
      continue;
    }
    if (obstacle === "road" && (type === Crossing.None || type === Crossing.Existing || type === Crossing.Underpass)) {
      type = Crossing.AtGrade;
      result.changed++;
    } else if (!obstacle && type !== Crossing.None && type !== Crossing.Existing) {
      type = Crossing.None;
      result.changed++;
    }
    tracks.add(x, y, type);
    const i = map.index(x, y);
    tracks.fresh[i] = fresh;
    tracks.newSnow[i] = newSnow;
    tracks.ice[i] = ice;
    tracks.wet[i] = wet;
    tracks.groomedAt[i] = groomedAt ?? -Infinity;
    tracks.trampledAt[i] = trampledAt ?? -Infinity;
    tracks.usage[i] = usage;
    result.restored++;
  }
  return result;
}

/** Check a parsed file looks like a save this game can read; returns a reason if not. */
export function validate(data: unknown, map: GameMap): string | null {
  const save = data as Partial<SaveGame> | null;
  if (!save || save.format !== SAVE_FORMAT) {
    return "Dette er ikke en lagret Løype Tycoon-fil.";
  }
  if (typeof save.version !== "number" || save.version > SAVE_VERSION) {
    return "Lagringen er laget med en nyere versjon av spillet.";
  }
  if (!save.map || save.map.name !== map.name) {
    return `Lagringen hører til kartet «${save.map?.title ?? "ukjent"}», ikke ${map.title}.`;
  }
  if (save.map.grid?.size !== map.grid.size) {
    return "Lagringen bruker et annet rutenett enn dette kartet.";
  }
  return null;
}

export function writeSlot(slot: Slot, save: SaveGame): boolean {
  try {
    localStorage.setItem(key(slot), JSON.stringify(save));
    return true;
  } catch {
    return false;
  }
}

export function readSlot(slot: Slot): SaveGame | null {
  try {
    const text = localStorage.getItem(key(slot));
    return text ? (JSON.parse(text) as SaveGame) : null;
  } catch {
    return null;
  }
}

export function deleteSlot(slot: Slot) {
  try {
    localStorage.removeItem(key(slot));
  } catch {
    // Nothing to delete if storage is unavailable.
  }
}

/** What the next page load should start with: a slot, an imported save, or a new game. */
export type Boot = { kind: "slot"; slot: Slot } | { kind: "file"; save: SaveGame } | { kind: "new" };

export function setBoot(boot: Boot) {
  try {
    sessionStorage.setItem(BOOT_KEY, JSON.stringify(boot));
  } catch {
    // Without session storage the reload simply continues the autosave.
  }
}

export function takeBoot(): Boot | null {
  try {
    const text = sessionStorage.getItem(BOOT_KEY);
    sessionStorage.removeItem(BOOT_KEY);
    return text ? (JSON.parse(text) as Boot) : null;
  } catch {
    return null;
  }
}

export function download(save: SaveGame) {
  const blob = new Blob([JSON.stringify(save)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `loype-tycoon-${save.map.name}-${save.label.replace(/[^a-zA-Z0-9æøåÆØÅ]+/g, "-")}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
