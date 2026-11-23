# Løype Tycoon

A gently satirical ski-trail tycoon game set in the forests north of Oslo. Plan, build and
groom cross-country tracks, keep the skiers happy, and survive rival trail clubs, thaw
in January and people driving their cars in your tracks.

Real places, invented organisations.

## Layout

- `game/` — the game: TypeScript, PixiJS, Vite.
- `tools/mapgen/` — turns OpenStreetMap and Kartverket elevation data into a tile map.
- `game/public/maps/` — generated maps (committed, so the game runs without the Python tooling).

The Hakadal map covers 10×10 km. The detailed landscape is drawn in chunks of 50×50 tiles as
they come into view, and the least recently seen are dropped again, so a large map neither
takes long to load nor holds the whole landscape in memory; the overview map stands in until
a chunk is ready.

## Running the game

```sh
cd game
npm install
npm run dev
```

Controls (press `H` in the game for the full list):

- **Where it all starts**: the game opens by choosing where the club keeps its garage —
  anywhere near a station, car park or residential area (shown as green rings). The first
  garage is free, since the club already owns Gamle Gunnar. Time stands still until the first
  track is laid, then starts by itself; while paused, a banner says so and resumes on a click.
  Keyboard players can walk the crew there and press Enter.
- **Track grows from the network**, as in the old tycoon games: the first track starts at the
  garage, and every new piece after that has to connect to track you already have. With the
  build tool, loose ends of the network are marked so they show at any zoom. A drag started
  up to three tiles from the network is linked to it with a straight piece of track (as long
  as that piece crosses no road or railway); further away it is refused, with an arrow to the
  nearest track. When a tile is refused (a house, a built-up area, too steep, not enough
  money), the reason pops up on the map beside it. Track can be removed anywhere, which saves grooming diesel on stretches
  nobody uses.
- **Keyboard track laying**, as in the old tycoon games: Num Lock or `T` toggles
  tråkkemodus; numpad 1–9, or Q W E / A D / Z X C on keyboards without a numpad, walk the
  track crew in eight directions, laying track when tråkkemodus is on. Backspace removes
  the track under the crew. The crew follows the mouse: clicking a tile puts it there, and
  after a drag it stands at the end of the new track, so clicking anywhere on the network
  and walking off with the keypad makes a branch.
- **Mouse**: left-drag paints track (tool 2) or removes it (tool 3); right-drag pans; the
  wheel steps through the zoom levels. On a touchpad, pinch zooms and two-finger scroll pans.
- **Time**: Space pauses, `,`/`.` slow down / speed up (1×–16×; a game day is about five
  minutes at 1×). The season runs from 1 December to 31 March.
- **Crossings**: when a track reaches a road, a dialog offers a level crossing (cheap, but
  skiers have to take their skis off and the snowcat cannot groom asphalt), a culvert or a
  bridge. How much it matters depends on the road: crossing a quiet local road on the level
  is no bother, a county road costs a little goodwill, and crossing Rv. 4 is an adventure —
  skiers queue for a gap, the snowcat waits too and now and then holds up the trucks, and
  culverts and bridges there cost about twice as much.
- **Gjøvikbanen** can only be got past where there is already a way: an existing bridge or
  underpass (🌉) or a level crossing (🚧), all taken from the OSM data and marked with a sign
  on the map at every zoom level, since they decide which side of the railway a club can
  reach. Anywhere else costs a new underpass at 120 000 kr. At a level crossing the skiers and
  the snowcat wait for the barriers; through a bridge or underpass that carries a road the
  track has to share the asphalt, priced and felt like crossing that road. Roads and forest
  roads can be followed however steep the hillside beside them.
- **Grooming**: tool `4` places another garage next to the track, with a new machine
  (80 000 kr). Machines go out when tracks need it (by default only at night),
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

## Waffles

Each garage can get a waffle stand, bought and upgraded from the 🧇 button in the snowcat
panel: from a thermos and a waffle iron on a camping table (volunteers, weekends only) via a
booth and a kiosk with benches to the Vaffel-O-Matic 3000, which never runs out, stays open
late, pays an electricity bill every day and now and then jams. Upgrading costs the
difference. Skiers passing close to an open stand may stop for one, more often when it is
cold, up to what the stand can make in a day; each stand also draws a few more skiers to the
area. Sales show in the day's summary and in Varingen.

## Varingen

The local paper comes out every Thursday morning (`V`). Its front page is the week's biggest
story, picked from what the player did: snowcats holding up Rv. 4, a føremelding that promised
more than the tracks delivered, snow left ungroomed, ice and bare ground, record weeks, happy
skiers, new track, moose in the tracks, an empty till. Good press nudges reputation up and
brings more skiers for the next four days; bad press does the opposite. Below the fold: short
news, a snow-depth comparison with Rotnes, the "Sør i bygda" column, Gjøvikbanen and a
reader's letter. A new edition opens on screen by itself, as does each morning's føremelding; a box at
the bottom of each turns that off, and they then announce themselves instead (Varingen with a
"Les avisa" button, a dot on the button and a 🗞 badge on the tab for the hidden tool bar).
On a phone 🗞 and 📰 sit right after the tool button, and only one of them is open at a time.

## Saving

The game saves in the browser (localStorage); nothing leaves the player's machine. It
autosaves every game midnight and whenever the tab is closed or hidden, and continues from
the autosave next time the page opens. The 💾 Spill menu (`M`) has three save slots, export
to and import from a JSON file, and a new game.

Saves refer to tiles by their position on the global grid, never by array index. A save
records the map's name and content fingerprint; loading it into a regenerated or extended
version of the same map lays the track back by grid position, drops tiles that no longer fit
(off the map, under a new building, across a railway with no way under) and adjusts
crossings to what is there now, then says what changed. Saves from another map, from a newer
format or with another grid size are refused. Skiers out on a trip, moose and the train are
not saved.

Append `?debug` to the URL to expose the game state as `window.loype` for poking at
from the browser console or a test script.

## Generating a map

```sh
python3 -m venv .venv
.venv/bin/pip install -r tools/mapgen/requirements.txt
.venv/bin/python tools/mapgen/mapgen.py hakadal
```

Every map is cut from one global grid of 25 m tiles in EPSG:25833 (UTM 33N): grid tile
(col, row) covers easting `col·25 … +25` and northing `row·25 … +25`. Regions are defined in
`REGIONS` in `tools/mapgen/mapgen.py` by the grid column and row of their south-west corner
and their size in tiles, so every map lines up with every other. Saved games will refer to
tiles by grid position, which lets a map be extended, regenerated with fresher data or joined
by neighbouring maps without breaking them. The tile size is fixed for good: changing it would
break every saved game.

Downloads are cached in `tools/mapgen/cache/`, keyed by region and extent; delete a region's
files there to fetch fresh data. The public Overpass servers are often busy, so the tool
retries across mirrors with backoff.

Output per region: `<name>.json` (terrain grid, feature flags, elevation, points of
interest, vector lines for drawing, the region's place on the global grid, and a `version`
fingerprint of its content) and `<name>-preview.png`.

Terrain ids and flag bits are shared between `mapgen.py` and `game/src/terrain.ts`. Level
crossings (flag bit 10) are found where a road or path meets the railway in OSM with neither
on a bridge or in a tunnel.

## Phones and tablets

The game was made for mouse and keyboard first but plays on a touchscreen too. The first time
it opens on a touch-only device (coarse pointer and no fine one) a short box explains tapping
and the build plan, one finger to pan and two to zoom, and the tool button and undo.

On a narrow window or a touch-only device the layout turns compact: a one-line status bar on
top, the tools as a single scrolling row of icons at the bottom (with zoom and forecast
buttons) that ▾ tucks away together with the snowcat panel and 🛠 brings back, panels across
the full width, and tile info on tap instead of hover, fading after a few seconds.

Touch gestures: with the build tool a tap (or a long press) plans track in a straight line
from the red flag (the track crew: at the garage at first, then wherever the last track
ended) to the tapped spot, up to 30 tiles. The plan shows on the map — green for new track,
yellow where it crosses a road or the railway, a red cross where it has to stop — with the
number of tiles, the price and each crossing named, and is only laid on "Lag løype"
("Avbryt" drops it); crossing dialogs come up on the way and building carries on after each; tapping existing track moves the flag there to branch off, and ↶ (or
Ctrl/Cmd+Z) takes back the last stroke and its cost. A finger that moves before lifting
pans the map instead, in every tool, so track is only ever laid through a confirmed plan; a
tap with 👀 only shows the tile without moving the flag. On compact screens the tools sit behind one button showing the current
tool (⛷▴); tapping it opens a menu with them by name. On a touch-only device 👀 is left out
and building is the resting tool, since one finger already pans and a tap shows the tile's
info along with the plan. Two fingers pan and pinch-zoom in any
tool. The zoom is free while pinching and settles on the nearest zoom step when the fingers
lift. If the first finger has laid a tile or two before the second lands, that stroke is
undone and refunded.

## Deploying

The game is published at https://torstei.github.io/loype-tycoon/. Changes reach `main` through
pull requests; each pull request is built by `.github/workflows/pages.yml`, and every push to
`main` builds and deploys the site with GitHub Pages. A deploy replaces every file, so a browser still holding the
previous version can ask for pieces that are gone; the page then reloads once by itself, and
if that does not help it shows a message with a reload button instead of a bare error.

## Data

- Map data © OpenStreetMap contributors, ODbL.
- Elevation: Kartverket DTM (NHM), CC BY 4.0, via `wcs.geonorge.no`.
