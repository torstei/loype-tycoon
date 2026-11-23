// Ids and bits must match tools/mapgen/mapgen.py.

export enum Terrain {
  Forest = 0,
  Open = 1,
  Farmland = 2,
  Bog = 3,
  Water = 4,
  Built = 5,
  Rock = 6,
}

export enum Flag {
  Road = 1 << 0,
  ForestRoad = 1 << 1,
  Rail = 1 << 2,
  Path = 1 << 3,
  Stream = 1 << 4,
  Piste = 1 << 5,
  Building = 1 << 6,
  /** A bridge or underpass already carries something across on its own level. */
  Passage = 1 << 7,
  /** A railway tile where a road or path crosses on the same level: a planovergang with barriers. */
  LevelCrossing = 1 << 10,
}

export const TERRAIN_NAMES: Record<Terrain, string> = {
  [Terrain.Forest]: "Skog",
  [Terrain.Open]: "Åpent terreng",
  [Terrain.Farmland]: "Jorde",
  [Terrain.Bog]: "Myr",
  [Terrain.Water]: "Vann",
  [Terrain.Built]: "Bebyggelse",
  [Terrain.Rock]: "Berg",
};

export const FLAG_NAMES: [Flag, string][] = [
  [Flag.Road, "bilvei"],
  [Flag.ForestRoad, "skogsbilvei"],
  [Flag.Rail, "jernbane"],
  [Flag.Path, "sti"],
  [Flag.Stream, "bekk"],
  [Flag.Piste, "eksisterende løype"],
  [Flag.Building, "bygning"],
  [Flag.Passage, "bru/undergang"],
];

/** Kroner per tile of new track, before slope. Null means you cannot build here. */
export const BUILD_COST: Record<Terrain, number | null> = {
  [Terrain.Forest]: 400,
  [Terrain.Open]: 120,
  [Terrain.Farmland]: 150,
  [Terrain.Bog]: 80,
  [Terrain.Water]: 60,
  [Terrain.Built]: null,
  [Terrain.Rock]: 900,
};
