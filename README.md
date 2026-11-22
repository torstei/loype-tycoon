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

- **Track grows from the network**, as in the old tycoon games: the first track has to start
  within reach of a station, car park or residential area (shown on the map before you
  build), and every new piece after that has to connect to track you already have. Track can
  be removed anywhere, which saves grooming diesel on stretches nobody uses.
- **Keyboard track laying**, as in the old tycoon games: Num Lock or `T` toggles
  tråkkemodus; numpad 1–9, or Q W E / A D / Z X C on keyboards without a numpad, walk the
  track crew in eight directions, laying track when tråkkemodus is on. Backspace removes
  the track under the crew.
- **Mouse**: left-drag paints track (tool 2) or removes it (tool 3); right-drag pans; the
  wheel steps through the zoom levels. On a touchpad, pinch zooms and two-finger scroll pans.
- **Time**: Space pauses, `,`/`.` slow down / speed up (1×–16×; a game day is about five
  minutes at 1×). The season runs from 1 December to 31 March.
- **Crossings**: when a track reaches a road, a dialog offers a level crossing (cheap, but
  skiers have to take their skis off and the snowcat cannot groom asphalt), a culvert or a
  bridge. How much it matters depends on the road: crossing a quiet local road on the level
  is no bother, a county road costs a little goodwill, and crossing Rv. 4 is an adventure —
  skiers queue for a gap, the snowcat waits too and now and then holds up the trucks, and
  culverts and bridges there cost about twice as much. The railway cannot be crossed on the level: use an existing bridge or underpass
  (taken from the OSM data, shown as "bru/undergang" on hover) or pay for a new underpass.
- **Grooming**: tool `4` places a garage next to the track; the first comes with the
  club's old snowcat. Machines go out when tracks need it (by default only at night),
  groom their way round the network and drive home. Diesel is paid per tile groomed.
- **Grooming map**: `G` (or 🕑 Sist preppet) colours every stretch by how long since a
  snowcat was last along it — under 6 hours, 6–24 hours, 1–3 days, over 3 days, never.
- `+`/`-` or PageUp/PageDown zoom (the outermost two levels show the overview map); arrow
  keys pan; `1`–`4` pick the mouse tool; `N` hides or shows precipitation. Click a moose.

Skiers set out from stations (a group off every hourly train), car parks and residential
areas, once a track passes within reach (a green ⛷ marks connected trailheads). How many
come depends on weekday, holidays, daylight, weather, network length and the club's
reputation. Families, fitness skiers and lycra racers want different trip lengths and
standards; they pick their own loops, wear the track, say what they think, and on the way
home Vipps a donation or join as members according to how happy they were. Their
satisfaction moves the reputation. Each day ends with a summary of skiers, income and
diesel.

After dark the keen ones still come — weekday evenings especially — with headlamps
lighting the snow ahead of them.

Every morning at 07:00 the club publishes a **føremelding** (`F`, or the 📰 button): which
areas were groomed overnight, how each area is, warnings, snow depth, the forecast, a wax
recommendation and what the local Facebook group made of yesterday. The day's report can be
made rosier (“Pynt på den ✨”): more skiers come, but if the tracks disappoint them it costs
more satisfaction and reputation, and the Facebook group will remember.

Moose keep to the remote parts of the map, away from houses, roads and the railway. When one
comes across a groomed track out there it often follows it for a while, leaving hoofprints
in the corduroy until the snowcat has been along again; tracks close to the village are
rarely visited. Moose are shy, too: a stretch that sees a lot of skiers is mostly left
alone, and a moose that meets skiers on the track heads back into the trees. Skiers and the føremelding both have opinions about it.

Early in the morning and late in the evening, a red-bearded man skijors through the valley
with his two huskies, Manu and Nanook. Click them.

Weather is generated per season: temperature with a seasonal curve, fronts and daily
swings, snow and rain, and a snowpack that is deeper higher up. Each track tile tracks
how fresh it is, how much new snow lies in it and how icy it is; tracks are drawn by
condition, from crisp blue corduroy to worn, snowed-in, icy or bare.

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
