# Løype Tycoon

A gently satirical ski-trail tycoon game set in the forests north of Oslo. Plan, build and
groom cross-country tracks, keep the skiers happy, and survive rival trail clubs, thaw
in January and people driving their cars in your tracks.

Real places, invented organisations.

## Layout

- `game/` — the game: TypeScript, PixiJS, Vite.
- `tools/mapgen/` — turns OpenStreetMap and Kartverket elevation data into a tile map.
- `game/public/maps/` — generated maps (committed, so the game runs without the Python tooling).

## Running the game

```sh
cd game
npm install
npm run dev
```

Controls (press `H` in the game for the full list):

- **Keyboard track laying**, as in the old tycoon games: Num Lock or `T` toggles
  tråkkemodus; numpad 1–9, or Q W E / A D / Z X C on keyboards without a numpad, walk the
  track crew in eight directions, laying track when tråkkemodus is on. Backspace removes
  the track under the crew.
- **Mouse**: left-drag paints track (tool 2) or removes it (tool 3); right-drag pans; the
  wheel steps through the zoom levels. On a touchpad, pinch zooms and two-finger scroll pans.
- `+`/`-` or PageUp/PageDown zoom (the outermost two levels show the overview map); arrow
  keys pan; `1`/`2`/`3` pick the mouse tool; `N` toggles snowfall. Click a moose.

Append `?debug` to the URL to expose the game state as `window.loype` for poking at
from the browser console or a test script.

## Generating a map

```sh
python3 -m venv .venv
.venv/bin/pip install -r tools/mapgen/requirements.txt
.venv/bin/python tools/mapgen/mapgen.py hakadal
```

Regions are defined in `REGIONS` in `tools/mapgen/mapgen.py` as a south-west corner in
EPSG:25833 (UTM 33N), a side length and a tile size. Downloads are cached in
`tools/mapgen/cache/`; delete a region's files there to fetch fresh data. The public
Overpass servers are often busy, so the tool retries across mirrors with backoff.

Output per region: `<name>.json` (terrain grid, feature flags, elevation, points of
interest, vector lines for drawing) and `<name>-preview.png`.

Terrain ids and flag bits are shared between `mapgen.py` and `game/src/terrain.ts`.

## Data

- Map data © OpenStreetMap contributors, ODbL.
- Elevation: Kartverket DTM (NHM), CC BY 4.0, via `wcs.geonorge.no`.
