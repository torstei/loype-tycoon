import { Application, Container, Graphics, Rectangle, Sprite, Text, Texture } from "pixi.js";
import { Camera, OVERVIEW_BELOW } from "./camera";
import { dayLabel, EARLIEST_SEASON_END, FIRST_SEASON, GameClock, holiday, isWeekend, MAX_SEASON_DAYS, seasonName, setSeason, SPEEDS, weekday } from "./clock";
import { meetingHtml, rating, seasonEdition, SeasonSummary, settleSummer, Summer, summarise, summerHtml } from "./season";
import { COST_PER_TILE, Fleet, GARAGE_REACH, Groomer } from "./groomer";
import { accountsHtml, DayAccount } from "./accounts";
import { areas, Report, writeReport } from "./report";
import { CABIN_REACH, CABIN_TIERS, EXPERTS, Kiosk, KIOSK_TIERS, OutletKind } from "./kiosk";
import { showTouchTips, touchOnly } from "./mobile";
import { showStartupError, watchForStaleBuild } from "./startup";
import { DayNews, Edition, PRESS_DAYS, PRESS_DEMAND, PRESS_REPUTATION, PUBLISH_HOUR, PUBLISH_WEEKDAY, writeEdition } from "./varingen";
import {
  AccountRow,
  decodeTracks,
  deleteSlot,
  download,
  encodeTracks,
  readSlot,
  useSaveSpace,
  SAVE_FORMAT,
  SAVE_VERSION,
  SaveGame,
  setBoot,
  Slot,
  SLOTS,
  takeBoot,
  validate,
  writeSlot,
} from "./savegame";
import { Skijorer } from "./skijor";
import { around, Crowd, DayStats, emptyDay, HOMES_REACH, MEMBERSHIP_FEE, reachFrom, Skier, SKIERS_PER_HOUSE, Trailhead } from "./skiers";
import { TrackCrew } from "./crew";
import { GameMap } from "./map";
import { applyRegion, capital, loadRegionFile, region } from "./region";
import { OVERVIEW_PX, renderOverview } from "./overview";
import { hash, landscapeFields, PX, renderChunk, renderLandscape } from "./render";
import { LandscapeChunks } from "./chunks";
import { greening } from "./melt";
import { Flag, FLAG_NAMES, Terrain, TERRAIN_NAMES } from "./terrain";
import { askCrossing } from "./crossing";
import { Alpine, CHAIRLIFT_PRICE } from "./alpine";
import { GroundShot, groundPhoto, sunDirection } from "./groundphoto";
import { nightLights, streetLamps } from "./lights";
import { Julehus, LIGHTS_DOWN_DAY } from "./christmas";
import { AlbumPhoto, albumHtml, keepInAlbum, seasonMap } from "./album";
import { feedHtml, personName, Post, PostKind, writePost } from "./feed";
import { cameraHtml, inspectHtml, LIVE_PACES, snapHtml, zoomLabel } from "./inspect";
import { findRoute, RouteGround } from "./route";
import { Condition, CONDITION_NAMES, Crossing, CROSSING_NAMES, CrossingOption, crossingOptions, lineTiles, MIN_GROOMING_DEPTH, Obstacle, RAIL_LEVEL_CROSSING, roadTraffic, TILLER_DEPTH, TrackNetwork } from "./tracks";
import { Weather, WEATHER_ICON } from "./weather";
import { Precipitation, Whimsy } from "./whimsy";
import "./style.css";

type Tool = "look" | "build" | "remove" | "garage" | "koie" | "hytte";
/** The things the build menu offers, in its order. */
/** Which cabin level each cabin tool builds. */
const CABIN_TOOL_TIER: Partial<Record<Tool, number>> = { koie: 1, hytte: 2 };

/** Hours since grooming, upper bound of each band, and its colour on the grooming map. */
const GROOM_AGE: [number, number, string][] = [
  [6, 0x1f9d55, "under 6 timer"],
  [24, 0x9ccc3c, "6–24 timer"],
  [72, 0xf0a020, "1–3 døgn"],
  [Infinity, 0xd64534, "over 3 døgn"],
];
const NEVER_GROOMED = 0x8a96a8;

/** Outline, groomed band, grooves, gap between the grooves. */
const TRACK_STYLE: Record<Condition, [number, number, number, number]> = {
  fresh: [0x1b3f7a, 0xf4f8ff, 0x2f6fe0, 0xf4f8ff],
  ok: [0x34507e, 0xeef2f8, 0x7798d8, 0xeef2f8],
  worn: [0x6a7890, 0xe4e8ee, 0xb2bdcc, 0xe4e8ee],
  snowed: [0xa6b3c8, 0xffffff, 0xffffff, 0xffffff],
  icy: [0x3f7ea8, 0xd6efff, 0x7cc0e8, 0xeaf8ff],
  bare: [0x6b4a30, 0xb89878, 0x8a6a4a, 0xb89878],
};

/** Eight directions on the numeric keypad, and the same pattern around S for keyboards without one. */
const STEP_KEYS: Record<string, [number, number]> = {
  Numpad7: [-1, -1], Numpad8: [0, -1], Numpad9: [1, -1],
  Numpad4: [-1, 0], Numpad6: [1, 0],
  Numpad1: [-1, 1], Numpad2: [0, 1], Numpad3: [1, 1],
  KeyQ: [-1, -1], KeyW: [0, -1], KeyE: [1, -1],
  KeyA: [-1, 0], KeyD: [1, 0],
  KeyZ: [-1, 1], KeyX: [0, 1], KeyC: [1, 1],
};

const PAN_KEYS: Record<string, [number, number]> = {
  ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [1, 0], ArrowRight: [-1, 0],
};

const START_BUDGET = 150_000;
/** Tiles across and down in a posted photo, and its pixels per world pixel. */
const PHOTO_TILES = [20, 13] as const;
const PHOTO_RESOLUTION = 1.25;
type PhotoMode = "of" | "from" | "front" | "left" | "right";
/**
 * Per subject: how close and how far off a photo can be taken, in tiles, and from how many metres
 * away the camera starts zooming in. Beyond 40 m a skier is a dot; a train is 130 m long.
 */
const PHOTO_LENS = {
  skier: { nearest: 0.2, farthest: 1.6, framing: 9 },
  snowcat: { nearest: 0.35, farthest: 2.4, framing: 16 },
  train: { nearest: 0.8, farthest: 6, framing: 60 },
};
const PHOTO_MAX_ZOOM = 4.5;
/** How far ahead of the leading carriage's middle the driver sits. */
const TRAIN_CAB_AHEAD_M = 12;
/** How far the driver can turn their head from straight out of a window, in radians. */
const CAB_TURN = 0.45;
/** The map zoom step "Gå til" shows a snowcat at, at least. */
const GOTO_ZOOM_LEVEL = 5;
/** How often the live view from the snowcat is redrawn: each picture takes the better part of a tenth of a second. */
const LIVE_FRAME_MS = 280;
/** Skiers further from the camera than this, in tiles, are too small to see in a picture. */
const OTHERS_RANGE = 16;
/**
 * Live view starts at ten times real time from the snowcat (smooth enough to follow, quick enough
 * that something happens) and at real time from the train, which is quick enough already.
 */
const LIVE_DEFAULT_PACE = { snowcat: 10, train: 1 };
/** The train at real time: its top speed on the map is 45 px a second, a real one does about 80 km/h (14 px). */
const TRAIN_REAL_RATE = 0.32;
/** The map zoom step photo mode starts at, at least: close enough to place the camera within 40 m. */
const PHOTO_ZOOM_LEVEL = 6;
/** The lens by hand: zoom range and step, how far it tilts and per step, and radians per pixel dragged in the preview. */
const PHOTO_LENS_MAX = 6;
const PHOTO_ZOOM_STEP = 1.2;
const PHOTO_TILT_MAX = 0.6;
const PHOTO_TILT_STEP = 0.05;
const PHOTO_DRAG = 0.004;
const SKIER_COLOURS = [0xc8342b, 0x2f5fb0, 0xf2c12e, 0x3aa35a, 0x7a3fa0, 0x222831];
/** How much one post in the local group moves the club's standing. */
const FEED_REPUTATION = 0.004;
const BULLDOZER = `<svg class="dozer" viewBox="0 0 24 24" aria-hidden="true">
  <rect x="7" y="15.5" width="15.5" height="6" rx="3" fill="#3b3b3b"/>
  <circle cx="10" cy="18.5" r="1.4" fill="#a0a0a0"/><circle cx="19.5" cy="18.5" r="1.4" fill="#a0a0a0"/>
  <rect x="8" y="10.5" width="13.5" height="5" rx="1" fill="#f2b705"/>
  <rect x="13" y="4.5" width="7.5" height="6.5" rx="1" fill="#f2b705"/>
  <rect x="14.5" y="6" width="4.5" height="3.2" fill="#cfe8ff"/>
  <rect x="4.5" y="14" width="4" height="1.6" fill="#555"/>
  <path d="M1.5 10 L5 12.5 V21.5 H1.5 Z" fill="#8a8a8a"/>
</svg>`;
const SPEED_ICONS = ["▶", "▶▶", "▶▶▶", "⏩", "⏩⏩"];
const TOOL_ICONS: Record<Tool, string> = { look: "👀", build: "⛷", remove: BULLDOZER, garage: "🏠", koie: "🛖", hytte: "🏡" };
const TOOL_NAMES: Record<Tool, string> = { look: "Se deg rundt", build: "Bygg løype", remove: "Riv løype", garage: "Bygg garasje", koie: "Bygg dugnadskoie", hytte: "Bygg betjent hytte" };
/** Below this window width (or on a touch-only device) the tools move to a bar at the bottom. */
const COMPACT_BELOW = 760;
const BAR_HIDDEN = "loype-tycoon:bar-hidden";
const AUTO_OPEN = "loype-tycoon:auto-open:";
/** On a phone the tile info goes away by itself, since there is no pointer leaving to hide it. */
const COMPACT_INFO_MS = 5000;
/** How far a finger may move, in screen pixels, and still count as a tap. */
const TOUCH_SLOP = 14;
/** A tap or click plans a route from the network up to this many tiles away. */
const TAP_REACH = 30;
/** A stroke this short when a second finger lands was the start of a pinch, not a track. */
const SHORT_STROKE = 3;
/** Game hours per step when fast-forwarding: small enough that skiers and snowcats move as in play. */
const FAST_FORWARD_STEP = 0.1;
/** How far from the network a drag may start and still be linked up automatically, in tiles. */
const CONNECT_REACH = 3;
const kr = (n: number) => `${n.toLocaleString("nb-NO")} kr`;

const DEFAULT_MAP = "hakadal";

/** The map named in the address (?map=name), or the default one. */
function chosenMap(): string {
  const asked = new URLSearchParams(location.search).get("map");
  return asked && /^[a-z0-9-]+$/.test(asked) ? asked : DEFAULT_MAP;
}

async function main() {
  const updateCompact = () => document.documentElement.classList.toggle("compact", touchOnly() || innerWidth < COMPACT_BELOW);
  document.documentElement.classList.toggle("touch", touchOnly());
  /** The tool to fall back to: on a touchscreen one finger already pans, so looking around needs no tool of its own. */
  const restingTool = (): Tool => (touchOnly() ? "build" : "look");
  updateCompact();
  window.addEventListener("resize", updateCompact);
  const [map, regionFile] = await Promise.all([GameMap.load(chosenMap()), loadRegionFile(chosenMap())]);
  applyRegion(map, regionFile);
  document.querySelectorAll(".newspaper").forEach((e) => (e.textContent = region.names.newspaper));
  useSaveSpace(map.name);
  // Pick up where we left off: an explicit load or new game, otherwise the autosave.
  const boot = takeBoot();
  const saved = boot?.kind === "new" ? null : boot?.kind === "file" ? boot.save : readSlot(boot?.kind === "slot" ? boot.slot : "auto");
  map.plough(typeof saved?.season?.year === "number" ? saved.season.year : FIRST_SEASON);
  const tracks = new TrackNetwork(map);
  const clock = new GameClock();
  clock.paused = true;
  /** A new game waits while the player picks a garage and lays the first track, then starts by itself. */
  let timeStarted = false;
  const weather = new Weather();
  weather.advance(0, clock.hours);
  const fleet = new Fleet(map);
  let dieselToday = 0;
  let incidentsToday: string[] = [];
  let incidentsYesterday: string[] = [];
  let roadsToday: string[] = [];
  const crowd = new Crowd(map, (amount) => {
    budget += amount;
  });
  let budget = START_BUDGET;
  // The game opens by choosing where the club keeps its garage.
  let tool: Tool = "garage";

  const app = new Application();
  await app.init({ resizeTo: window, background: "#c9d8ea", antialias: true });
  document.getElementById("stage")!.appendChild(app.canvas);

  const world = new Container();
  app.stage.addChild(world);

  await new Promise((r) => requestAnimationFrame(r));
  const chunks = new LandscapeChunks(map);
  const ground = () => ({ depthAt: weather.profile(), greenAt: greening(clock.day) });
  chunks.setGround(ground());
  const overviewSnow = () => (chunks.ground ? { ground: chunks.ground, need: chunks.fields.need, elev: chunks.fields.elev } : undefined);
  let overviewCanvas = renderOverview(map, overviewSnow());
  const overview = new Sprite(Texture.from(overviewCanvas));
  overview.scale.set(PX / OVERVIEW_PX);
  /** Draw the map again where the snow has melted or come back, or the grass greened, since it was last drawn. */
  const followSnow = () => {
    if (!chunks.setGround(ground())) {
      return;
    }
    const old = overview.texture;
    overviewCanvas = renderOverview(map, overviewSnow());
    overview.texture = Texture.from(overviewCanvas);
    old.destroy(true);
  };
  const detail = chunks.layer;
  document.getElementById("loading")?.remove();
  showTouchTips();
  const mapW = map.width * PX;
  const mapH = map.height * PX;
  const frame = new Graphics()
    .roundRect(-14, -10, mapW + 36, mapH + 36, 18)
    .fill({ color: 0x40557a, alpha: 0.25 })
    .roundRect(-18, -18, mapW + 36, mapH + 36, 18)
    .fill(0xfdfdfb)
    .stroke({ width: 3, color: 0x8fa3bf });
  world.addChild(frame, overview, detail);

  const trackLayer = new Graphics();
  const trailheadLayer = new Container();
  const headLabels = new Container();
  const skijorer = new Skijorer(map);
  const kioskLayer = new Container();
  const alpine = new Alpine(map);
  world.addChild(alpine.layer, trackLayer, trailheadLayer, fleet.garageLayer, kioskLayer, fleet.machineLayer, crowd.layer, skijorer.layer, headLabels);
  const cursor = new Graphics();
  const endsLayer = new Graphics();
  const refusalTag = new Container();
  const refusalText = new Text({ text: "", style: { fontSize: 13, fill: 0xffffff, fontWeight: "600", fontFamily: "system-ui, sans-serif" }, resolution: 2 });
  const refusalBox = new Graphics();
  refusalTag.addChild(refusalBox, refusalText);
  refusalTag.visible = false;
  world.addChild(cursor);
  const whimsy = new Whimsy(map);
  world.addChild(whimsy.layer);
  const startPoi = { x: region.start[0], y: region.start[1] };
  const crew = new TrackCrew(startPoi.x, startPoi.y);
  world.addChild(crew.layer);
  const labels = new Container();
  world.addChild(labels);
  const signs = [...addPoiLabels(map, labels), ...addCrossingSigns(map, tracks, labels)];
  const planLayer = new Graphics();
  /** The ground a planned route would bring within reach of houses. */
  const planZone = new Container();
  world.addChild(planZone, planLayer, endsLayer, refusalTag);
  const night = new Graphics();
  const lightsWorld = new Container();
  const townLights = nightLights(map);
  const julehus = new Julehus(region.christmasHouse);
  lightsWorld.addChild(townLights, julehus.lights, alpine.lights, crowd.lights, fleet.lights, whimsy.bubbleLayer, skijorer.bubble, crowd.bubbles);
  const precipitation = new Precipitation();
  app.stage.addChild(night, lightsWorld, precipitation.layer);

  /** Layers a photo of the landscape leaves out: the player's tools, signs and speech bubbles. */
  const notInPhotos = () => [cursor, labels, planZone, planLayer, endsLayer, refusalTag, headLabels, crew.layer, trailheadLayer, whimsy.bubbleLayer, skijorer.bubble, crowd.bubbles];
  /** A snapshot of the world around a tile, as a skier with a phone would post it; null while fast-forwarding. */
  const takePhoto = (tx: number, ty: number): string | null => {
    if (fastForwarding) {
      return null;
    }
    const w = PHOTO_TILES[0] * PX;
    const h = PHOTO_TILES[1] * PX;
    const x0 = Math.max(0, Math.min(mapW - w, (tx + 0.5) * PX - w / 2));
    const y0 = Math.max(0, Math.min(mapH - h, (ty + 0.5) * PX - h / 2));
    chunks.update(x0, y0, x0 + w, y0 + h, 1000);
    const hidden = notInPhotos();
    const shown = hidden.map((c) => c.visible);
    hidden.forEach((c) => (c.visible = false));
    const detailShown = [detail.visible, detail.alpha] as const;
    detail.visible = true;
    detail.alpha = 1;
    const area = new Rectangle(x0, y0, w, h);
    const base = app.renderer.extract.canvas({ target: world, frame: area, resolution: PHOTO_RESOLUTION }) as HTMLCanvasElement;
    const darkness = 1 - clock.daylight();
    const lights = darkness > 0.05 ? (app.renderer.extract.canvas({ target: lightsWorld, frame: area, resolution: PHOTO_RESOLUTION }) as HTMLCanvasElement) : null;
    hidden.forEach((c, i) => (c.visible = shown[i]));
    [detail.visible, detail.alpha] = detailShown;
    const out = document.createElement("canvas");
    out.width = base.width;
    out.height = base.height;
    const ctx = out.getContext("2d")!;
    ctx.drawImage(base, 0, 0);
    if (lights) {
      ctx.fillStyle = `rgba(11, 26, 58, ${darkness * 0.62})`;
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.globalCompositeOperation = "lighter";
      ctx.drawImage(lights, 0, 0);
      ctx.globalCompositeOperation = "source-over";
    }
    const cx = out.width / 2;
    const cy = out.height / 2;
    const vignette = ctx.createRadialGradient(cx, cy, Math.min(cx, cy) * 0.6, cx, cy, Math.hypot(cx, cy));
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(1, "rgba(0, 0, 0, 0.32)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, out.width, out.height);
    return out.toDataURL("image/jpeg", 0.72);
  };
  const ledger = {
    spend: (amount: number) => {
      if (amount > budget) {
        return false;
      }
      budget -= amount;
      dieselToday += amount;
      return true;
    },
    notify: (text: string, road?: string) => {
      incidentsToday.push(text);
      if (road) {
        roadsToday.push(road);
      }
      crowd.reputation = Math.max(0.05, crowd.reputation - 0.02);
      showToast(text);
    },
  };

  const camera = new Camera(world);
  if (new URLSearchParams(location.search).has("debug")) {
    Object.assign(window, { loype: { map, world, camera, whimsy, alpine, tracks, clock, weather, fleet, crowd, skijorer, crew, chunks, render: { renderChunk, renderLandscape, landscapeFields }, reports: () => reports, paper: () => paper, kiosks: () => crowd.kiosks,
      fastForward: (hours: number, step?: number) => fastForward(hours, step), history: () => history,
      cheat: { setBudget: (n: number) => (budget = n), setSnow: (valley: number, high = valley + 15) => ((weather.snowDepth = valley), (weather.highDepth = high)), buyKiosk: (tier: number) => placeKiosk(fleet.garages[0].x, fleet.garages[0].y, tier), buildCabin: (x: number, y: number, tier: number) => placeOutlet(x, y, tier, "cabin") }, publishEdition: () => publishEdition(), photo: (x: number, y: number) => takePhoto(x, y), groundShot: (view: View) => groundShot(view), viewAlongTrack: (x: number, y: number, subject?: View["subject"]) => viewAlongTrack(x, y, subject), viewDownLift: () => viewDownLift(), viewIntoSun: (x: number, y: number, subject?: View["subject"]) => viewIntoSun(x, y, subject), post: (kind: PostKind, x?: number, y?: number, view?: View | null, road?: string) => post(kind, x === undefined ? null : [x, y!], { road }, view ?? null), feed: () => feed } });
  }
  camera.centreOn((startPoi.x + 0.5) * PX, startPoi.y * PX, app.screen.width, app.screen.height);

  let sinceRedraw = 0;
  let snowSinceReport = 0;
  let rainSinceReport = 0;
  let snowToday = 0;
  let rainToday = 0;
  let lastReportDay = -1;
  let yesterday: DayStats | null = null;
  let yesterdayHyped = false;
  let sinceHud = 0;
  let forecastDay = -1;
  /** Everything that happens in the world over some game hours, without drawing anything. */
  const simulate = (hours: number) => {
    const { snow, rain } = weather.advance(clock.hours - hours, hours);
    snowSinceReport += snow;
    rainSinceReport += rain;
    snowToday += snow;
    rainToday += rain;
    tracks.applyWeather(hours, weather, snow, rain);
    fleet.update(hours, clock.hours, clock.hourOfDay, tracks, weather, ledger);
    crowd.update(hours, clock, weather, tracks);
    alpine.update(hours, clock, weather);
    crowd.liftRunning = alpine.hasChairlift && alpine.isOpen(clock, weather);
    skijorer.update(hours, clock, tracks);
    whimsy.simulate(hours, tracks, clock.hours, (x, y) => crowd.near(x, y, 5));
  };

  /** The day's fixed points: the morning report, Thursday's paper, and closing the books at midnight. */
  const calendar = () => {
    if (clock.ended) {
      return;
    }
    if (Math.floor(clock.hours) !== feedHour) {
      feedHour = Math.floor(clock.hours);
      feedTick();
    }
    if (clock.day > lastReportDay && clock.hourOfDay >= 7 && clock.hourOfDay < 12 && tracks.size > 0) {
      lastReportDay = clock.day;
      publishReport();
    }
    if (weekday(clock.day) === PUBLISH_WEEKDAY && clock.hourOfDay >= PUBLISH_HOUR && clock.day > paper.lastDay && fleet.garages.length > 0) {
      publishEdition();
    }
    if (clock.day !== forecastDay) {
      if (forecastDay >= 0) {
        closeDay(forecastDay);
        if (snowGone(forecastDay)) {
          endSeason(forecastDay);
          return;
        }
        if (!fastForwarding) {
          autosave();
        }
      }
      forecastDay = clock.day;
      refreshForecast();
    }
  };

  /**
   * Run the game ahead as fast as it computes, for balancing and tests: the world in small steps,
   * the calendar after each, nothing drawn until the end.
   */
  let fastForwarding = false;
  const fastForward = (hours: number, step = FAST_FORWARD_STEP) => {
    fastForwarding = true;
    refreshTrailheads();
    claimCabins();
    const wasPaused = clock.paused;
    const wasEnded = clock.ended;
    clock.paused = true;
    timeStarted = true;
    let left = hours;
    while (left > 0 && !clock.seasonOver) {
      const h = Math.min(step, left);
      clock.hours += h;
      simulate(h);
      calendar();
      left -= h;
    }
    clock.paused = wasPaused || clock.ended;
    fastForwarding = false;
    if (clock.ended && !wasEnded) {
      announceSeasonEnd();
    }
    redrawTracks();
    refreshHud();
    return history;
  };

  app.ticker.add((ticker) => {
    const dt = Math.min(0.1, ticker.deltaMS / 1000);
    const hours = clock.tick(dt);
    if (hours > 0) {
      simulate(hours);
      sinceRedraw += hours;
      if (sinceRedraw >= 0.25) {
        sinceRedraw = 0;
        redrawTracks();
      }
    }
    if (!timeStarted && tracks.size > 0 && !painting && !asking) {
      timeStarted = true;
      clock.paused = false;
      showToast("⏱ <strong>Tiden går!</strong> Gunnar prepper i natt, og skiløperne kommer i morgen. Mellomrom pauser, og , / . endrer farten.");
    }
    sinceHud += dt;
    if (sinceHud >= 0.25) {
      sinceHud = 0;
      refreshHud();
    }
    calendar();
    const darkness = 1 - clock.daylight();
    townLights.alpha = Math.min(1, Math.max(0, (darkness - 0.2) / 0.5));
    night.clear().rect(0, 0, app.screen.width, app.screen.height).fill({ color: 0x0b1a3a, alpha: darkness * 0.5 });
    lightsWorld.position.copyFrom(world.position);
    lightsWorld.scale.copyFrom(world.scale);
    fleet.animate(dt, darkness);
    camera.update(dt);
    world.x = Math.min(app.screen.width / 2, Math.max(app.screen.width / 2 - mapW * world.scale.x, world.x));
    world.y = Math.min(app.screen.height / 2, Math.max(app.screen.height / 2 - mapH * world.scale.y, world.y));
    const s = camera.scale;
    detail.alpha = Math.max(0, Math.min(1, (s - 0.4) / 0.1));
    detail.visible = detail.alpha > 0;
    whimsy.detail = s >= OVERVIEW_BELOW;
    crowd.animate(dt, s >= OVERVIEW_BELOW, 1 - clock.daylight());
    alpine.animate(dt, s >= OVERVIEW_BELOW, 1 - clock.daylight());
    julehus.animate(dt, clock.day, 1 - clock.daylight(), s >= OVERVIEW_BELOW);
    skijorer.animate(dt, s >= OVERVIEW_BELOW, 1 - clock.daylight(), crowd.lights);
    headLabels.visible = s >= OVERVIEW_BELOW && !tucked.length;
    for (const label of headLabels.children) {
      label.scale.set(s < 1 ? 1 / s : 1);
    }
    for (const { node, kind } of signs) {
      node.scale.set(s < 1 ? 1 / s : 1);
      node.visible = s >= OVERVIEW_BELOW || (kind !== "parking" && kind !== "cabin");
    }
    followSnow();
    const tl = world.toLocal({ x: 0, y: 0 });
    const br = world.toLocal({ x: app.screen.width, y: app.screen.height });
    if (detail.visible) {
      chunks.update(tl.x, tl.y, br.x, br.y);
    }
    whimsy.update(dt, { x0: tl.x, y0: tl.y, x1: br.x, y1: br.y }, clock.paused, clock.slowMotion === null ? 1 : clock.slowMotion * TRAIN_REAL_RATE);
    crew.update(dt);
    drawEnds(dt);
    const kind = weather.precipRate <= 0 ? "none" : weather.temperature < 0.8 ? "snow" : "rain";
    precipitation.update(dt, app.screen.width, app.screen.height, kind, weather.precipRate / 1.5);
  });

  const hud = document.getElementById("hud")!;
  const info = document.getElementById("info")!;
  document.getElementById("attribution")!.textContent = map.attribution;

  const topbar = document.getElementById("topbar")!;
  const fleetPanel = document.getElementById("fleet")!;
  const pausedBanner = document.getElementById("paused")!;
  const toolMenu = document.getElementById("tool-menu")!;
  const toolMenuButton = document.getElementById("tool-menu-button")!;
  const toolChoice = document.getElementById("tool-choice")!;
  for (const el of document.querySelectorAll<HTMLElement>("[data-icon]")) {
    el.innerHTML = TOOL_ICONS[el.dataset.icon as Tool];
  }
  const speedMenu = document.getElementById("speed-menu")!;
  const speedChoice = document.getElementById("speed-choice")!;
  const menus = [toolMenu, speedMenu];
  /** Close any open dropdown; true if one was open. */
  const closeMenus = (): boolean => {
    const open = menus.some((m) => !m.hidden);
    for (const m of menus) {
      m.hidden = true;
    }
    return open;
  };
  /** Open a dropdown at its button: above the bar on a phone, below the button on a wide screen. */
  const openMenu = (menu: HTMLElement, anchor: HTMLElement) => {
    const wasOpen = !menu.hidden;
    closeMenus();
    if (wasOpen) {
      return;
    }
    menu.hidden = false;
    const r = anchor.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(r.left, innerWidth - menu.offsetWidth - 8))}px`;
    if (document.documentElement.classList.contains("compact")) {
      menu.style.removeProperty("top");
      menu.style.removeProperty("bottom");
    } else {
      menu.style.top = `${r.bottom + 4}px`;
      menu.style.bottom = "auto";
    }
  };
  const barShow = document.getElementById("bar-show")!;
  const toolbar = document.getElementById("tools")!;
  const placePanels = () => {
    const top = `${topbar.offsetHeight + 8}px`;
    const root = document.documentElement.style;
    root.setProperty("--top", top);
    const html = document.documentElement.classList;
    root.setProperty("--bar", `${html.contains("compact") && !html.contains("bar-hidden") ? toolbar.offsetHeight : 0}px`);
    root.setProperty("--fleet", `${fleetPanel.hidden ? 0 : fleetPanel.offsetHeight + 6}px`);
    root.setProperty("--paused", `${pausedBanner.hidden ? 0 : pausedBanner.offsetHeight + 8}px`);
    document.getElementById("forecast")!.style.top = top;
    document.getElementById("help")!.style.top = top;
    document.getElementById("report")!.style.top = top;
    document.getElementById("paused")!.style.top = top;
    document.getElementById("paper")!.style.top = top;
  };
  new ResizeObserver(placePanels).observe(topbar);
  new ResizeObserver(placePanels).observe(toolbar);
  new ResizeObserver(placePanels).observe(fleetPanel);
  new ResizeObserver(placePanels).observe(pausedBanner);
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-zoom]")) {
    button.addEventListener("click", () => camera.zoomAt(app.screen.width / 2, app.screen.height / 2, Number(button.dataset.zoom)));
  }
  const setBarHidden = (hidden: boolean) => {
    document.documentElement.classList.toggle("bar-hidden", hidden);
    try {
      localStorage.setItem(BAR_HIDDEN, hidden ? "1" : "");
    } catch {
      // Not remembered between visits; no harm done.
    }
    placePanels();
  };
  document.getElementById("bar-hide")!.addEventListener("click", () => setBarHidden(true));
  toolMenuButton.addEventListener("click", () => openMenu(toolMenu, toolMenuButton));
  toolChoice.addEventListener("click", () => openMenu(toolMenu, toolChoice));
  speedChoice.addEventListener("click", () => openMenu(speedMenu, speedChoice));
  document.getElementById("undo")!.addEventListener("click", () => undoLastStroke());
  document.getElementById("bar-show")!.addEventListener("click", () => setBarHidden(false));
  try {
    setBarHidden(localStorage.getItem(BAR_HIDDEN) === "1");
  } catch {
    setBarHidden(false);
  }
  document.getElementById("forecast-button")!.addEventListener("click", () => {
    const open = document.getElementById("forecast")!.classList.toggle("open");
    document.documentElement.classList.toggle("forecast-open", open);
  });

  pausedBanner.addEventListener("click", () => {
    clock.paused = false;
    refreshHud();
  });
  const forecastPanel = document.getElementById("forecast")!;

  const refreshHud = () => {
    const km = (tracks.size * map.tileSize) / 1000;
    const nowIcon = weather.precipRate > 0 ? (weather.temperature < 0.8 ? "🌨️" : "🌧️") : clock.daylight() > 0.5 ? "☀️" : "🌙";
    hud.innerHTML = `
      <strong class="title">Løype Tycoon · ${region.title}</strong>
      <span class="clock">${clock.paused ? "⏸ " : ""}${clock.label()}</span>
      <span class="weather">${nowIcon} <span class="wide-only">${weather.temperature.toFixed(0)} °C · snø ${weather.snowDepth.toFixed(0)} cm</span><span class="compact-only">${weather.temperature.toFixed(0)}°</span></span>
      <button class="cash" title="Regnskap (K)"><span class="wide-only">Kasse: </span>${kr(budget)}</button>
      <span class="skiers">⛷ ${crowd.today.skiers}<span class="wide-only"> i dag · omdømme ${Math.round(crowd.reputation * 100)} %</span></span>
      <span class="km wide-only">Løypenett: ${km.toFixed(2)} km</span>
      <span class="mode wide-only ${crew.building ? "on" : ""}">Tråkkemodus: ${crew.building ? "PÅ" : "av"}</span>
      <span class="hint wide-only">H = hjelp</span>`;
    for (const btn of document.querySelectorAll<HTMLButtonElement>("[data-tool]")) {
      btn.classList.toggle("active", btn.dataset.tool === tool);
    }
    toolMenuButton.innerHTML = `${TOOL_ICONS[tool]}▴`;
    toolChoice.innerHTML = `${TOOL_ICONS[tool]} ${TOOL_NAMES[tool]} ▾`;
    toolChoice.classList.toggle("active", tool !== "look");
    for (const el of toolMenu.querySelectorAll<HTMLElement>("[data-price]")) {
      const which = el.dataset.price;
      const price = which === "garage" ? fleet.nextGarageCost : CABIN_TIERS[which === "koie" ? 1 : 2].price;
      el.textContent = price === 0 ? "gratis" : kr(price);
    }
    barShow.innerHTML = `${TOOL_ICONS[tool]} ▴`;
    for (const btn of document.querySelectorAll<HTMLButtonElement>("[data-speed]")) {
      const i = Number(btn.dataset.speed);
      btn.classList.toggle("active", i < 0 ? clock.paused : !clock.paused && clock.slowMotion === null && clock.speedIndex === i);
    }
    const compactBar = document.documentElement.classList.contains("compact");
    speedChoice.textContent = clock.paused
      ? `⏸${compactBar ? "" : " Pause"} ${compactBar ? "▴" : "▾"}`
      : clock.slowMotion !== null
        ? `🐢${compactBar ? "" : " Sakte"} ${compactBar ? "▴" : "▾"}`
        : `${compactBar ? "" : `${SPEED_ICONS[clock.speedIndex]} `}${SPEEDS[clock.speedIndex]}× ${compactBar ? "▴" : "▾"}`;
    speedChoice.classList.toggle("active", clock.paused);
    pausedBanner.hidden = !clock.paused || !timeStarted || asking || clock.seasonOver;
    const garageTool = document.querySelector<HTMLButtonElement>('[data-tool="garage"]')!;
    garageTool.title = `4 · ${fleet.nextGarageCost === 0 ? "gratis" : kr(fleet.nextGarageCost)}`;
    fleetPanel.hidden = fleet.groomers.length === 0;
    fleetPanel.innerHTML = `
      <div class="head"><strong>Løypemaskiner</strong>
        <button id="schedule">${fleet.schedule === "night" ? "🌙 Prepper om natta" : "🕑 Prepper døgnet rundt"}</button></div>
      ${fleet.groomers.map((g, i) => {
        const k = kioskAt(g.garage.x, g.garage.y);
        const drive = g.state === "home"
          ? `<button class="drive" data-drive="${i}" title="Send ${g.name} ut nå, uansett tid på døgnet">▶ Kjør ut</button>`
          : g.state === "grooming" ? `<button class="drive" data-drive="${i}" title="Kall ${g.name} hjem og spar diesel">⏹ Hjem</button>` : "";
        return `<div class="row"><span class="name">🚜 ${g.name}</span> ${g.status}
          <span class="buttons">
          <button class="mode${g.onCall ? " on" : ""}" data-oncall="${i}" title="${g.onCall ? `${g.name} står i garasjen til du sender den ut. Klikk for å la den kjøre selv.` : `${g.name} kjører selv når løypene trenger det. Klikk for å la den stå til du sender den ut.`}">${g.onCall ? "✋ På vent" : "🔁 Auto"}</button>
          ${drive}
          <button class="drive" data-wheel="${i}" title="Kjør ${g.name} selv, fra førerhytta">🕹</button>
          <button class="goto" data-goto="${i}" title="Vis ${g.name} på kartet">Gå til</button>
          <button class="kiosk" data-kiosk="${i}" title="Vaffelsalg ved garasjen">🧇 ${k ? `${k.spec.short}${k.broken ? " (i ustand)" : ""}` : "Vaffelsalg?"}</button></span></div>`;
      }).join("")}
      ${kiosks.filter((k) => k.kind === "cabin").map((k) => `<div class="row"><span class="name">🛖 ${k.title}</span> ${k.spec.short}${k.spec.rooms ? ` · 🛏 ${k.guestsLastNight}` : ""}
          <button class="kiosk" data-cabin="${k.x},${k.y}">Åpne</button></div>`).join("")}`;
  };
  fleetPanel.addEventListener("pointerdown", (e) => {
    const gotoButton = (e.target as HTMLElement).closest<HTMLElement>("[data-goto]");
    if (gotoButton) {
      goToGroomer(fleet.groomers[Number(gotoButton.dataset.goto)]);
      return;
    }
    const modeButton = (e.target as HTMLElement).closest<HTMLElement>("[data-oncall]");
    if (modeButton) {
      const g = fleet.groomers[Number(modeButton.dataset.oncall)];
      g.onCall = !g.onCall;
      refreshHud();
      return;
    }
    const wheelButton = (e.target as HTMLElement).closest<HTMLElement>("[data-wheel]");
    if (wheelButton) {
      driveGroomer(fleet.groomers[Number(wheelButton.dataset.wheel)]);
      return;
    }
    const driveButton = (e.target as HTMLElement).closest<HTMLElement>("[data-drive]");
    if (driveButton) {
      const g = fleet.groomers[Number(driveButton.dataset.drive)];
      if (g.state === "home") {
        const refused = g.dispatch(tracks, weather, clock.hours);
        showToast(refused ? `🚜 ${refused}` : `🚜 ${g.name} kjører ut.`);
      } else {
        g.recall(tracks);
      }
      refreshHud();
      return;
    }
    const kioskButton = (e.target as HTMLElement).closest<HTMLElement>("[data-kiosk]");
    if (kioskButton) {
      openKiosk(Number(kioskButton.dataset.kiosk));
      return;
    }
    const cabinButton = (e.target as HTMLElement).closest<HTMLElement>("[data-cabin]");
    if (cabinButton) {
      const [cx, cy] = cabinButton.dataset.cabin!.split(",").map(Number);
      openCabin(cx, cy);
      return;
    }
    if ((e.target as HTMLElement).id === "schedule") {
      fleet.schedule = fleet.schedule === "night" ? "always" : "night";
      refreshHud();
    }
  });

  const refreshForecast = () => {
    const days = weather.forecast(clock.day, 3);
    forecastPanel.innerHTML = `
      <div class="days">${days
        .map(
          (f, i) => `<div class="day"><div class="when">${i === 0 ? "I dag" : dayLabel(f.day)}</div>
            <div class="icon">${WEATHER_ICON[f.kind]}</div>
            <div>${f.low}° / ${f.high}°</div>
            <div class="mm">${f.precip > 0 ? `${f.precip} ${f.kind === "snø" ? "cm" : "mm"}` : "&nbsp;"}</div></div>`,
        )
        .join("")}</div>
      <div class="saying">${weather.saying(clock.day)}</div>`;
  };

  const toast = document.getElementById("toast")!;
  let toastTimer = 0;
  const showToast = (html: string, ms = 7000) => {
    toast.innerHTML = html;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (toast.hidden = true), ms);
  };
  toast.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("[data-open='paper']")) {
      toast.hidden = true;
      showPaper(true);
    }
  });

  const kiosks = crowd.kiosks;
  const kioskAt = (x: number, y: number) => kiosks.find((k) => k.kind === "stand" && k.x === x && k.y === y);
  /** A cabin on or right next to a tile. */
  const cabinNear = (x: number, y: number, r = 1) => kiosks.find((k) => k.kind === "cabin" && Math.max(Math.abs(k.x - x), Math.abs(k.y - y)) <= r);
  const kioskPanel = document.getElementById("kiosk")!;
  /** What the waffle dialog is about: the stand at a garage, or a cabin (or a site for one). */
  let outletTarget: { kind: "garage"; index: number } | { kind: "cabin"; x: number; y: number } | null = null;
  let kioskBoughtToday: string | null = null;
  let kioskUpgradedToday = false;
  let kioskBrokenToday = false;
  let expertsHiredToday = false;
  let chairliftToday: string | null = null;
  let cabinClaimedToday: string | null = null;
  let cabinBuiltToday: string | null = null;

  const placeOutlet = (x: number, y: number, tier: number, kind: OutletKind = "stand", name: string | null = null): Kiosk => {
    const existing = kind === "stand" ? kioskAt(x, y) : cabinNear(x, y, 0);
    if (existing) {
      existing.upgrade(tier);
      return existing;
    }
    const k = new Kiosk(x, y, tier, kind, name);
    kiosks.push(k);
    kioskLayer.addChild(k.sprite);
    return k;
  };
  const placeKiosk = (x: number, y: number, tier: number) => placeOutlet(x, y, tier);

  const openKiosk = (garageIndex: number) => {
    outletTarget = { kind: "garage", index: garageIndex };
    kioskPanel.hidden = false;
    renderKiosk();
  };
  const liftPanel = document.getElementById("lift")!;
  let liftShown: string | null = null;

  /** The chair-lift's top station: cross-country skiers ride up and set off from there. */
  const openChairliftHead = () => {
    const top = alpine.topStation;
    const lift = alpine.mainLift;
    if (!top || !lift) {
      return;
    }
    const x = Math.floor(top[0]);
    const y = Math.floor(top[1]);
    const reach = 4;
    crowd.addTrailhead({ kind: "lift", name: `toppen av ${lift.name}`, x, y, rate: 7, reach, houses: 0, served: 0, houseTiles: [], catchment: around(map, [[x, y]], reach), entry: null, network: 0, today: 0 });
    trailheadSignature = "";
    refreshTrailheads();
  };

  const renderLift = () => {
    const lift = alpine.lifts.find((l) => l.name === liftShown);
    if (!lift) {
      liftPanel.hidden = true;
      return;
    }
    const open = alpine.isOpen(clock, weather);
    const main = lift === alpine.mainLift;
    const top = alpine.topStation!;
    const topElevation = map.elevationAt(Math.floor(top[0]), Math.floor(top[1]));
    const bottom = lift.line.pts[0];
    const bottomElevation = map.elevationAt(Math.floor(bottom[0]), Math.floor(bottom[1]));
    const extraSnow = Math.max(0, Math.round(weather.snowDepthAt(topElevation) - weather.snowDepthAt(bottomElevation)));
    const head = crowd.trailheads.find((h) => h.kind === "lift");
    const status = `${lift.chair ? "Stolheis" : "Skitrekk"} · ${open ? `åpent nå · ${alpine.people} i bakkene` : "åpent 17–21 på hverdager og 10–16 i helgene, når det er snø"}`;
    const offer = !main
      ? `<p class="note">Et av skitrekkene i ${region.names.skiArea}. Det lengste, ${alpine.mainLift?.name}, kan bli stolheis.</p>`
      : lift.chair
        ? `<table><tr class="current"><td><strong>Stolheisen går</strong><br><small>${head?.entry ? `Langrennsløpere tar heisen opp og går ut fra toppen: ${head.today} i dag.` : "Legg løype fra toppstasjonen, så tar langrennsløperne heisen opp."}</small></td><td><span class="owned">✓ Spleiset</span></td></tr></table>`
        : `<table><tr><td><strong>Stolheis</strong><br><small>I ${region.names.skiArea} har det lenge vært snakk om å bytte ut ${lift.name} med stolheis. Løypelaget kan spleise: da kommer langrennsfolk også til topps, med skiene på beina og stavene i fanget.</small><br>
          <small class="facts">Ny startplass ved toppstasjonen, ${topElevation} moh · ${extraSnow > 0 ? `${extraSnow} cm mer snø enn ved bunnen i dag` : "snøen ligger lengst der oppe"} · går når bakken er åpen</small></td>
          <td><button data-lift="chair" ${CHAIRLIFT_PRICE > budget ? "disabled" : ""}>Spleis ${kr(CHAIRLIFT_PRICE)}</button></td></tr></table>
          <p class="note">Løypelagets andel. Resten tar alpinbakken og en sparebankstiftelse med sans for heiser.</p>`;
    liftPanel.innerHTML = `
      <div class="head"><strong>🚡 ${lift.name}</strong><button data-lift="close">✕</button></div>
      <p class="status">${status}</p>
      ${offer}`;
  };

  const openLift = (name: string) => {
    liftShown = name;
    liftPanel.hidden = false;
    renderLift();
  };

  liftPanel.addEventListener("click", (e) => {
    const action = (e.target as HTMLElement).closest("button")?.dataset.lift;
    if (action === "close") {
      liftPanel.hidden = true;
    } else if (action === "chair" && !alpine.hasChairlift && CHAIRLIFT_PRICE <= budget) {
      budget -= CHAIRLIFT_PRICE;
      alpine.buildChairlift();
      openChairliftHead();
      chairliftToday = alpine.mainLift?.name ?? null;
      showToast(`🚡 <strong>Stolheis i ${region.names.skiArea}!</strong> Legg løype fra toppstasjonen, så tar langrennsløperne heisen opp når bakken er åpen.`);
      renderLift();
      refreshHud();
    }
  });

  const openCabin = (x: number, y: number) => {
    outletTarget = { kind: "cabin", x, y };
    kioskPanel.hidden = false;
    renderKiosk();
  };

  /** Where the dialog's outlet is, what stands there now, and which levels it offers. */
  const resolveTarget = () => {
    if (!outletTarget) {
      return null;
    }
    if (outletTarget.kind === "garage") {
      const groomer = fleet.groomers[outletTarget.index];
      if (!groomer) {
        return null;
      }
      const { x, y } = groomer.garage;
      return { x, y, kind: "stand" as const, current: kioskAt(x, y), tiers: KIOSK_TIERS.map((t, i) => [t, i] as const), title: `🧇 Vaffelsalg ved garasjen til ${groomer.name}` };
    }
    const { x, y } = outletTarget;
    const current = cabinNear(x, y, 0);
    const offered = current?.tier === 0 ? [[CABIN_TIERS[0], 0] as const] : CABIN_TIERS.map((t, i) => [t, i] as const).filter(([t]) => t.price > 0);
    return { x, y, kind: "cabin" as const, current, tiers: offered, title: current ? `🛖 ${current.title}` : "🛖 Ny hytte her" };
  };

  const renderKiosk = () => {
    const target = resolveTarget();
    if (!target) {
      kioskPanel.hidden = true;
      return;
    }
    const { current, kind } = target;
    const paid = current ? current.spec.price : 0;
    const status = !current
      ? kind === "cabin"
        ? "Bygg en hytte her ved løypa. Hytter blir turmål: skiløpere som går innom, er mer fornøyde, og flere kommer."
        : "Ingen vaffelsalg her ennå. Vafler gir inntekt, og folk tar gjerne en tur dit det lukter vaffel."
      : current.broken
        ? `${current.spec.name} er i ustand i dag. Teknikeren kommer i morgen.`
        : `I dag: ${current.soldToday} av ${current.capacityOn(clock.day)} vafler solgt · ${current.isOpen(clock.day, clock.hourOfDay) ? "åpent nå" : `åpent ${current.spec.open[0]}–${current.spec.open[1]}${current.spec.weekendsOnly ? " i helgene" : ""}`}${current.expertsOn(clock.day) ? " · 🎯 skytterlaget steiker" : ""}${current.spec.rooms ? ` · 🛏 ${current.guestsLastNight} gjester i natt` : ""}`;
    const rows = target.tiers.map(([t, i]) => {
      const owned = current !== undefined && i <= current.tier;
      const cost = t.price - paid;
      const extras = [
        `${t.capacity.toLocaleString("nb-NO")} vafler/dag`,
        `${t.salePrice} kr stykket`,
        `åpent ${t.open[0]}–${t.open[1]}${t.weekendsOnly ? ", bare i helgene" : ""}`,
        t.rooms ? `${t.rooms} rom à ${kr(t.roomPrice ?? 0)}` : "",
        t.dailyCost ? `${kind === "cabin" ? "lønn" : "strøm"} ${kr(t.dailyCost)}/dag` : "",
      ].filter(Boolean).join(" · ");
      const action = current?.tier === i
        ? `<span class="owned">✓ ${kind === "cabin" && i === 0 ? "Koblet til løypa" : "Dette har dere"}</span>`
        : owned
          ? `<span class="owned">✓</span>`
          : `<button data-buy="${i}" ${cost > budget ? "disabled" : ""}>${current ? "Oppgrader" : kind === "cabin" ? "Bygg" : "Kjøp"} ${kr(cost)}</button>`;
      return `<tr class="${current?.tier === i ? "current" : ""}"><td><strong>${t.name}</strong><br><small>${t.pitch}</small><br><small class="facts">${extras}</small></td><td>${action}</td></tr>`;
    }).join("");
    kioskPanel.innerHTML = `
      <div class="head"><strong>${target.title}</strong><button data-k="close">✕</button></div>
      <p class="status">${status}</p>
      <table>${rows}</table>
      ${current?.tier === 0 && kind === "cabin" ? "" : `<p class="note">Oppgradering koster mellomlegget: det dere har betalt, trekkes fra.</p>`}
      <div class="experts">
        <div><strong>🎯 ${EXPERTS.name}</strong><br><small>${EXPERTS.pitch}</small><br>
          <small class="facts">I helgene: ${Math.round((EXPERTS.capacity - 1) * 100)} % flere vafler · flere stopper · +${EXPERTS.extraPrice} kr stykket</small></div>
        <div>${current?.experts
          ? `<span class="owned">✓ Avtale inngått</span>`
          : !current
            ? `<small>${kind === "cabin" ? "Bygg hytta først" : `Krever minst ${KIOSK_TIERS[EXPERTS.minTier].short.toLowerCase()}`}</small>`
            : !current.canHireExperts()
              ? `<small>Krever minst ${KIOSK_TIERS[EXPERTS.minTier].short.toLowerCase()}</small>`
              : `<button data-experts="hire" ${EXPERTS.price > budget ? "disabled" : ""}>Inngå avtale ${kr(EXPERTS.price)}</button>`}</div>
      </div>`;
  };

  kioskPanel.addEventListener("click", (e) => {
    const button = (e.target as HTMLElement).closest("button");
    if (!button) {
      return;
    }
    if (button.dataset.k === "close") {
      kioskPanel.hidden = true;
      return;
    }
    const target = resolveTarget();
    if (!target) {
      return;
    }
    if (button.dataset.experts === "hire") {
      const k = target.current;
      if (k && !k.experts && k.canHireExperts() && EXPERTS.price <= budget) {
        budget -= EXPERTS.price;
        k.hireExperts();
        expertsHiredToday = true;
        showToast(`🎯 <strong>Avtale med ${region.names.waffleClub}!</strong> Fra lørdag står skytterlagets beste vaffelsteikere ved jernet. Treffsikkert.`);
        renderKiosk();
        refreshHud();
      }
      return;
    }
    const tier = Number(button.dataset.buy);
    if (!Number.isFinite(tier)) {
      return;
    }
    const spec = (target.kind === "cabin" ? CABIN_TIERS : KIOSK_TIERS)[tier];
    const cost = spec.price - (target.current ? target.current.spec.price : 0);
    if (cost > budget) {
      return;
    }
    budget -= cost;
    if (target.kind === "cabin") {
      placeOutlet(target.x, target.y, tier, "cabin", target.current?.name ?? null);
      const where = nearestPlace(target.x, target.y);
      cabinBuiltToday = `${spec.name}${where ? ` ved ${where}` : ""}`;
      showToast(`🛖 <strong>${spec.name}</strong> står klar${where ? ` ved ${where}` : ""}. ${spec.rooms ? "Sengene er redd opp og komfyren er varm." : "Vaffeljernet er plugget i, og de frivillige har satt opp vaktliste."}`);
    } else {
      placeOutlet(target.x, target.y, tier);
      kioskBoughtToday = spec.name;
      kioskUpgradedToday = target.current !== undefined;
      showToast(tier === KIOSK_TIERS.length - 1
        ? "🧇 <strong>Vaffel-O-Matic 3000</strong> er levert! Den surrer, blinker og lukter brunost. Naboene har spørsmål."
        : `🧇 <strong>${spec.name}</strong> er klar ved garasjen. Røren står klar.`);
    }
    renderKiosk();
    refreshHud();
  });

  /** The named place nearest a tile, for saying where something is. */
  const nearestPlace = (x: number, y: number): string | null => {
    let best: string | null = null;
    let bestD = Infinity;
    for (const p of map.pois) {
      if (p.name && (p.kind === "place" || p.kind === "peak" || p.kind === "station")) {
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < bestD) {
          bestD = d;
          best = p.name;
        }
      }
    }
    return best;
  };

  /** Why a cabin cannot go on a tile, or null if it can. */
  const cabinProblem = (x: number, y: number): string | null => {
    if (!map.inside(x, y)) {
      return "Utenfor kartet";
    }
    if (tracks.has(x, y)) {
      return "Hytta kan ikke stå midt i løypa — velg en plass ved siden av";
    }
    if (map.terrainAt(x, y) === Terrain.Water || map.has(x, y, Flag.Road) || map.has(x, y, Flag.Rail)) {
      return "Kan ikke bygge hytte her";
    }
    if (tracks.cost(x, y) === null) {
      return tracks.blockReason(x, y) ?? "Kan ikke bygge hytte her";
    }
    let nearTrack = false;
    for (let dy = -CABIN_REACH; dy <= CABIN_REACH && !nearTrack; dy++) {
      for (let dx = -CABIN_REACH; dx <= CABIN_REACH && !nearTrack; dx++) {
        nearTrack = tracks.has(x + dx, y + dy);
      }
    }
    if (!nearTrack) {
      return "Hytta må ligge ved løypa";
    }
    if (cabinNear(x, y, 4) || fleet.garages.some((g) => Math.abs(g.x - x) < 4 && Math.abs(g.y - y) < 4)) {
      return "For nær en annen hytte eller garasje";
    }
    return null;
  };

  /** A cabin tool on a tile: open the cabin that is there, or build the chosen kind on the spot. */
  const cabinTool = (x: number, y: number, tier: number) => {
    const existing = cabinNear(x, y, 1);
    if (existing) {
      openCabin(existing.x, existing.y);
      return;
    }
    const spec = CABIN_TIERS[tier];
    const problem = cabinProblem(x, y) ?? (spec.price > budget ? `Ikke råd: ${kr(spec.price)}` : null);
    if (problem) {
      showRefusal(x, y, problem);
      return;
    }
    budget -= spec.price;
    placeOutlet(x, y, tier, "cabin");
    const where = nearestPlace(x, y);
    cabinBuiltToday = `${spec.name}${where ? ` ved ${where}` : ""}`;
    showToast(`${TOOL_ICONS[tier === 2 ? "hytte" : "koie"]} <strong>${spec.name}</strong> står klar${where ? ` ved ${where}` : ""}. ${spec.rooms ? "Sengene er redd opp og komfyren er varm." : "Vaffeljernet er plugget i, og de frivillige har satt opp vaktliste."} Klikk på hytta for å se hvordan det går.`);
    refreshHud();
  };

  /** Existing cabins with someone serving: the club claims them by bringing the track within reach. */
  const claimCabins = () => {
    for (const p of map.pois) {
      if (p.kind !== "cafe" || !p.name || cabinNear(p.x, p.y, 0)) {
        continue;
      }
      let reached = false;
      for (let dy = -CABIN_REACH; dy <= CABIN_REACH && !reached; dy++) {
        for (let dx = -CABIN_REACH; dx <= CABIN_REACH && !reached; dx++) {
          reached = tracks.has(p.x + dx, p.y + dy);
        }
      }
      if (reached) {
        placeOutlet(p.x, p.y, 0, "cabin", p.name);
        cabinClaimedToday = p.name;
        if (!fastForwarding) {
          showToast(`🛖 <strong>${p.name} er koblet til løypenettet!</strong> Skiløperne har fått et turmål, og stua selger vafler for løypelaget.`);
        }
      }
    }
  };

  /** Waffle stands at day's end: the electricity bill, and whether the machinery holds up for tomorrow. */
  const closeKiosks = (day: number) => {
    let bill = 0;
    let guests = 0;
    let rooms = 0;
    for (const k of kiosks) {
      bill += k.spec.dailyCost;
      if (k.spec.rooms) {
        // Guests follow the club's name; weekends and holidays fill the rooms faster.
        const busy = (isWeekend(day) || isWeekend(day + 1) ? 1.3 : 0.8) * Math.sqrt(holiday(day).factor);
        const share = Math.min(1, (0.2 + 0.8 * crowd.reputation) * busy * (0.8 + 0.4 * Math.random()));
        k.guestsLastNight = Math.round(k.spec.rooms * share);
        guests += k.guestsLastNight;
        rooms += k.guestsLastNight * (k.spec.roomPrice ?? 0);
      }
      k.broken = Math.random() < k.spec.breakdown;
      if (k.broken) {
        kioskBrokenToday = true;
        showToast(`🧇 ${k.spec.name} har satt seg fast. Røren har stivnet i dysene. Stengt i dag, teknikeren er bestilt.`);
      }
    }
    budget += rooms - bill;
    return { bill, guests, rooms };
  };

  /** One row per finished day, for balancing runs. */
  /** One row per finished day: the season's account, and what balancing runs read. */
  let history: AccountRow[] = [];
  /** The cash at the start of today; what it has moved by beyond income and running costs went to building. */
  let dayStartBudget = START_BUDGET;
  const accountOf = (r: { donations: number; members: number; waffleIncome: number; rooms: number; diesel: number; power: number; built: number }): DayAccount => ({
    donations: r.donations,
    members: r.members * MEMBERSHIP_FEE,
    waffles: r.waffleIncome,
    rooms: r.rooms,
    diesel: r.diesel,
    power: r.power,
    built: r.built,
  });
  const builtSince = (start: number, income: number, running: number) => start + income - running - budget;
  const accountsPanel = document.getElementById("accounts")!;
  const renderAccounts = () => {
    const t = crowd.today;
    const today = { donations: t.donations, members: t.members, waffleIncome: t.waffleIncome, rooms: 0, diesel: dieselToday, power: 0, built: 0 };
    today.built = builtSince(dayStartBudget, t.donations + t.members * MEMBERSHIP_FEE + t.waffleIncome, dieselToday);
    accountsPanel.innerHTML = accountsHtml(history.map(accountOf), accountOf(today), {
      km: (tracks.size * map.tileSize) / 1000,
      dieselPerKm: (COST_PER_TILE * 1000) / map.tileSize,
      connected: crowd.trailheads.filter((h) => h.entry).length,
      skiersThisSeason: history.reduce((s, r) => s + r.skiers, 0) + t.skiers,
    });
  };
  const showAccounts = (open: boolean) => {
    accountsPanel.hidden = !open;
    if (open) {
      renderAccounts();
    }
  };
  hud.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest(".cash")) {
      showAccounts(accountsPanel.hidden);
    }
  });
  accountsPanel.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("[data-accounts='close']")) {
      showAccounts(false);
    }
  });

  const closeDay = (day: number) => {
    yesterdayHyped = crowd.hype;
    incidentsYesterday = incidentsToday;
    incidentsToday = [];
    const stats = crowd.endDay();
    yesterday = stats;
    const { bill: power, guests, rooms } = closeKiosks(day);
    const snowFell = snowToday;
    logNews(day, stats, guests);
    const happy = stats.finished > 0 ? Math.round((stats.satisfaction / stats.finished) * 100) : 0;
    const diesel = dieselToday;
    dieselToday = 0;
    history.push({
      day,
      skiers: stats.skiers,
      happy: stats.finished > 0 ? stats.satisfaction / stats.finished : null,
      donations: stats.donations,
      members: stats.members,
      waffles: stats.waffles,
      waffleIncome: stats.waffleIncome,
      diesel,
      power,
      guests,
      rooms,
      budget,
      reputation: crowd.reputation,
      tiles: tracks.size,
      snow: snowFell,
      groomed: paper.week.at(-1)?.groomed ?? 0,
      built: builtSince(dayStartBudget, stats.donations + stats.members * MEMBERSHIP_FEE + stats.waffleIncome + rooms, diesel + power),
    });
    dayStartBudget = budget;
    if (!accountsPanel.hidden) {
      renderAccounts();
    }
    if (stats.skiers === 0 && diesel === 0) {
      return;
    }
    showToast(`<strong>${dayLabel(day)}:</strong> ${stats.skiers} skiløpere · ${happy} % fornøyde ·
      Vipps <span class="plus">+${kr(stats.donations)}</span>
      ${stats.members > 0 ? `· ${stats.members} nye medlemmer <span class="plus">+${kr(stats.members * MEMBERSHIP_FEE)}</span>` : ""}
      ${stats.waffles > 0 ? `· 🧇 ${stats.waffles} vafler <span class="plus">+${kr(stats.waffleIncome)}</span>` : ""}
      · diesel <span class="minus">−${kr(diesel)}</span>
      ${guests > 0 ? `· 🛏 ${guests} gjester <span class="plus">+${kr(rooms)}</span>` : ""}
      ${power > 0 ? `· drift <span class="minus">−${kr(power)}</span>` : ""}`);
  };

  /** Whether a paper opens by itself when it comes out (the default) or only announces itself. */
  const autoOpen = (which: "paper" | "report"): boolean => {
    try {
      return localStorage.getItem(`${AUTO_OPEN}${which}`) !== "0";
    } catch {
      return true;
    }
  };
  const autoOpenToggle = (which: "paper" | "report") =>
    `<label class="auto-open"><input type="checkbox" data-auto="${which}" ${autoOpen(which) ? "checked" : ""}> Åpne automatisk når den kommer ut</label>`;
  const toggleAutoOpen = (e: Event): boolean => {
    const target = e.target as HTMLElement;
    const box = target.closest<HTMLInputElement>("input[data-auto]");
    if (!box) {
      // A click on the label text is passed on to the box; leave the panel alone until then.
      return target.closest("label.auto-open") !== null;
    }
    try {
      localStorage.setItem(`${AUTO_OPEN}${box.dataset.auto}`, box.checked ? "1" : "0");
    } catch {
      // Not remembered between visits; the box still applies for now.
    }
    return true;
  };

  const paper = {
    editions: [] as Edition[],
    week: [] as DayNews[],
    kmAtLastEdition: 0,
    bestWeek: 0,
    lastDay: -1,
    pressUntil: -1,
  };
  const season = {
    year: FIRST_SEASON,
    members: 0,
    kmStart: 0,
    startBudget: START_BUDGET,
    past: [] as SeasonSummary[],
    ended: undefined as SeasonSummary | undefined,
    summer: undefined as Summer | undefined,
    album: [] as AlbumPhoto[],
    ploughedAway: undefined as string[] | undefined,
  };
  let editionIndex = -1;
  const paperPanel = document.getElementById("paper")!;
  const paperButton = document.getElementById("paper-button")!;
  const trackKm = () => (tracks.size * map.tileSize) / 1000;

  const logNews = (day: number, stats: DayStats, guests: number) => {
    let groomed = 0;
    let trampled = 0;
    let icy = 0;
    let bare = 0;
    const now = clock.hours;
    for (const [x, y] of tracks.each()) {
      const i = map.index(x, y);
      groomed += now - tracks.groomedAt[i] < 24 ? 1 : 0;
      trampled += now - tracks.trampledAt[i] < 24 ? 1 : 0;
      const c = tracks.condition(x, y, weather);
      icy += c === "icy" ? 1 : 0;
      bare += c === "bare" ? 1 : 0;
    }
    const n = Math.max(1, tracks.size);
    paper.week.push({
      day,
      skiers: stats.skiers,
      happy: stats.finished > 0 ? stats.satisfaction / stats.finished : null,
      donations: stats.donations,
      members: stats.members,
      diesel: dieselToday,
      hyped: yesterdayHyped,
      roads: roadsToday,
      trampled,
      groomed,
      snow: snowToday,
      rain: rainToday,
      tiles: tracks.size,
      waffles: stats.waffles,
      kioskBought: kioskBoughtToday,
      kioskUpgrade: kioskUpgradedToday,
      expertsHired: expertsHiredToday,
      chairlift: chairliftToday,
      cabinClaimed: cabinClaimedToday,
      cabinBuilt: cabinBuiltToday,
      guests,
      kioskBroken: kioskBrokenToday,
      kiosks: kiosks.length,
      icy: icy / n,
      bare: bare / n,
    });
    roadsToday = [];
    kioskBoughtToday = null;
    kioskUpgradedToday = false;
    kioskBrokenToday = false;
    expertsHiredToday = false;
    chairliftToday = null;
    cabinClaimedToday = null;
    cabinBuiltToday = null;
    snowToday = 0;
    rainToday = 0;
    if (day + 1 >= paper.pressUntil) {
      crowd.press = 1;
    }
  };

  const publishEdition = () => {
    const groups = areas(map, tracks);
    const place = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)[0]?.[0] ?? region.title;
    const elevations = [...tracks.each()].map(([x, y]) => map.elevationAt(x, y));
    const edition = writeEdition({
      day: clock.day,
      number: paper.editions.length + 1,
      week: paper.week,
      km: trackKm(),
      kmAtLastEdition: paper.kmAtLastEdition,
      budget,
      bestWeek: paper.bestWeek,
      place,
      weather,
      lowest: elevations.length ? Math.min(...elevations) : map.elevationAt(startPoi.x, startPoi.y),
      survey: crowd.takeSurvey(),
      ploughing: paper.editions.length === 0
        ? { roads: [...new Set(map.ploughed.map((l) => l.name).filter((n): n is string => !!n))], lost: season.ploughedAway ?? [] }
        : undefined,
    });
    paper.bestWeek = Math.max(paper.bestWeek, paper.week.reduce((s, d) => s + d.skiers, 0));
    paper.kmAtLastEdition = trackKm();
    paper.week = [];
    paper.lastDay = clock.day;
    paper.editions.push(edition);
    editionIndex = paper.editions.length - 1;
    crowd.reputation = Math.min(1, Math.max(0.05, crowd.reputation + edition.tone * PRESS_REPUTATION));
    crowd.press = 1 + edition.tone * PRESS_DEMAND;
    paper.pressUntil = clock.day + PRESS_DAYS;
    const effect = edition.tone > 0 ? "God omtale: flere tar turen hit i helgen." : edition.tone < 0 ? "Dårlig omtale: noen blir hjemme i helgen." : "";
    if (autoOpen("paper") && !fastForwarding) {
      showPaper(true);
      if (effect) {
        showToast(`🗞 ${effect}`);
      }
    } else {
      showToast(`🗞 <strong>${region.names.newspaper} er ute:</strong> «${edition.headline}» ${effect} <button class="read" data-open="paper">Les avisa</button>`, 15000);
    }
    if (paperPanel.hidden) {
      paperButton.classList.add("unread");
      barShow.classList.add("unread");
    } else {
      renderPaper();
    }
  };

  const showPaper = (open: boolean) => {
    paperPanel.hidden = !open;
    if (open && document.documentElement.classList.contains("compact")) {
      reportPanel.hidden = true;
    }
    if (open) {
      paperButton.classList.remove("unread");
      barShow.classList.remove("unread");
      renderPaper();
    }
  };

  const renderPaper = () => {
    const edition = paper.editions[editionIndex];
    const bar = `<div class="bar">
        <button data-p="prev" ${editionIndex <= 0 ? "disabled" : ""}>‹</button>
        <strong>🗞 ${region.names.newspaper}</strong>
        <button data-p="next" ${editionIndex >= paper.editions.length - 1 ? "disabled" : ""}>›</button>
        <button data-p="close">✕</button>
      </div>`;
    paperPanel.innerHTML = `${bar}<div class="page">${edition ? edition.html : `<p class="empty">${region.names.newspaper} kommer ut hver torsdag. Gi dem noe å skrive om.</p>`}</div>${autoOpenToggle("paper")}`;
  };

  paperPanel.addEventListener("click", (e) => {
    if (toggleAutoOpen(e)) {
      return;
    }
    if ((e.target as HTMLElement).closest("[data-open='album']")) {
      showSeason("album");
      return;
    }
    const action = (e.target as HTMLElement).closest("button")?.dataset.p;
    if (action === "close") {
      showPaper(false);
      if (season.ended && seasonPanel.hidden) {
        showSeason(season.summer ? "summer" : "album");
      }
      return;
    }
    if (action === "prev") {
      editionIndex = Math.max(0, editionIndex - 1);
    } else if (action === "next") {
      editionIndex = Math.min(paper.editions.length - 1, editionIndex + 1);
    }
    renderPaper();
  });
  paperButton.addEventListener("click", () => showPaper(paperPanel.hidden));

  const feed: Post[] = [];
  let feedHour = -1;
  /** Absolute game hour each kind of post last went up, so the feed does not repeat itself. */
  const lastPosted = new Map<PostKind, number>();
  const feedPanel = document.getElementById("feed")!;
  const feedButton = document.getElementById("feed-button")!;
  const placeNames = map.pois.filter((p) => p.name && (p.kind === "place" || p.kind === "peak" || p.kind === "station"));
  const placeNear = (x: number, y: number) =>
    placeNames.reduce((best, p) => (Math.hypot(p.x - x, p.y - y) < Math.hypot(best.x - x, best.y - y) ? p : best), placeNames[0])?.name ?? "Marka";
  const renderFeed = () => {
    feedPanel.innerHTML = `<div class="bar"><strong>📱 ${region.names.group}</strong><button data-feed="close">✕</button></div>
      <div class="posts">${feedHtml(feed)}</div>`;
  };
  const showFeed = (open: boolean) => {
    feedPanel.hidden = !open;
    if (open) {
      feedButton.classList.remove("unread");
      renderFeed();
    }
  };
  feedButton.addEventListener("click", () => showFeed(feedPanel.hidden));
  feedPanel.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("[data-feed='close']")) {
      showFeed(false);
    }
  });

  type View = Pick<GroundShot, "camera" | "target" | "subject" | "others" | "festive" | "brag" | "zoom" | "tilt" | "eye" | "cab">;
  const lampSpots = streetLamps(map).map((l) => [l.x, l.y] as [number, number]);
  /** A photo taken standing in the world, as a skier sees it; null while fast-forwarding. */
  const groundCanvas = (view: View): HTMLCanvasElement =>
    groundPhoto({
      map,
      tracks,
      ...view,
      daylight: clock.daylight(),
      hour: clock.hourOfDay,
      snowing: weather.precipRate > 0 && weather.temperature < 0.8,
      condition: (x, y) => tracks.condition(x, y, weather),
      lamps: lampSpots,
      seed: Math.floor(clock.hours),
    });
  const groundShot = (view: View): string | null => (fastForwarding ? null : groundCanvas(view).toDataURL("image/jpeg", 0.75));
  /** Stand on the track a few metres behind a point and look past it, along the track. */
  const viewAlongTrack = (x: number, y: number, subject?: View["subject"]): View | null => {
    const tile: [number, number] = [Math.floor(x), Math.floor(y)];
    let on: [number, number] | null = tracks.has(...tile) ? tile : null;
    for (let r = 1; !on && r <= 4; r++) {
      for (let dy = -r; dy <= r && !on; dy++) {
        for (let dx = -r; dx <= r && !on; dx++) {
          if (tracks.has(tile[0] + dx, tile[1] + dy)) {
            on = [tile[0] + dx, tile[1] + dy];
          }
        }
      }
    }
    const next = on ? tracks.neighbours(...on) : [];
    if (!on || next.length === 0) {
      return null;
    }
    const n = next[Math.floor(hash(on[0], on[1], Math.floor(clock.hours)) * next.length)];
    const onTrack = on[0] === tile[0] && on[1] === tile[1];
    const [ox, oy] = onTrack ? [x, y] : [on[0] + 0.5, on[1] + 0.5];
    const len = Math.hypot(n[0] + 0.5 - ox, n[1] + 0.5 - oy) || 1;
    const [dx, dy] = [(n[0] + 0.5 - ox) / len, (n[1] + 0.5 - oy) / len];
    if (!onTrack && subject) {
      return { camera: [ox, oy], target: [x, y], subject };
    }
    if (!subject) {
      return { camera: [ox - dx * 0.3, oy - dy * 0.3], target: [ox + dx * 3, oy + dy * 3] };
    }
    return { camera: [ox + dx * 0.45, oy + dy * 0.45], target: [ox - dx * 2, oy - dy * 2], subject };
  };
  /** Showing off the weather: stand a few metres behind the subject, facing the sun. */
  const viewIntoSun = (x: number, y: number, subject?: View["subject"]): View => {
    let [sx, sy] = sunDirection(clock.hourOfDay);
    // Where the track runs roughly towards the sun, follow it, so it leads into the picture.
    const [tx, ty] = [Math.floor(x), Math.floor(y)];
    let best = 0.6;
    for (const [nx, ny] of tracks.has(tx, ty) ? tracks.neighbours(tx, ty) : []) {
      const len = Math.hypot(nx + 0.5 - x, ny + 0.5 - y) || 1;
      const [dx, dy] = [(nx + 0.5 - x) / len, (ny + 0.5 - y) / len];
      if (dx * sx + dy * sy > best) {
        best = dx * sx + dy * sy;
        [sx, sy] = [dx, dy];
      }
    }
    return { camera: [x - sx * 0.45, y - sy * 0.45], target: [x + sx * 2, y + sy * 2], subject, brag: true };
  };
  /** From the top station, down the lift line and out over the valley. */
  const viewDownLift = (): View | null => {
    const pts = alpine.mainLift?.line.pts;
    if (!pts) {
      return null;
    }
    const [bottom, top] = [pts[0], pts[pts.length - 1]];
    const len = Math.hypot(bottom[0] - top[0], bottom[1] - top[1]) || 1;
    return { camera: [top[0] + ((bottom[0] - top[0]) / len) * 1.2, top[1] + ((bottom[1] - top[1]) / len) * 1.2], target: [bottom[0], bottom[1]] };
  };

  /** Posts kept, and how many of the newest keep their photo; old photos would fill the save. */
  const FEED_KEPT = 30;
  const FEED_PHOTOS = 10;
  const post = (kind: PostKind, at: [number, number] | null, extra: { km?: number; waffles?: number; driver?: string; road?: string; subject?: string; author?: string } = {}, view: View | null = null) => {
    const [x, y] = at ?? [startPoi.x, startPoi.y];
    const p = writePost(kind, {
      day: clock.day,
      hour: clock.hourOfDay,
      place: placeNear(x, y),
      temperature: weather.temperature,
      reputation: crowd.reputation,
      driver: extra.driver ?? fleet.groomers[0]?.name ?? "Gamle Gunnar",
      km: extra.km,
      waffles: extra.waffles,
      road: extra.road,
      subject: extra.subject,
      author: extra.author,
    }, view ? groundShot(view) : at ? takePhoto(x, y) : null, Math.floor(clock.hours * 7.3) + feed.length);
    feed.push(p);
    if (p.photo && at) {
      season.album = keepInAlbum(season.album, { x: x + 0.5, y: y + 0.5, day: p.day, kind, author: p.author, text: p.text, likes: p.likes, photo: p.photo });
    }
    feed.splice(0, Math.max(0, feed.length - FEED_KEPT));
    feed.slice(0, -FEED_PHOTOS).forEach((old) => (old.photo = null));
    lastPosted.set(kind, clock.hours);
    crowd.reputation = Math.min(1, Math.max(0.05, crowd.reputation + p.tone * FEED_REPUTATION));
    if (feedPanel.hidden) {
      feedButton.classList.add("unread");
    } else {
      renderFeed();
    }
  };

  const since = (kind: PostKind) => clock.hours - (lastPosted.get(kind) ?? -Infinity);
  const lastAny = () => Math.max(...[...lastPosted.values(), -Infinity]);
  /** Once an hour: whether anything in the world is worth a post. At most a few a day. */
  const feedTick = () => {
    if (fleet.garages.length === 0 || clock.hours - lastAny() < 3) {
      return;
    }
    const h = clock.hourOfDay;
    const chance = (p: number) => Math.random() < p;
    const working = fleet.groomers.find((g) => g.state === "grooming" && g.groomedTonight > 15);
    if (working && (h >= 21 || h < 5) && since("groomed") > 14 && chance(0.35)) {
      post("groomed", working.tile, { km: (working.groomedTonight * map.tileSize) / 1000, driver: working.name }, viewAlongTrack(working.px, working.py, { kind: "snowcat", x: working.px, y: working.py }));
      return;
    }
    if (tracks.size === 0) {
      return;
    }
    let fresh = 0;
    let icy = 0;
    let snowed = 0;
    const where: Record<string, [number, number]> = {};
    for (const [x, y] of tracks.each()) {
      const c = tracks.condition(x, y, weather);
      fresh += c === "fresh" ? 1 : 0;
      icy += c === "icy" ? 1 : 0;
      snowed += c === "snowed" ? 1 : 0;
      if (!where[c] || Math.random() < 0.05) {
        where[c] = [x, y];
      }
    }
    const share = (n: number) => n / tracks.size;
    const day = h >= 9 && h < 16 && clock.daylight() > 0.8;
    if (day && weather.precipRate === 0 && weather.temperature < -2 && share(fresh) > 0.4 && since("perfect") > 30 && chance(isWeekend(clock.day) ? 0.3 : 0.12)) {
      const skier = crowd.skiers.find((sk) => !sk.done && tracks.has(...sk.tile) && tracks.condition(...sk.tile, weather) === "fresh");
      const at = skier ? ([skier.px, skier.py] as [number, number]) : [where.fresh[0] + 0.5, where.fresh[1] + 0.5] as [number, number];
      post("perfect", skier?.tile ?? where.fresh, {}, viewIntoSun(at[0], at[1], { kind: "skier", x: at[0], y: at[1], colour: SKIER_COLOURS[Math.floor(Math.random() * SKIER_COLOURS.length)] }));
      return;
    }
    if (day && share(icy) > 0.3 && since("icy") > 96 && chance(0.25)) {
      post("icy", where.icy, {}, viewAlongTrack(where.icy[0] + 0.5, where.icy[1] + 0.5));
      return;
    }
    if (h >= 8 && h < 18 && share(snowed) > 0.4 && since("snowed") > 40 && chance(0.25)) {
      post("snowed", where.snowed, {}, viewAlongTrack(where.snowed[0] + 0.5, where.snowed[1] + 0.5));
      return;
    }
    const moose = whimsy.moose.find((m) => {
      const [mx, my] = [Math.floor(m.x / PX), Math.floor(m.y / PX)];
      return tracks.has(mx, my) || tracks.neighbours(mx, my).length > 0;
    });
    if (moose && clock.daylight() > 0.3 && since("moose") > 96 && chance(0.4)) {
      const [mx, my] = [moose.x / PX, moose.y / PX];
      post("moose", [Math.floor(mx), Math.floor(my)], {}, viewAlongTrack(mx, my, { kind: "moose", x: mx, y: my }));
      return;
    }
    const house = region.christmasHouse;
    if (house && clock.day >= 7 && clock.day <= LIGHTS_DOWN_DAY && h >= 17 && h < 22 && since("julehus") > 24 * 10 && chance(0.15)) {
      post("julehus", [house.x, house.y], {}, { camera: [house.x + 1.5, house.y + 2.1], target: [house.x + 0.5, house.y + 0.5], festive: [house.x, house.y] });
      return;
    }
    const busy = kiosks.find((k) => k.kind === "stand" && k.soldToday >= 60);
    if (busy && h >= 12 && h < 16 && since("waffles") > 96 && chance(0.3)) {
      post("waffles", [busy.x, busy.y], { waffles: busy.soldToday });
      return;
    }
    const top = alpine.topStation;
    if (top && crowd.liftRunning && since("chairlift") > 24 * 6 && chance(0.2)) {
      post("chairlift", [Math.floor(top[0]), Math.floor(top[1])], {}, viewDownLift());
      return;
    }
    const named = map.ploughed.filter((l) => l.name);
    const road = named[Math.floor(Math.random() * named.length)];
    if (road && day && since("ploughed") > 24 * 12 && chance(isWeekend(clock.day) ? 0.12 : 0.03)) {
      const i = 1 + Math.floor(Math.random() * (road.pts.length - 1));
      const [[ax, ay], [bx, by]] = [road.pts[i - 1], road.pts[i]];
      const len = Math.hypot(bx - ax, by - ay) || 1;
      const [dx, dy] = [(bx - ax) / len, (by - ay) / len];
      const skier = { kind: "skier" as const, x: ax + dx * 1.6, y: ay + dy * 1.6, colour: SKIER_COLOURS[Math.floor(Math.random() * SKIER_COLOURS.length)] };
      post("ploughed", [Math.floor(ax), Math.floor(ay)], { road: road.name }, { camera: [ax - dx * 0.4, ay - dy * 0.4], target: [ax + dx * 3, ay + dy * 3], subject: skier });
      return;
    }
    if (h >= 8 && h < 23 && since("offtopic") > 72 && chance(0.03)) {
      post("offtopic", null);
    }
  };

  // Click a skier, a snowcat or the train: a card about it, and a camera to photograph it.
  type Subject = { kind: "skier"; skier: Skier } | { kind: "snowcat"; groomer: Groomer } | { kind: "train" };
  const inspectPanel = document.getElementById("inspect")!;
  const photoLayer = new Graphics();
  world.addChild(photoLayer);
  let inspected: Subject | null = null;
  /** The game holds still while a card is open, so the skier is still there for the picture. */
  let inspectWasPaused = false;
  /** zoom null follows the distance; tilt is added to the automatic framing. */
  /** live: the snowcat's cab view, redrawn while the game runs; follow keeps the map on it. */
  let shooting: { aim: [number, number]; mode: PhotoMode; snap: string | null; shared: boolean; zoom: number | null; tilt: number; turn: number; live: boolean; follow: boolean } | null = null;
  /** Live view slows the game to this many game hours per real hour, or null for the game's own speed. */
  const setLivePace = (pace: number | null) => {
    clock.slowMotion = pace;
    refreshHud();
  };
  /** Labels, cursors and bubbles are put away while aiming, and how they were. */
  let tucked: { layer: Container; visible: boolean }[] = [];
  const tuckAway = (away: boolean) => {
    if (away && !tucked.length) {
      tucked = notInPhotos().map((layer) => ({ layer, visible: layer.visible }));
      tucked.forEach((t) => (t.layer.visible = false));
    } else if (!away) {
      tucked.forEach((t) => (t.layer.visible = t.visible));
      tucked = [];
    }
  };

  const subjectAt = (s: Subject): [number, number] | null => {
    if (s.kind === "skier") {
      return s.skier.done ? null : [s.skier.px, s.skier.py];
    }
    if (s.kind === "snowcat") {
      return s.groomer.state === "home" ? null : [s.groomer.px, s.groomer.py];
    }
    const cars = whimsy.train?.carriages();
    return cars?.length ? [cars.reduce((s, c) => s + c.x, 0) / cars.length / PX, cars.reduce((s, c) => s + c.y, 0) / cars.length / PX] : null;
  };

  /** Where the driver sits and which way the vehicle faces, for the views from the cab. */
  const driverSeat = (s: Subject): { at: [number, number]; facing: number; eye: number } | null => {
    if (s.kind === "snowcat") {
      return s.groomer.state === "home" ? null : { at: [s.groomer.px, s.groomer.py], facing: s.groomer.looking, eye: 2.7 };
    }
    if (s.kind === "train" && whimsy.train) {
      const lead = whimsy.train.carriages()[0];
      const f = whimsy.train.facing;
      const ahead = TRAIN_CAB_AHEAD_M / map.tileSize;
      return { at: [lead.x / PX + Math.cos(f) * ahead, lead.y / PX + Math.sin(f) * ahead], facing: f, eye: 3.4 };
    }
    return null;
  };

  const pickSubject = (wx: number, wy: number): Subject | null => {
    if (!detail.visible) {
      return null;
    }
    const r = Math.max(9, 14 / camera.scale);
    const skier = crowd.skiers.find((s) => !s.done && Math.hypot(s.px * PX - wx, s.py * PX - 6 - wy) < r);
    if (skier) {
      return { kind: "skier", skier };
    }
    const groomer = fleet.groomers.find((g) => g.state !== "home" && Math.hypot(g.px * PX - wx, g.py * PX - wy) < r + 6);
    if (groomer) {
      return { kind: "snowcat", groomer };
    }
    if (whimsy.train?.sprite.children.some((c) => Math.hypot(c.x - wx, c.y - wy) < r + 8)) {
      return { kind: "train" };
    }
    return null;
  };

  const subjectLabel = (s: Subject): string =>
    s.kind === "skier" ? `${s.skier.kind.name === "søndagsfamilie" ? "søndagsfamilien" : `${s.skier.kind.name}en`}` : s.kind === "snowcat" ? "løypemaskina" : "toget";

  /** The train on the map stands for a new departure every other game hour. */
  const trainSeed = () => Math.floor(clock.hours / 2);

  /** Who shares the picture: the snowcat's or train's driver from the cab, the skier for the view, and a passer-by for a picture of something. */
  const photographer = (s: Subject, mode: PhotoMode): [PostKind, { driver?: string; author?: string; subject?: string }] => {
    if (mode === "of") {
      return ["skiershot", { subject: subjectLabel(s) }];
    }
    if (s.kind === "snowcat") {
      return ["snapshot", { driver: s.groomer.name }];
    }
    if (s.kind === "train") {
      return ["trainshot", { author: `${personName(trainSeed())} · lokfører` }];
    }
    return ["skiershot", { author: personName(s.skier.seed) }];
  };

  const subjectShape = (s: Subject, at: [number, number]): NonNullable<View["subject"]> => {
    if (s.kind === "skier") {
      return { kind: "skier", x: at[0], y: at[1], colour: s.skier.jacket };
    }
    if (s.kind === "snowcat") {
      return { kind: "snowcat", x: at[0], y: at[1] };
    }
    const f = whimsy.train!.facing;
    const cars = whimsy.train!.carriages().map((c): [number, number, number] => [c.x / PX, c.y / PX, Math.cos(c.angle - f) < 0 ? c.angle + Math.PI : c.angle]);
    return { kind: "train", x: at[0], y: at[1], cars };
  };

  /** What the camera sees for the current aim: the subject from where the player stands, or the view from the subject. */
  /** The skiers out on the track round a camera, except the one the picture is of. */
  const skiersAround = (camera: [number, number]): NonNullable<View["others"]> =>
    crowd.skiers
      .filter((s) => !s.done && s.px > 0 && (inspected?.kind !== "skier" || inspected.skier !== s) && Math.hypot(s.px - camera[0], s.py - camera[1]) < OTHERS_RANGE)
      .map((s) => ({ kind: "skier", x: s.px, y: s.py, colour: s.jacket }));

  const photoView = (): View | null => {
    const view = framing();
    return view && { ...view, others: skiersAround(view.camera) };
  };

  const framing = (): View | null => {
    const at = inspected && shooting ? subjectAt(inspected) : null;
    if (!at || !shooting || !inspected) {
      return null;
    }
    const mode = shooting.mode;
    if (mode === "front" || mode === "left" || mode === "right") {
      const seat = driverSeat(inspected);
      if (!seat || inspected.kind === "skier") {
        return null;
      }
      const a = seat.facing + (mode === "left" ? -Math.PI / 2 : mode === "right" ? Math.PI / 2 : 0) + shooting.turn;
      const [sx, sy] = seat.at;
      return {
        camera: [sx, sy],
        target: [sx + Math.cos(a) * 4, sy + Math.sin(a) * 4],
        eye: seat.eye,
        cab: { kind: inspected.kind, window: mode },
        zoom: shooting.zoom ?? 1,
        tilt: shooting.tilt,
      };
    }
    const [ax, ay] = shooting.aim;
    const len = Math.hypot(ax - at[0], ay - at[1]) || 1;
    const [dx, dy] = [(ax - at[0]) / len, (ay - at[1]) / len];
    if (mode === "from") {
      return { camera: [at[0] + dx * 0.3, at[1] + dy * 0.3], target: [at[0] + dx * 4, at[1] + dy * 4], zoom: shooting.zoom ?? 1, tilt: shooting.tilt };
    }
    const lens = PHOTO_LENS[inspected.kind];
    const dist = Math.max(lens.nearest, Math.min(lens.farthest, len));
    // Zoom in from further away, so the subject stays about the size it would be from close by.
    const zoom = shooting.zoom ?? Math.max(1, Math.min(PHOTO_MAX_ZOOM, (dist * map.tileSize) / lens.framing));
    return { camera: [at[0] + dx * dist, at[1] + dy * dist], target: at, subject: subjectShape(inspected, at), zoom, tilt: shooting.tilt };
  };

  /** On the map: where the camera stands, what it sees, and a ring round the subject. Sized for the screen, not the map. */
  const drawAim = () => {
    photoLayer.clear();
    const view = photoView();
    const at = inspected ? subjectAt(inspected) : null;
    if (!view || !at) {
      return;
    }
    const k = 1 / camera.scale;
    const [cx, cy] = [view.camera[0] * PX, view.camera[1] * PX];
    const [tx, ty] = [view.target[0] * PX, view.target[1] * PX];
    const a = Math.atan2(ty - cy, tx - cx);
    const half = Math.atan(Math.tan((32 * Math.PI) / 180) / (view.zoom ?? 1));
    const reach = Math.max(110 * k, Math.hypot(tx - cx, ty - cy) * 1.6);
    const cone = [cx, cy, cx + Math.cos(a - half) * reach, cy + Math.sin(a - half) * reach, cx + Math.cos(a + half) * reach, cy + Math.sin(a + half) * reach];
    photoLayer.poly(cone).fill({ color: 0xffb020, alpha: 0.35 }).stroke({ color: 0xffffff, width: 4 * k, join: "round" });
    photoLayer.poly(cone).stroke({ color: 0xc25e00, width: 2 * k, join: "round" });
    photoLayer.circle(at[0] * PX, at[1] * PX - 6, 13 * k).stroke({ color: 0xffffff, width: 4 * k }).stroke({ color: 0xe8591a, width: 2.5 * k });
    photoLayer.circle(cx, cy, 8 * k).fill(0x1f2a44).stroke({ color: 0xffffff, width: 3 * k });
    photoLayer.circle(cx, cy, 3.5 * k).fill(0x8fd0ff);
  };

  let previewPending = false;
  const renderPreview = () => {
    drawAim();
    if (previewPending) {
      return;
    }
    previewPending = true;
    setTimeout(() => {
      previewPending = false;
      const view = photoView();
      const canvas = inspectPanel.querySelector<HTMLCanvasElement>("canvas.preview");
      if (!view || !canvas || fastForwarding) {
        return;
      }
      canvas.getContext("2d")!.drawImage(groundCanvas(view), 0, 0, canvas.width, canvas.height);
      const label = inspectPanel.querySelector(".lens .zoom");
      if (label) {
        label.textContent = zoomLabel(view.zoom ?? 1);
      }
      inspectPanel.querySelector("[data-inspect='auto']")?.classList.toggle("on", shooting?.zoom === null && shooting.tilt === 0);
    }, 60);
  };

  const renderInspect = () => {
    if (!inspected) {
      return;
    }
    if (shooting?.snap) {
      inspectPanel.innerHTML = snapHtml(shooting.snap, shooting.shared);
    } else if (shooting) {
      inspectPanel.innerHTML = cameraHtml({
        kind: inspected.kind,
        label: subjectLabel(inspected),
        mode: shooting.mode,
        zoom: photoView()?.zoom ?? 1,
        manual: shooting.zoom !== null || shooting.tilt !== 0,
        live: shooting.live ? { follow: shooting.follow, pace: clock.slowMotion, driving: inspected.kind === "snowcat" ? inspected.groomer.steering : null } : undefined,
      });
      renderPreview();
    } else if (inspected.kind === "skier") {
      inspectPanel.innerHTML = inspectHtml({ kind: "skier", profile: inspected.skier.profile() });
    } else if (inspected.kind === "snowcat") {
      const g = inspected.groomer;
      inspectPanel.innerHTML = inspectHtml({ kind: "snowcat", name: g.name, status: g.status, tonightKm: (g.groomedTonight * map.tileSize) / 1000, totalKm: (g.totalGroomed * map.tileSize) / 1000 });
    } else {
      inspectPanel.innerHTML = inspectHtml({ kind: "train", seed: trainSeed() });
    }
    inspectPanel.hidden = false;
  };

  const closeInspect = () => {
    tuckAway(false);
    if (inspected?.kind === "snowcat") {
      inspected.groomer.releaseControls();
    }
    if (clock.slowMotion !== null) {
      setLivePace(null);
    }
    if (inspected) {
      clock.paused = inspectWasPaused;
      refreshHud();
    }
    shooting = null;
    inspected = null;
    photoLayer.clear();
    inspectPanel.hidden = true;
  };

  const openInspect = (s: Subject) => {
    closeInspect();
    inspectWasPaused = clock.paused;
    clock.paused = true;
    refreshHud();
    inspected = s;
    renderInspect();
  };

  /** Find a snowcat on the map: out on the track it gets its card, at home the garage is shown. */
  const goToGroomer = (g: Groomer | undefined) => {
    if (!g) {
      return;
    }
    if (g.state === "home") {
      camera.frame((g.garage.x + 0.5) * PX, (g.garage.y + 0.5) * PX, app.screen.width / 2, app.screen.height / 2, GOTO_ZOOM_LEVEL);
      showToast(`🚜 ${g.name} står i garasjen.`);
      return;
    }
    camera.frame(g.px * PX, g.py * PX, app.screen.width / 2, app.screen.height / 2, GOTO_ZOOM_LEVEL);
    openInspect({ kind: "snowcat", groomer: g });
  };

  /** Take the wheel of a snowcat, sending it out of the garage if need be, and watch from its cab. */
  const driveGroomer = (g: Groomer) => {
    const refused = g.takeControls(tracks);
    if (refused) {
      showToast(`🚜 ${refused}`);
      return;
    }
    if (inspected?.kind !== "snowcat" || inspected.groomer !== g) {
      openInspect({ kind: "snowcat", groomer: g });
    }
    if (!shooting?.live) {
      startShooting(true);
    } else {
      renderInspect();
    }
  };

  /** The player's steering, from the buttons or the arrow keys. */
  const steer = (how: "go" | "stop" | "left" | "right" | "back") => {
    const wheel = inspected?.kind === "snowcat" ? inspected.groomer.steering : null;
    if (!wheel) {
      return;
    }
    if (how === "go") {
      wheel.go = true;
    } else if (how === "stop") {
      if (!wheel.go) {
        wheel.turnAround = true;
        wheel.go = true;
      } else {
        wheel.go = false;
      }
    } else if (how === "back") {
      wheel.turnAround = true;
      wheel.go = true;
    } else {
      const turn = how === "left" ? -1 : 1;
      wheel.turn = wheel.turn === turn ? 0 : turn;
    }
    renderInspect();
  };

  /** The screen point beside the photo panel where the subject is shown. */
  const besidePanel = (): [number, number] => {
    const card = inspectPanel.getBoundingClientRect();
    return card.right < app.screen.width * 0.7
      ? [(card.right + app.screen.width) / 2, app.screen.height / 2]
      : [app.screen.width / 2, (card.bottom + app.screen.height) / 2];
  };

  const startShooting = (live = false) => {
    const at = inspected ? subjectAt(inspected) : null;
    if (!at) {
      closeInspect();
      return;
    }
    // Start a little south-east of the subject, so the first picture has something in it.
    const away = PHOTO_LENS[inspected!.kind].framing / map.tileSize;
    shooting = { aim: [at[0] + away * 0.8, at[1] + away * 0.6], mode: live ? "front" : "of", snap: null, shared: false, zoom: null, tilt: 0, turn: 0, live, follow: true };
    if (live) {
      clock.paused = false;
      timeStarted = true;
      setLivePace(clock.slowMotion ?? LIVE_DEFAULT_PACE[inspected!.kind === "train" ? "train" : "snowcat"]);
    }
    tuckAway(true);
    renderInspect();
    // Close enough to aim, with the subject beside the photo panel rather than under it.
    camera.frame(at[0] * PX, at[1] * PX, ...besidePanel(), PHOTO_ZOOM_LEVEL);
  };

  /** Point the camera with the mouse or a finger: where to stand, or where to look. */
  const aimAt = (sx: number, sy: number) => {
    if (!shooting || shooting.snap || (shooting.mode !== "of" && shooting.mode !== "from")) {
      return;
    }
    const w = world.toLocal({ x: sx, y: sy });
    shooting.aim = [w.x / PX, w.y / PX];
    renderPreview();
  };

  const turnAim = (by: number) => {
    const at = inspected && shooting ? subjectAt(inspected) : null;
    if (!at || !shooting || shooting.snap) {
      return;
    }
    if (shooting.mode === "front" || shooting.mode === "left" || shooting.mode === "right") {
      // From the driver's seat the head turns, within what the window shows.
      shooting.turn = Math.max(-CAB_TURN, Math.min(CAB_TURN, shooting.turn + by));
      renderPreview();
      return;
    }
    const [dx, dy] = [shooting.aim[0] - at[0], shooting.aim[1] - at[1]];
    const [c, s] = [Math.cos(by), Math.sin(by)];
    shooting.aim = [at[0] + dx * c - dy * s, at[1] + dx * s + dy * c];
    renderPreview();
  };

  /** Zoom by a factor from wherever the lens is now, automatic or not. */
  const zoomBy = (factor: number) => {
    if (!shooting || shooting.snap) {
      return;
    }
    shooting.zoom = Math.max(1, Math.min(PHOTO_LENS_MAX, (photoView()?.zoom ?? 1) * factor));
    renderPreview();
  };

  const tiltBy = (radians: number) => {
    if (!shooting || shooting.snap) {
      return;
    }
    shooting.tilt = Math.max(-PHOTO_TILT_MAX, Math.min(PHOTO_TILT_MAX, shooting.tilt + radians));
    renderPreview();
  };

  const shoot = () => {
    const view = photoView();
    if (!shooting || !view) {
      return;
    }
    shooting.snap = groundShot(view);
    photoLayer.clear();
    renderInspect();
  };

  // In the preview: drag sideways to turn, up and down to tilt, and roll the wheel to zoom.
  let dragging: { x: number; y: number } | null = null;
  inspectPanel.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).matches("canvas.preview")) {
      dragging = { x: e.clientX, y: e.clientY };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }
  });
  inspectPanel.addEventListener("pointermove", (e) => {
    if (!dragging) {
      return;
    }
    const zoom = photoView()?.zoom ?? 1;
    const perPixel = PHOTO_DRAG / zoom;
    turnAim(-(e.clientX - dragging.x) * perPixel);
    tiltBy((e.clientY - dragging.y) * perPixel);
    dragging = { x: e.clientX, y: e.clientY };
  });
  inspectPanel.addEventListener("pointerup", () => (dragging = null));
  inspectPanel.addEventListener("pointercancel", () => (dragging = null));
  inspectPanel.addEventListener("wheel", (e) => {
    if ((e.target as HTMLElement).matches("canvas.preview")) {
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? PHOTO_ZOOM_STEP : 1 / PHOTO_ZOOM_STEP);
    }
  }, { passive: false });

  // The aim is drawn at a fixed size on screen, so it follows the zoom. The live view is redrawn a few times a second.
  let lastLiveFrame = 0;
  app.ticker.add(() => {
    if (!shooting || shooting.snap) {
      return;
    }
    if (shooting.live && inspected && inspected.kind !== "skier") {
      const seat = driverSeat(inspected);
      if (shooting.follow && seat) {
        camera.follow(seat.at[0] * PX, seat.at[1] * PX, ...besidePanel());
      }
      const now = performance.now();
      if (now - lastLiveFrame > LIVE_FRAME_MS && !clock.paused) {
        lastLiveFrame = now;
        renderPreview();
      }
      const status = inspectPanel.querySelector(".live-status");
      if (status) {
        const g = inspected.kind === "snowcat" ? inspected.groomer : null;
        const next = g?.steering?.turn ? ` · neste kryss: til ${g.steering.turn < 0 ? "venstre" : "høyre"}` : "";
        status.textContent = g
          ? `${g.status} · ${((g.groomedTonight * map.tileSize) / 1000).toFixed(1).replace(".", ",")} km i natt${next}`
          : whimsy.train?.stopped ? "Står på stasjonen" : `${capital(region.names.railway)}, i fart`;
      }
    }
    drawAim();
  });

  inspectPanel.addEventListener("click", (e) => {
    const action = (e.target as HTMLElement).closest("button")?.dataset.inspect;
    if (!action || !inspected) {
      return;
    }
    if (action === "close" || action === "cancel") {
      closeInspect();
    } else if (action === "photo" || action === "live" || action === "again") {
      startShooting(action === "live" || (action === "again" && !!shooting?.live));
    } else if (action.startsWith("pace-") && shooting?.live) {
      setLivePace(LIVE_PACES[inspected.kind === "train" ? "train" : "snowcat"][Number(action.slice(5))][0]);
      renderInspect();
    } else if (action === "take-wheel" && inspected.kind === "snowcat") {
      driveGroomer(inspected.groomer);
    } else if (action === "wheel" && inspected.kind === "snowcat") {
      if (inspected.groomer.steering) {
        inspected.groomer.releaseControls();
        renderInspect();
      } else {
        driveGroomer(inspected.groomer);
      }
    } else if (action === "drive-go") {
      steer(inspected.kind === "snowcat" && inspected.groomer.steering?.go ? "stop" : "go");
    } else if (action === "drive-left" || action === "drive-right" || action === "drive-back") {
      steer(action === "drive-left" ? "left" : action === "drive-right" ? "right" : "back");
    } else if (action === "follow" && shooting) {
      shooting.follow = !shooting.follow;
      renderInspect();
    } else if ((action === "of" || action === "from" || action === "front" || action === "left" || action === "right") && shooting) {
      shooting.mode = action;
      shooting.zoom = null;
      shooting.tilt = 0;
      shooting.turn = 0;
      renderInspect();
    } else if (action === "shoot") {
      shoot();
    } else if (action === "zoom-in" || action === "zoom-out") {
      zoomBy(action === "zoom-in" ? PHOTO_ZOOM_STEP : 1 / PHOTO_ZOOM_STEP);
    } else if (action === "tilt-up" || action === "tilt-down") {
      tiltBy(action === "tilt-up" ? PHOTO_TILT_STEP : -PHOTO_TILT_STEP);
    } else if (action === "auto" && shooting) {
      shooting.zoom = null;
      shooting.tilt = 0;
      renderPreview();
    } else if (action === "share" && shooting?.snap && !shooting.shared) {
      const view = photoView();
      const at = subjectAt(inspected);
      if (view && at) {
        const [kind, extra] = photographer(inspected, shooting.mode);
        post(kind, [Math.floor(at[0]), Math.floor(at[1])], extra, view);
        shooting.shared = true;
        showToast("📱 Bildet er delt i gruppa.");
        renderInspect();
      }
    } else if (action === "download" && shooting?.snap) {
      const a = document.createElement("a");
      a.href = shooting.snap;
      a.download = `loype-tycoon-${dayLabel(clock.day).replace(/[^\p{L}\p{N}]+/gu, "-")}.jpg`;
      a.click();
    }
  });

  /** The winter is over when, from March on, hardly any of the track has snow left to ski on. */
  const snowGone = (day: number): boolean => {
    if (day >= MAX_SEASON_DAYS - 1) {
      return true;
    }
    if (day < EARLIEST_SEASON_END) {
      return false;
    }
    const skiable = (x: number, y: number) => weather.snowDepthAt(map.elevationAt(x, y)) >= MIN_GROOMING_DEPTH * 0.6;
    if (tracks.size === 0) {
      return !skiable(startPoi.x, startPoi.y);
    }
    let left = 0;
    for (const [x, y] of tracks.each()) {
      left += skiable(x, y) ? 1 : 0;
    }
    return left < tracks.size * 0.05;
  };

  const seasonPanel = document.getElementById("season")!;
  const endSeason = (day: number) => {
    clock.ended = true;
    clock.paused = true;
    const summary = summarise({
      year: season.year,
      number: season.past.length + 1,
      endDay: day,
      history,
      carriedMembers: season.members,
      startBudget: season.startBudget,
      budget,
      km: trackKm(),
      kmStart: season.kmStart,
      reputation: crowd.reputation,
      editions: paper.editions,
      chairlift: alpine.hasChairlift,
      kiosks: kiosks.filter((k) => k.kind === "stand").length,
      cabins: kiosks.filter((k) => k.kind === "cabin").length,
    });
    season.ended = summary;
    paper.editions.push(seasonEdition(summary, paper.editions.length + 1));
    paper.lastDay = day;
    editionIndex = paper.editions.length - 1;
    if (!fastForwarding) {
      announceSeasonEnd();
    }
  };

  const announceSeasonEnd = () => {
    autosave();
    showPaper(true);
    showToast("🏁 <strong>Sesongen er over!</strong> Snøen er borte fra løypene. Les sesongavisa, så er det årsmøte.", 12000);
  };

  const showSeason = (step: "album" | "meeting" | "summer") => {
    const summary = season.ended!;
    if (step === "summer" && !season.summer) {
      season.summer = settleSummer(summary, fleet.groomers.length);
      autosave();
    }
    seasonPanel.innerHTML =
      step === "album"
        ? albumHtml(summary.year, season.album, seasonMap(map, overviewCanvas, chunks.fields, tracks, [startPoi.x, startPoi.y]))
        : step === "meeting"
          ? meetingHtml(summary)
          : summerHtml(summary, season.summer!, summary.year + 1);
    seasonPanel.classList.toggle("wide", step === "album");
    seasonPanel.hidden = false;
    seasonPanel.scrollTop = 0;
    showPaper(false);
  };

  /** How much milder or colder than normal a winter is; the first one is a normal winter. */
  const winterShift = (year: number) => {
    if (year === FIRST_SEASON) {
      return 0;
    }
    const r = Math.sin(year * 12.9898) * 43758.5453;
    return (r - Math.floor(r) - 0.5) * 3;
  };

  /** Carry the club into next winter: the network and buildings stay, the snow, the week and the books start over. */
  const startNextSeason = () => {
    const summary = season.ended!;
    const summer = season.summer!;
    const year = summary.year + 1;
    const base = snapshot();
    const fresh = new Weather(year, winterShift(year));
    const km = trackKm();
    const next: SaveGame = {
      ...base,
      label: `${seasonName(year)} · ny sesong · ${km.toFixed(1)} km · ${kr(summer.budget)}`,
      clock: { hours: 20, speedIndex: base.clock.speedIndex },
      budget: summer.budget,
      reputation: 0.5 + (rating(summary) - 0.5) * 0.7,
      today: emptyDay(),
      hype: false,
      yesterday: null,
      yesterdayHyped: false,
      dieselToday: 0,
      incidentsToday: [],
      incidentsYesterday: [],
      lastReportDay: -1,
      snowSinceReport: 0,
      rainSinceReport: 0,
      weather: { snowDepth: fresh.snowDepth, highDepth: fresh.highDepth, plans: fresh.allPlans() },
      tracks: base.tracks.map(([col, row, , , , , , , crossing]) => [col, row, 0, 0, 0, 0, null, null, crossing, 0]),
      kiosks: base.kiosks?.map((k) => ({ ...k, soldToday: 0, broken: false })),
      reports: [],
      varingen: { ...base.varingen!, editions: [], week: [], kmAtLastEdition: km, lastDay: -1, pressUntil: -1, press: 1, roadsToday: [], snowToday: 0, rainToday: 0 },
      accounts: { history: [], dayStartBudget: summer.budget },
      feed: [],
      season: { year, members: summer.members, kmStart: km, startBudget: summer.budget, past: [...season.past, summary] },
    };
    writeSlot("auto", next);
    setBoot({ kind: "file", save: next });
    reload();
  };

  seasonPanel.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const thumb = target.closest<SVGElement>("[data-photo]");
    const zoomed = target.closest<HTMLElement>("figure[data-zoom]");
    if (thumb || zoomed) {
      seasonPanel.querySelectorAll<HTMLElement>("figure[data-zoom]").forEach((f) => (f.hidden = !thumb || f.dataset.zoom !== thumb.dataset.photo));
      return;
    }
    const step = target.closest("button")?.dataset.season;
    if (step === "meeting") {
      showSeason("meeting");
    } else if (step === "summer") {
      showSeason("summer");
    } else if (step === "next") {
      startNextSeason();
    }
  });

  const reports: { report: Report; rosy: boolean }[] = [];
  let reportIndex = -1;
  const reportPanel = document.getElementById("report")!;
  const reportButton = document.getElementById("report-button")!;

  const showReport = (open: boolean) => {
    reportPanel.hidden = !open;
    if (open && document.documentElement.classList.contains("compact")) {
      paperPanel.hidden = true;
    }
    if (open) {
      reportButton.classList.remove("unread");
      renderReport();
    }
  };

  const renderReport = () => {
    const entry = reports[reportIndex];
    if (!entry) {
      reportPanel.innerHTML = `<div class="bar"><strong>📰 Føremelding</strong><button data-r="close">✕</button></div>
        <div class="body"><p>Første føremelding kommer kl. 07:00 når det finnes løyper.</p></div>`;
      return;
    }
    const latest = reportIndex === reports.length - 1;
    const editable = latest && entry.report.day === clock.day;
    reportPanel.innerHTML = `
      <div class="bar">
        <button data-r="prev" ${reportIndex === 0 ? "disabled" : ""}>‹</button>
        <strong>📰 Føremelding</strong>
        <button data-r="next" ${latest ? "disabled" : ""}>›</button>
        <button data-r="close">✕</button>
      </div>
      ${editable ? `<div class="tone">
        <button data-r="honest" class="${entry.rosy ? "" : "active"}">Ærlig</button>
        <button data-r="rosy" class="${entry.rosy ? "active" : ""}">Pynt på den ✨</button>
        <span>${entry.rosy ? "Flere kommer, men skuffer du dem, svir det." : "Det som står, stemmer."}</span>
      </div>` : ""}
      <div class="body">${entry.rosy ? entry.report.rosy : entry.report.honest}</div>${autoOpenToggle("report")}`;
  };

  reportPanel.addEventListener("click", (e) => {
    if (toggleAutoOpen(e)) {
      return;
    }
    const action = (e.target as HTMLElement).closest("button")?.dataset.r;
    const entry = reports[reportIndex];
    if (action === "close") {
      showReport(false);
    } else if (action === "prev") {
      reportIndex = Math.max(0, reportIndex - 1);
    } else if (action === "next") {
      reportIndex = Math.min(reports.length - 1, reportIndex + 1);
    } else if ((action === "honest" || action === "rosy") && entry) {
      entry.rosy = action === "rosy";
      crowd.hype = entry.rosy;
    }
    if (!reportPanel.hidden) {
      renderReport();
    }
  });
  reportButton.addEventListener("click", () => showReport(reportPanel.hidden));

  const publishReport = () => {
    const report = writeReport({
      day: clock.day,
      now: clock.hours,
      map,
      tracks,
      weather,
      hasMachine: fleet.groomers.length > 0,
      snowSinceLast: snowSinceReport,
      rainSinceLast: rainSinceReport,
      yesterday,
      yesterdayHyped,
      incidents: incidentsYesterday,
    });
    snowSinceReport = 0;
    rainSinceReport = 0;
    reports.push({ report, rosy: false });
    reportIndex = reports.length - 1;
    if (!fastForwarding && (reports.length === 1 || autoOpen("report"))) {
      showReport(true);
    } else if (reportPanel.hidden) {
      reportButton.classList.add("unread");
    } else {
      renderReport();
    }
  };

  let trailheadSignature = "";
  /** Trailheads connected at the last refresh; null until the first one, so loading a game announces nothing. */
  let knownHeads: Set<Trailhead> | null = null;
  const refreshTrailheads = () => {
    crowd.connect(tracks);
    const connected = crowd.trailheads.filter((h) => h.entry);
    const fresh = knownHeads ? connected.filter((h) => !knownHeads!.has(h)) : [];
    knownHeads = new Set(connected);
    if (fresh.length > 0 && timeStarted) {
      showToast(`⛷ Løypa når nå fram til <strong>${fresh.map((h) => h.name).join(" og ")}</strong>. Derfra kommer det flere skiløpere!`);
    }
    const choosingHome = fleet.garages.length === 0;
    const starting = tracks.size === 0;
    const showAll = choosingHome || (!starting && tool === "build");
    const signature = choosingHome
      ? "home"
      : starting
        ? "start"
        : `${showAll ? "all" : "own"}|${Math.round(crowd.reputation * 10)}|${showAll ? tracks.size : Math.round(tracks.size / 20)}|${connected.map((h) => `${h.x},${h.y}`).join(";")}`;
    if (signature === trailheadSignature) {
      return;
    }
    trailheadSignature = signature;
    trailheadLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
    headLabels.removeChildren().forEach((c) => c.destroy({ children: true }));
    if (!choosingHome && starting) {
      const garage = fleet.garages[0];
      const g = new Graphics()
        .circle((garage.x + 0.5) * PX, (garage.y + 0.5) * PX, (GARAGE_REACH + 0.5) * PX)
        .fill({ color: 0x1f5fd1, alpha: 0.1 })
        .stroke({ width: 2, color: 0x1f5fd1, alpha: 0.7 });
      trailheadLayer.addChild(g);
      return;
    }
    const open = showAll ? crowd.trailheads.filter((h) => !h.entry) : [];
    if (showAll) {
      const reach = reachFrom(map, tracks.each(), HOMES_REACH);
      const inside = (i: number) => reach[i] <= HOMES_REACH;
      trailheadLayer.addChild(zone(inside, NETWORK_ZONE), houseDots(inside, 0x1f8a3a));
    }
    for (const h of [...open, ...connected]) {
      const cx = (h.x + 0.5) * PX;
      const cy = (h.y + 0.5) * PX;
      const g = new Graphics();
      if (h.entry) {
        const [ex, ey] = h.entry;
        g.moveTo(cx, cy).lineTo((ex + 0.5) * PX, (ey + 0.5) * PX).stroke({ width: 1.5, color: 0x1f8a3a, alpha: 0.6 });
      }
      const radius = 4 + Math.sqrt(h.kind === "homes" ? h.houses * SKIERS_PER_HOUSE : h.rate) * 1.6;
      g.circle(cx, cy, radius).fill(h.entry ? 0x1f8a3a : 0x6f8197).stroke({ width: 1.5, color: 0xffffff });
      const icon = new Text({ text: h.kind === "station" ? "🚉" : h.kind === "parking" ? "P" : h.kind === "lift" ? "🚡" : "⛷", style: { fontSize: radius * 1.2, fill: 0xffffff, fontWeight: "700" }, resolution: 4 });
      icon.anchor.set(0.5);
      icon.position.set(cx, cy);
      trailheadLayer.addChild(g, icon);
      if (showAll) {
        const raw = crowd.fineSaturday(h, clock.day, h.entry ? h.network : Math.max(tracks.size, 40));
        const estimate = raw < 20 ? Math.round(raw) : Math.round(raw / 5) * 5;
        const label = new Text({
          text: h.kind !== "homes" ? `≈ ${estimate} en fin lørdag` : h.entry ? `${h.served} av ${h.houses} hus nær løypa · ≈ ${estimate} en fin lørdag` : `${h.houses} hus`,
          style: { fontSize: 11, fill: 0x16232c, fontWeight: "700", stroke: { color: 0xffffff, width: 3.5 } },
          resolution: 3,
        });
        label.anchor.set(0.5, 0);
        label.position.set(cx, cy + radius + 2);
        headLabels.addChild(label);
      }
    }
  };

  const NETWORK_ZONE = 0x1f5fd1;
  const PLAN_ZONE = 0xf2b705;

  /** A square-edged zone of tiles, tinted and outlined, like a station's catchment in the old tycoon games. */
  const zone = (inside: (i: number) => boolean, colour: number): Container => {
    const canvas = document.createElement("canvas");
    canvas.width = map.width;
    canvas.height = map.height;
    const ctx = canvas.getContext("2d")!;
    const img = ctx.createImageData(map.width, map.height);
    const outline = new Graphics();
    const out = (x: number, y: number) => !map.inside(x, y) || !inside(map.index(x, y));
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const i = map.index(x, y);
        if (!inside(i)) {
          continue;
        }
        img.data[i * 4] = (colour >> 16) & 255;
        img.data[i * 4 + 1] = (colour >> 8) & 255;
        img.data[i * 4 + 2] = colour & 255;
        img.data[i * 4 + 3] = 48;
        if (out(x, y - 1)) {
          outline.moveTo(x * PX, y * PX).lineTo((x + 1) * PX, y * PX);
        }
        if (out(x, y + 1)) {
          outline.moveTo(x * PX, (y + 1) * PX).lineTo((x + 1) * PX, (y + 1) * PX);
        }
        if (out(x - 1, y)) {
          outline.moveTo(x * PX, y * PX).lineTo(x * PX, (y + 1) * PX);
        }
        if (out(x + 1, y)) {
          outline.moveTo((x + 1) * PX, y * PX).lineTo((x + 1) * PX, (y + 1) * PX);
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    const texture = Texture.from(canvas);
    texture.source.scaleMode = "nearest";
    const fill = new Sprite(texture);
    fill.scale.set(PX);
    outline.stroke({ width: 3, color: colour, alpha: 0.9 });
    const c = new Container();
    c.addChild(fill, outline);
    return c;
  };

  /** A dot on every house in a neighbourhood that lies inside. */
  const houseDots = (inside: (i: number) => boolean, colour: number): Graphics => {
    const g = new Graphics();
    for (const h of crowd.trailheads) {
      for (const [x, y] of h.houseTiles) {
        if (inside(map.index(x, y))) {
          g.circle((x + 0.5) * PX, (y + 0.5) * PX, 3);
        }
      }
    }
    return g.fill(colour).stroke({ width: 1, color: 0xffffff });
  };

  let groomMap = false;

  /** The grooming map: each stretch coloured by how long since a snowcat was last along it. */
  const drawGroomAges = (lines: [number, number, number, number][], dots: [number, number][]) => {
    const colourAt = (x: number, y: number) => {
      const age = clock.hours - tracks.groomedAt[map.index(Math.floor(x), Math.floor(y))];
      return Number.isFinite(age) ? GROOM_AGE.find(([limit]) => age < limit)![1] : NEVER_GROOMED;
    };
    const colours = [...GROOM_AGE.map(([, c]) => c), NEVER_GROOMED];
    for (const colour of colours) {
      const segs = lines.filter(([x0, y0]) => colourAt(x0, y0) === colour);
      const pts = dots.filter(([x, y]) => colourAt(x, y) === colour);
      for (const [width, c] of [[12, 0x23323d], [9, colour]] as const) {
        for (const [x0, y0, x1, y1] of segs) {
          trackLayer.moveTo(x0 * PX, y0 * PX).lineTo(x1 * PX, y1 * PX);
        }
        trackLayer.stroke({ width, color: c, cap: "round", join: "round" });
        for (const [x, y] of pts) {
          trackLayer.circle(x * PX, y * PX, width / 2);
        }
        trackLayer.fill(c);
      }
    }
  };

  const redrawTracks = () => {
    refreshTrailheads();
    claimCabins();
    trackEnds = [...tracks.each()].filter(([x, y]) => tracks.neighbours(x, y).length <= 1);
    trackLayer.clear();
    const { lines, dots } = tracks.segments();
    if (groomMap) {
      drawGroomAges(lines, dots);
      return;
    }
    const at = (x: number, y: number) => tracks.condition(Math.floor(x), Math.floor(y), weather);
    for (const condition of Object.keys(TRACK_STYLE) as Condition[]) {
      const segs = lines.filter(([x0, y0]) => at(x0, y0) === condition);
      const pts = dots.filter(([x, y]) => at(x, y) === condition);
      if (segs.length === 0 && pts.length === 0) {
        continue;
      }
      // Stacked strokes leave two grooves in a groomed band.
      const [outline, band, groove, gap] = TRACK_STYLE[condition];
      for (const [width, color] of [[11, outline], [9, band], [5, groove], [2.5, gap]] as const) {
        for (const [x0, y0, x1, y1] of segs) {
          trackLayer.moveTo(x0 * PX, y0 * PX).lineTo(x1 * PX, y1 * PX);
        }
        trackLayer.stroke({ width, color, cap: "round", join: "round" });
        for (const [x, y] of pts) {
          trackLayer.circle(x * PX, y * PX, width / 2);
        }
        trackLayer.fill(color);
      }
    }
    for (const [x, y] of tracks.each()) {
      const crossing = tracks.crossing[map.index(x, y)] as Crossing;
      if (crossing !== Crossing.None) {
        drawCrossing(x, y, crossing);
      } else if (tracks.trampled(x, y)) {
        drawHoofprints(x, y);
      }
    }
  };

  /** Cloven hoofprints punched through the corduroy, staggered like a walking moose. */
  const drawHoofprints = (x: number, y: number) => {
    const { ux, uy, vx, vy } = trackAxes(x, y);
    const cx = (x + 0.5) * PX;
    const cy = (y + 0.5) * PX;
    for (const [along, side] of [[-5.5, -1.8], [-1.5, 1.8], [2.5, -1.8], [6.5, 1.8]]) {
      const px = cx + ux * along + vx * side;
      const py = cy + uy * along + vy * side;
      for (const half of [-0.7, 0.7]) {
        trackLayer.ellipse(px + vx * half, py + vy * half, 0.8, 0.8).fill({ color: 0x3f4c66, alpha: 0.85 });
      }
    }
  };

  /** Along-track and across-track unit vectors at a tile, from the track tiles either side of it. */
  const trackAxes = (x: number, y: number) => {
    const n = tracks.neighbours(x, y);
    let [ax, ay] = n.length >= 2 ? [n[1][0] - n[0][0], n[1][1] - n[0][1]] : n.length === 1 ? [n[0][0] - x, n[0][1] - y] : [1, 0];
    if (ax === 0 && ay === 0) {
      [ax, ay] = [1, 0];
    }
    const len = Math.hypot(ax, ay);
    return { ux: ax / len, uy: ay / len, vx: -ay / len, vy: ax / len };
  };

  const drawCrossing = (x: number, y: number, crossing: Crossing) => {
    const cx = (x + 0.5) * PX;
    const cy = (y + 0.5) * PX;
    const { ux, uy, vx, vy } = trackAxes(x, y);
    /** A rectangle centred on the tile, `along` long in the track direction and `across` wide. */
    const quad = (along: number, across: number, offset = 0) => {
      const ox = cx + vx * offset;
      const oy = cy + vy * offset;
      const pts = [[-along, -across], [along, -across], [along, across], [-along, across]].flatMap(([a, b]) => [
        ox + ux * (a / 2) + vx * (b / 2),
        oy + uy * (a / 2) + vy * (b / 2),
      ]);
      return trackLayer.poly(pts);
    };
    const bar = (alongAt: number, across: number, width: number, colour: number) => {
      trackLayer
        .moveTo(cx + ux * alongAt - vx * across / 2, cy + uy * alongAt - vy * across / 2)
        .lineTo(cx + ux * alongAt + vx * across / 2, cy + uy * alongAt + vy * across / 2)
        .stroke({ width, color: colour, cap: "round" });
    };
    const rail = tracks.obstacle(x, y) === "rail" || map.has(x, y, Flag.Rail);
    const same = (dir: number) => {
      const nx = x + Math.round(ux * dir);
      const ny = y + Math.round(uy * dir);
      return tracks.has(nx, ny) && tracks.crossing[map.index(nx, ny)] === crossing;
    };
    if (crossing === Crossing.AtGrade) {
      // Bare asphalt with a zebra crossing: the skis come off here.
      quad(PX * 1.05, 12).fill(0x8e939d);
      for (const offset of [-4, 0, 4]) {
        quad(PX * 0.9, 2.2, offset).fill(0xffffff);
      }
    } else if (crossing === Crossing.Bridge) {
      for (const side of [-1, 1]) {
        trackLayer
          .moveTo(cx - ux * PX * 0.6 + vx * side * 7, cy - uy * PX * 0.6 + vy * side * 7)
          .lineTo(cx + ux * PX * 0.6 + vx * side * 7, cy + uy * PX * 0.6 + vy * side * 7)
          .stroke({ width: 1.6, color: 0x6b4a2f, cap: "round" });
        for (const t of [-0.5, 0, 0.5]) {
          trackLayer.circle(cx + ux * PX * t + vx * side * 7, cy + uy * PX * t + vy * side * 7, 1.1).fill(0x4a3220);
        }
      }
    } else {
      // Track goes under: the road or railway is drawn across it, with dark tunnel mouths.
      const slab = rail ? 0x6b6760 : 0x8e939d;
      // Neighbouring crossing tiles join up into one deck, with tunnel mouths only at its ends.
      quad(PX + 1, PX * 1.4).fill(slab);
      if (rail) {
        for (const off of [-1.8, 1.8]) {
          trackLayer
            .moveTo(cx + ux * off - vx * PX * 0.7, cy + uy * off - vy * PX * 0.7)
            .lineTo(cx + ux * off + vx * PX * 0.7, cy + uy * off + vy * PX * 0.7)
            .stroke({ width: 1, color: 0x2c2c33 });
        }
      }
      if (!same(-1)) {
        bar(-PX / 2, 11, 2.6, 0x1d2228);
      }
      if (!same(1)) {
        bar(PX / 2, 11, 2.6, 0x1d2228);
      }
    }
  };

  const tileAt = (sx: number, sy: number): [number, number] => {
    const p = world.toLocal({ x: sx, y: sy });
    return [Math.floor(p.x / PX), Math.floor(p.y / PX)];
  };

  let infoTimer = 0;
  const describe = (x: number, y: number) => {
    clearTimeout(infoTimer);
    if (document.documentElement.classList.contains("compact")) {
      infoTimer = window.setTimeout(() => (info.innerHTML = ""), COMPACT_INFO_MS);
    }
    if (!map.inside(x, y)) {
      info.textContent = "";
      return;
    }
    const flags = FLAG_NAMES.filter(([f]) => map.has(x, y, f)).map(([, n]) => n);
    const cost = tracks.cost(x, y);
    const poi = map.pois.find((p) => Math.abs(p.x - x) <= 2 && Math.abs(p.y - y) <= 2 && p.name);
    const elevation = map.elevationAt(x, y);
    const i = map.index(x, y);
    const obstacle = tracks.obstacle(x, y);
    const detached = cost !== null && !tracks.has(x, y) ? connectionProblem(x, y) : null;
    const link = detached && tool === "build" ? connector(x, y) : null;
    let action = detached && !link
      ? `<span class="minus">${detached}</span>`
      : cost === null
      ? `<span class="minus">${tracks.blockReason(x, y) ?? "Kan ikke bygge her"}</span>`
      : obstacle === "rail"
        ? tracks.levelCrossing(x, y)
          ? `🚧 Planovergang: kryssing fra ${kr(cost + RAIL_LEVEL_CROSSING.levelPrice)}`
          : `Jernbane: krever undergang (fra ${kr(cost + 120_000)})`
        : obstacle === "road"
          ? `${map.roadName(x, y) ?? "Vei"}: kryssing fra ${kr(cost + roadTraffic(tracks.traffic(x, y)).levelPrice)}`
          : tracks.passageOnRoad(x, y)
            ? `🌉 Bru/undergang med vei: ${kr(cost)} — sporet må dele asfalten med bilene`
            : map.has(x, y, Flag.Passage) && map.has(x, y, Flag.Rail)
              ? `🌉 Eksisterende bru/undergang: ${kr(cost)}`
              : tracks.onForestRoad(x, y)
                ? `Bygge løype på den ubrøytede skogsbilveien: ${kr(cost)}`
                : `Bygge løype: ${kr(cost)}`;
    if (link) {
      action += `<br>Kobles til løypenettet med ${link.length} rute${link.length === 1 ? "" : "r"} til`;
    }
    if (tracks.has(x, y)) {
      const since = clock.hours - tracks.groomedAt[i];
      const groomed = Number.isFinite(since) ? `preppet for ${since < 1 ? "under en time" : `${Math.floor(since)} t`} siden` : "aldri preppet";
      const crossing = tracks.crossing[i] as Crossing;
      action = `${crossing !== Crossing.None ? `🌉 ${CROSSING_NAMES[crossing]}<br>` : ""}${tracks.trampled(x, y) ? "🫎 elgspor i sporet<br>" : ""}<strong>Løype: ${CONDITION_NAMES[tracks.condition(x, y, weather)]}</strong>
        (${Math.round(tracks.quality(x, y, weather) * 100)} %)<br>
        nysnø ${tracks.newSnow[i].toFixed(0)} cm · is ${Math.round(tracks.ice[i] * 100)} % · ${groomed}<br>${tillerLine(x, y, i)}
        ≈ ${Math.round(tracks.usage[i])} skiløpere siste døgnet`;
    } else if (CABIN_TOOL_TIER[tool] !== undefined) {
      const spec = CABIN_TIERS[CABIN_TOOL_TIER[tool]!];
      const existing = cabinNear(x, y, 1);
      const problem = existing ? null : cabinProblem(x, y);
      action = existing
        ? `🛖 ${existing.title}: klikk for å åpne`
        : problem
          ? `<span class="minus">${problem}</span>`
          : `${TOOL_ICONS[tool]} ${spec.name} her: ${kr(spec.price)}`;
    } else if (tool === "garage") {
      const problem = garageProblem(x, y);
      action = problem ? `<span class="minus">${problem}</span>` : `Garasje her: ${fleet.nextGarageCost === 0 ? "gratis" : kr(fleet.nextGarageCost)}`;
    }
    const headLine = crowd.headsAt(x, y)
      .map((h) => {
        const network = h.entry ? h.network : Math.max(tracks.size, 40);
        if (h.kind === "homes") {
          const served = h.entry ? `${h.served} av ${h.houses} hus nær løypa · ${h.today} i dag` : `${h.houses} hus, ingen nær løypa ennå`;
          return `<br><span class="${h.entry ? "plus" : "minus"}">⛷ ${h.name}: ${served}</span>`;
        }
        const estimate = Math.round(crowd.fineSaturday(h, clock.day, network));
        return `<br><span class="${h.entry ? "plus" : "minus"}">⛷ ${h.name} (${h.kind === "station" ? "togstasjon" : h.kind === "lift" ? "stolheis" : "parkering"}): ${
          h.entry ? `koblet til løypa · ${h.today} skiløpere i dag` : "ingen løype her ennå"
        } · ≈ ${estimate} en fin lørdag</span>`;
      })
      .join("");
    info.innerHTML = `
      ${poi ? `<strong>${poi.name}</strong><br>` : ""}
      ${TERRAIN_NAMES[map.terrainAt(x, y)]}${flags.length ? ` · ${flags.join(", ")}` : ""}<br>
      ${elevation} moh · stigning ${map.slopeAt(x, y).toFixed(0)} % ·
      ${weather.localTemperature(elevation).toFixed(0)} °C · snø ${weather.snowDepthAt(elevation).toFixed(0)} cm<br>
      ${action}${headLine}`;
    const blocked = cost === null || (!tracks.has(x, y) && connectionProblem(x, y) !== null && !link);
    cursor.clear().rect(x * PX, y * PX, PX, PX).stroke({ width: 2, color: blocked ? 0xc0392b : 0x1f5fd1 });
  };

  /**
   * How the current stroke gets across the road or railway it is on. Chosen once in the crossing
   * dialog and reused for the rest of that road or railway, so a two-tile-wide road asks once.
   */
  let strokeCrossing: { obstacle: Obstacle; option: CrossingOption; traffic: number } | null = null;
  let asking = false;

  type BuildResult = { status: "built" | "exists" | "blocked" | "asked"; paid: number; reason?: string };

  /** Build one track tile, asking how to cross first if it lies on a road or the railway. */
  /**
   * As in the old tycoon games, new track must grow out of the network; the very first track
   * starts where skiers can reach it. Null when building here is allowed.
   */
  const nearTrailhead = (x: number, y: number, r: number): boolean => {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (crowd.headsAt(x + dx, y + dy).length > 0) {
          return true;
        }
      }
    }
    return false;
  };

  /** What the tiller did to this tile's ice, and whether the snow has set since. */
  const tillerLine = (x: number, y: number, i: number): string => {
    const depth = weather.snowDepthAt(map.elevationAt(x, y));
    const lines: string[] = [];
    const tilled = tracks.tilled[i];
    if (tilled >= 0 && Number.isFinite(tracks.groomedAt[i])) {
      lines.push(tilled >= 0.85 ? "🌀 isen ble frest opp: fint resultat"
        : tilled >= 0.55 ? "🌀 isen ble frest opp: brukbart"
        : `🌀 fresen fikk lite til${tilled < 0.2 ? " (for lite snø)" : ""}: best fra −2 til −12 °C`);
    }
    if (tracks.ice[i] >= 0.4 && depth < TILLER_DEPTH) {
      lines.push(`<span class="minus">For lite snø til å frese bort isen (trenger ${TILLER_DEPTH} cm)</span>`);
    }
    if (tracks.setting[i] > 0) {
      lines.push(`❄ nypreppet, setter seg (${Math.ceil(tracks.setting[i])} t til)`);
    }
    return lines.map((l) => `${l}<br>`).join("");
  };

  /** Why a garage cannot go here, or null if it can. */
  const garageProblem = (x: number, y: number): string | null => {
    if (!fleet.canPlace(x, y, tracks)) {
      return "Kan ikke sette garasje her";
    }
    if (fleet.garages.length === 0 && !nearTrailhead(x, y, GARAGE_REACH)) {
      return "Garasjen må stå nær en stasjon, parkering eller et boligfelt";
    }
    if (budget < fleet.nextGarageCost) {
      return `Ikke råd: ${kr(fleet.nextGarageCost)}`;
    }
    return null;
  };

  const placeGarage = (x: number, y: number) => {
    if (garageProblem(x, y)) {
      crew.refuse();
      refreshHud();
      return;
    }
    const first = fleet.garages.length === 0;
    budget -= fleet.nextGarageCost;
    fleet.place(x, y);
    document.getElementById("setup")!.hidden = true;
    if (first) {
      crew.x = x;
      crew.y = y;
      setTool("build");
      showToast(`🏠 Løypelaget har flyttet inn, og Gamle Gunnar har fått tak over hodet! ${document.documentElement.classList.contains("compact")
        ? "Trykk der løypa skal gå: du ser først hvor den blir lagt fra det røde flagget, som nå står ved garasjen, og trykker på den grønne knappen. Én finger flytter kartet, to fingre zoomer, og ↶ angrer."
        : "Bygg den første løypa ut fra garasjen — med musa, eller med T og tastene rundt S."} Tiden starter når den første løypa er lagt.`);
    } else {
      setTool(restingTool());
    }
    redrawTracks();
    refreshHud();
  };

  /** Where new track can carry on from: loose ends and lone tiles, or the garage before any track. */
  let trackEnds: [number, number][] = [];
  let hint: { from: [number, number]; to: [number, number]; ttl: number } | null = null;

  /** The track tile, or the garage while there is no track, closest to a tile. */
  const nearestAnchor = (x: number, y: number): [number, number] | null => {
    const candidates: [number, number][] = tracks.size > 0 ? [...tracks.each()] : fleet.garages.map((g) => [g.x, g.y]);
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (const [cx, cy] of candidates) {
      const d = Math.hypot(cx - x, cy - y);
      if (d < bestD) {
        bestD = d;
        best = [cx, cy];
      }
    }
    return best;
  };

  /**
   * A short straight link from the network to a tile a few steps away, so a drag started just
   * beside the track still grows out of it. Null if too far, or if the link meets a road,
   * railway or anything unbuildable: those deserve a deliberate stroke.
   */
  const connector = (x: number, y: number): [number, number][] | null => {
    const anchor = nearestAnchor(x, y);
    if (!anchor || fleet.garages.length === 0) {
      return null;
    }
    const reach = tracks.size > 0 ? CONNECT_REACH : CONNECT_REACH + GARAGE_REACH;
    if (Math.max(Math.abs(anchor[0] - x), Math.abs(anchor[1] - y)) > reach) {
      return null;
    }
    const path = [...lineTiles(anchor[0], anchor[1], x, y)].slice(1, -1);
    const ok = path.every(([px, py]) => tracks.has(px, py) || (tracks.cost(px, py) !== null && !tracks.obstacle(px, py)));
    return ok ? path : null;
  };

  let refusal: { x: number; y: number; ttl: number } | null = null;
  /** Say on the map, right where it happened, why a tile was refused. */
  const showRefusal = (x: number, y: number, reason: string) => {
    refusal = { x, y, ttl: 2.5 };
    refusalText.text = reason;
    const w = refusalText.width + 16;
    const h = refusalText.height + 8;
    refusalBox.clear().roundRect(0, 0, w, h, 6).fill({ color: 0xa8281e, alpha: 0.95 }).stroke({ width: 1.5, color: 0xffffff });
    refusalText.position.set(8, 4);
    refusalTag.pivot.set(w / 2, h + 14);
  };

  const drawEnds = (dt: number) => {
    endsLayer.clear();
    refusalTag.visible = refusal !== null;
    if (refusal) {
      refusal.ttl -= dt;
      const a = Math.min(1, refusal.ttl * 2);
      const k = 1 / camera.scale;
      const [x0, y0] = [refusal.x * PX, refusal.y * PX];
      const pad = Math.max(PX, 10 * k) / 2;
      const cx = x0 + PX / 2;
      const cy = y0 + PX / 2;
      endsLayer
        .moveTo(cx - pad, cy - pad).lineTo(cx + pad, cy + pad)
        .moveTo(cx + pad, cy - pad).lineTo(cx - pad, cy + pad)
        .stroke({ width: 3 * k, color: 0xa8281e, alpha: a, cap: "round" });
      refusalTag.position.set(cx, cy - pad);
      refusalTag.scale.set(k);
      refusalTag.alpha = a;
      if (refusal.ttl <= 0) {
        refusal = null;
      }
    }
    if (hint) {
      hint.ttl -= dt;
      const [fx, fy] = hint.from;
      const [tx, ty] = hint.to;
      const a = Math.min(1, hint.ttl);
      endsLayer
        .moveTo((fx + 0.5) * PX, (fy + 0.5) * PX)
        .lineTo((tx + 0.5) * PX, (ty + 0.5) * PX)
        .stroke({ width: 3 / camera.scale, color: 0xe8591a, alpha: a * 0.9 })
        .circle((tx + 0.5) * PX, (ty + 0.5) * PX, 12 / camera.scale)
        .stroke({ width: 3 / camera.scale, color: 0xe8591a, alpha: a });
      if (hint.ttl <= 0) {
        hint = null;
      }
    }
    if (tool !== "build" || tracks.size === 0) {
      return;
    }
    const pulse = 0.55 + 0.45 * Math.sin(performance.now() / 260);
    const r = (6 + 3 * pulse) / camera.scale;
    for (const [x, y] of trackEnds) {
      const cx = (x + 0.5) * PX;
      const cy = (y + 0.5) * PX;
      endsLayer
        .circle(cx, cy, r)
        .fill({ color: 0xffffff, alpha: 0.85 })
        .stroke({ width: 2.5 / camera.scale, color: 0x1f5fd1 })
        .circle(cx, cy, 3 / camera.scale)
        .fill(0x1f5fd1);
    }
  };

  const connectionProblem = (x: number, y: number): string | null => {
    if (fleet.garages.length === 0) {
      return "Velg først hvor løypelaget skal ha garasjen";
    }
    if (tracks.size === 0) {
      const nearGarage = fleet.garages.some((g) => Math.max(Math.abs(g.x - x), Math.abs(g.y - y)) <= GARAGE_REACH);
      return nearGarage ? null : "Første løype må starte ved garasjen";
    }
    return tracks.neighbours(x, y).length > 0 ? null : "Ny løype må bygges videre fra løypenettet";
  };

  const build = (x: number, y: number, afterAsk: () => void): BuildResult => {
    if (tracks.has(x, y)) {
      return { status: "exists", paid: 0 };
    }
    const ground = tracks.cost(x, y);
    if (ground === null) {
      return { status: "blocked", paid: 0, reason: tracks.blockReason(x, y) ?? "Kan ikke bygge her" };
    }
    const unconnected = connectionProblem(x, y);
    if (unconnected) {
      return { status: "blocked", paid: 0, reason: unconnected };
    }
    const obstacle = tracks.obstacle(x, y);
    if (!obstacle) {
      strokeCrossing = null;
      if (ground > budget) {
        return { status: "blocked", paid: 0, reason: `Ikke råd: ${kr(ground)}` };
      }
      budget -= ground;
      tracks.add(x, y);
      return { status: "built", paid: ground };
    }
    // A busier road met further along the same crossing gets its own question.
    const options = crossingOptions(obstacle, tracks.traffic(x, y), tracks.levelCrossing(x, y));
    const sameKind = options.some((o) => o.type === strokeCrossing?.option.type);
    if (strokeCrossing?.obstacle === obstacle && sameKind && tracks.traffic(x, y) <= strokeCrossing.traffic) {
      const price = ground + strokeCrossing.option.price;
      if (price > budget) {
        return { status: "blocked", paid: 0, reason: `Ikke råd: ${kr(price)}` };
      }
      budget -= price;
      tracks.add(x, y, strokeCrossing.option.type);
      return { status: "built", paid: price };
    }
    if (asking) {
      return { status: "asked", paid: 0 };
    }
    asking = true;
    const wasPaused = clock.paused;
    clock.paused = true;
    const road = obstacle === "road" ? map.roadName(x, y) : null;
    const traffic = tracks.traffic(x, y);
    askCrossing(
      {
        title: obstacle === "rail" ? `Løypa krysser ${region.names.railway}` : `Løypa krysser ${road ?? "en vei"}`,
        lead: obstacle !== "rail"
          ? roadTraffic(traffic).describe
          : tracks.levelCrossing(x, y)
            ? `${RAIL_LEVEL_CROSSING.describe} Her er det lov å gå over — når bommen er oppe.`
            : `Å gå over skinnene er ikke lov. Ikke engang ${region.names.at}.`,
        options,
      },
      ground,
      budget,
      (option) => {
        asking = false;
        clock.paused = wasPaused;
        strokeCrossing = { obstacle, option, traffic };
        build(x, y, afterAsk);
        afterAsk();
        redrawTracks();
        refreshHud();
      },
      () => {
        asking = false;
        clock.paused = wasPaused;
        refreshHud();
      },
    );
    return { status: "asked", paid: 0 };
  };

  /** Returns what a newly built tile cost, so a corner cut later in the same drag can refund it. */
  const applyTool = (x: number, y: number): number => {
    if (tool === "build") {
      const result = build(x, y, () => {});
      if (result.status === "asked") {
        painting = null;
      }
      if (result.status === "blocked" && !strokeRefused) {
        strokeRefused = true;
        showRefusal(x, y, result.reason ?? "Kan ikke bygge her");
      }
      return result.paid;
    }
    if (tool === "remove" && tracks.has(x, y)) {
      tracks.remove(x, y);
    }
    return 0;
  };

  let stroke: { x: number; y: number; paid: number }[] = [];
  /** The last finished stroke, for undo. */
  let lastStroke: { x: number; y: number; paid: number }[] = [];
  /** A finger that has touched down with a building tool but not yet tapped, dragged or pinched. */
  let pendingTouch: { sx: number; sy: number; tile: [number, number] } | null = null;

  /** Start a stroke on a tile: linked to the network if it starts just beside it, a planned route if further, refused with a pointer if too far. */
  const beginStroke = (px: number, py: number): boolean => {
    painting = [px, py];
    stroke = [];
    strokeCrossing = null;
    strokeRefused = false;
    if (tool === "build" && !tracks.has(px, py) && tracks.cost(px, py) !== null && connectionProblem(px, py) && fleet.garages.length > 0) {
      const link = connector(px, py);
      if (link) {
        for (const [lx, ly] of link) {
          paintStep(lx, ly);
        }
      } else {
        const anchor = nearestAnchor(px, py);
        if (anchor && Math.max(Math.abs(anchor[0] - px), Math.abs(anchor[1] - py)) <= TAP_REACH) {
          painting = null;
          showPlan(anchor, planRoute(anchor, px, py));
          return false;
        }
        if (anchor) {
          hint = { from: [px, py], to: anchor, ttl: 3 };
          showToast(`${connectionProblem(px, py)}. ${tracks.size > 0 ? "Nærmeste løype er markert — start derfra." : "Garasjen er markert."}`);
        }
        painting = null;
        return false;
      }
    }
    paintStep(px, py);
    redrawTracks();
    refreshHud();
    return true;
  };

  /**
   * A tap with a finger. Building: on track it picks where to carry on from; elsewhere it lays a
   * planned route from the crew, when the crew stands on track close enough, or starts a stroke there.
   */
  const tapTile = (tx: number, ty: number) => {
    if (tool === "garage") {
      const problem = garageProblem(tx, ty);
      if (problem) {
        showRefusal(tx, ty, problem);
        return;
      }
      const price = fleet.nextGarageCost;
      showPlacement(tx, ty, `🏠 Garasje her · ${price === 0 ? "gratis" : kr(price)}`, "Sett opp garasje", () => placeGarage(tx, ty));
      return;
    }
    const cabinTier = CABIN_TOOL_TIER[tool];
    if (cabinTier !== undefined) {
      const existing = cabinNear(tx, ty, 1);
      const spec = CABIN_TIERS[cabinTier];
      const problem = existing ? null : cabinProblem(tx, ty) ?? (spec.price > budget ? `Ikke råd: ${kr(spec.price)}` : null);
      if (existing) {
        openCabin(existing.x, existing.y);
      } else if (problem) {
        showRefusal(tx, ty, problem);
      } else {
        showPlacement(tx, ty, `${TOOL_ICONS[tool]} ${spec.name} her · ${kr(spec.price)}`, `Bygg ${spec.name.toLowerCase()}`, () => cabinTool(tx, ty, cabinTier));
      }
      return;
    }
    const cabin = cabinNear(tx, ty, 1);
    if (cabin && tool === "build") {
      openCabin(cabin.x, cabin.y);
      return;
    }
    const station = tool === "build" ? alpine.stationNear(tx, ty) : undefined;
    if (station) {
      openLift(station.name);
      return;
    }
    if (tool === "remove") {
      [crew.x, crew.y] = [tx, ty];
      if (tracks.has(tx, ty)) {
        beginStroke(tx, ty);
        lastStroke = [];
        painting = null;
      }
      return;
    }
    if (tracks.has(tx, ty)) {
      clearPlan();
      [crew.x, crew.y] = [tx, ty];
      return;
    }
    // Build from the flag when it stands on track or at the garage; otherwise from the nearest track.
    const atGarage = fleet.garages.some((g) => g.x === crew.x && g.y === crew.y);
    const from: [number, number] | null = tracks.has(crew.x, crew.y) || (atGarage && tracks.size === 0) ? [crew.x, crew.y] : nearestAnchor(tx, ty);
    const reach = from ? Math.max(Math.abs(tx - from[0]), Math.abs(ty - from[1])) : Infinity;
    if (from && reach > TAP_REACH) {
      hint = { from: [tx, ty], to: from, ttl: 3 };
      showRefusal(tx, ty, `For langt — maks ${TAP_REACH} ruter per trykk`);
      return;
    }
    if (from) {
      showPlan(from, planRoute(from, tx, ty));
      return;
    }
    beginStroke(tx, ty);
    if (stroke.length > 0) {
      lastStroke = stroke.slice();
    }
    painting = null;
    redrawTracks();
    refreshHud();
  };

  type PlanTile = { x: number; y: number; kind: "track" | "new" | "crossing" | "blocked"; price: number; reason?: string };
  let plan: PlanTile[] | null = null;
  const planPanel = document.getElementById("build-plan")!;
  const setupPanel = document.getElementById("setup")!;

  /** The cheapest price of laying track on a tile, crossings included, or null where track cannot go. */
  const tilePrice = (x: number, y: number): number | null => {
    const ground = tracks.cost(x, y);
    const obstacle = ground === null ? null : tracks.obstacle(x, y);
    if (ground === null || !obstacle) {
      return ground;
    }
    return ground + Math.min(...crossingOptions(obstacle, tracks.traffic(x, y), tracks.levelCrossing(x, y)).map((o) => o.price));
  };

  /** Following the network costs next to nothing, so a route uses it rather than doubling it. */
  const routeGround: RouteGround = {
    width: map.width,
    height: map.height,
    step: (x, y) => (tracks.has(x, y) ? 1 : tilePrice(x, y)),
    wall: (x, y) => !tracks.has(x, y) && (tracks.cost(x, y) === null || tracks.obstacle(x, y) !== null),
  };

  const planTile = (x: number, y: number): PlanTile => {
    if (tracks.has(x, y)) {
      return { x, y, kind: "track", price: 0 };
    }
    const price = tilePrice(x, y);
    if (price === null) {
      return { x, y, kind: "blocked", price: 0, reason: tracks.blockReason(x, y) ?? "Kan ikke bygge her" };
    }
    return { x, y, kind: tracks.obstacle(x, y) || tracks.passageOnRoad(x, y) ? "crossing" : "new", price };
  };

  /** A hand-drawn line of tiles as a plan, stopping at the first tile track cannot go on. */
  const planFromTiles = (tiles: [number, number][]): PlanTile[] => {
    const out: PlanTile[] = [];
    for (const [x, y] of tiles) {
      const t = planTile(x, y);
      out.push(t);
      if (t.kind === "blocked") {
        break;
      }
    }
    return out;
  };

  /** The cheapest way to lay track from a tile to another, around houses, steep ground and costly crossings. */
  const planRoute = (from: [number, number], tx: number, ty: number): PlanTile[] => {
    const route = findRoute(routeGround, from, [tx, ty]);
    const out: PlanTile[] = route.tiles.map(([x, y]) => planTile(x, y));
    if (!route.complete) {
      const reason = tracks.cost(tx, ty) === null ? tracks.blockReason(tx, ty) ?? "Kan ikke bygge her" : "Finner ingen vei rundt det som er i veien";
      out.push({ x: tx, y: ty, kind: "blocked", price: 0, reason });
    }
    return out;
  };

  const CONFIRM_LABELS = ["Kjør på!", "Jadda!", "LØØØØYPE!", "Sett i gang!", "Dugnad!"];
  const confirmLabel = (total: number): string => {
    if (total > budget) {
      return "Så langt kassa rekker";
    }
    if (total > 50_000) {
      return Math.random() < 0.5 ? "Bruk penger" : "Styret får vite det etterpå";
    }
    return CONFIRM_LABELS[Math.floor(Math.random() * CONFIRM_LABELS.length)];
  };

  const PLAN_COLOURS: Record<PlanTile["kind"], number> = { track: 0x1f5fd1, new: 0x2fa84f, crossing: 0xf2c12e, blocked: 0xc0392b };

  /** Show a planned line on the map and ask whether to lay it. */
  const showPlan = (from: [number, number], tiles: PlanTile[]) => {
    plan = tiles;
    planLayer.clear();
    const [fx, fy] = from;
    const path = tiles.filter((t) => t.kind !== "blocked");
    if (path.length > 0) {
      planLayer.moveTo((fx + 0.5) * PX, (fy + 0.5) * PX);
      for (const t of path) {
        planLayer.lineTo((t.x + 0.5) * PX, (t.y + 0.5) * PX);
      }
      planLayer.stroke({ width: 3, color: 0x23323d, alpha: 0.5, join: "round" });
    }
    for (const t of tiles) {
      if (t.kind === "blocked") {
        planLayer
          .moveTo(t.x * PX + 2, t.y * PX + 2).lineTo((t.x + 1) * PX - 2, (t.y + 1) * PX - 2)
          .moveTo((t.x + 1) * PX - 2, t.y * PX + 2).lineTo(t.x * PX + 2, (t.y + 1) * PX - 2)
          .stroke({ width: 3, color: PLAN_COLOURS.blocked, cap: "round" });
      } else {
        planLayer.rect(t.x * PX + 1, t.y * PX + 1, PX - 2, PX - 2).fill({ color: PLAN_COLOURS[t.kind], alpha: t.kind === "track" ? 0.25 : 0.6 })
          .stroke({ width: 1.5, color: 0xffffff, alpha: 0.9 });
      }
    }
    const fresh = tiles.filter((t) => t.kind === "new" || t.kind === "crossing");
    const total = fresh.reduce((s, t) => s + t.price, 0);
    planZone.removeChildren().forEach((c) => c.destroy({ children: true }));
    const network = reachFrom(map, tracks.each(), HOMES_REACH);
    const planned = reachFrom(map, fresh.map((t): [number, number] => [t.x, t.y]), HOMES_REACH);
    const gained = (i: number) => planned[i] <= HOMES_REACH && network[i] > HOMES_REACH;
    if (fresh.length > 0) {
      planZone.addChild(zone(gained, PLAN_ZONE), houseDots(gained, PLAN_ZONE));
    }
    const newHomes = crowd.trailheads
      .map((h) => ({ h, n: h.houseTiles.filter(([x, y]) => gained(map.index(x, y))).length }))
      .filter(({ n }) => n > 0)
      .sort((a, b) => b.n - a.n);
    const newHouses = newHomes.reduce((s, { n }) => s + n, 0);
    const crossings = tiles.some((t) => t.kind === "crossing");
    const blocked = tiles.find((t) => t.kind === "blocked");
    const lines: string[] = [];
    if (fresh.length === 0) {
      lines.push(blocked ? `<strong>Ingenting å bygge her.</strong> ${blocked.reason}.` : "<strong>Det ligger allerede løype hele veien.</strong>");
    } else {
      lines.push(`<strong>${fresh.length} nye løyperute${fresh.length === 1 ? "" : "r"} · ${crossings ? "fra " : ""}${kr(total)}</strong>`);
      const named = tiles
        .filter((t, i) => t.kind === "crossing" && tiles[i - 1]?.kind !== "crossing")
        .map((t) => {
          if (tracks.passageOnRoad(t.x, t.y)) {
            return `Følger ${map.roadName(t.x, t.y) ?? "veien"} gjennom en eksisterende bru eller undergang — sporet må dele asfalten.`;
          }
          if (tracks.obstacle(t.x, t.y) !== "rail") {
            return `Krysser ${map.roadName(t.x, t.y) ?? "en vei"} — du velger hvordan underveis.`;
          }
          return tracks.levelCrossing(t.x, t.y)
            ? `Krysser ${region.names.railway} på planovergangen — du velger underveis.`
            : `Krysser ${region.names.railway}: krever undergang til ${kr(crossingOptions("rail", 0)[0].price)}.`;
        });
      lines.push(...new Set(named));
      const reached = [...new Set(fresh.flatMap((t) => crowd.headsAt(t.x, t.y)).filter((h) => !h.entry && h.kind !== "homes"))];
      if (newHouses > 0) {
        const names = newHomes.slice(0, 2).map(({ h }) => h.name).join(" og ") + (newHomes.length > 2 ? " m.fl." : "");
        lines.push(`<span class="plus">⛷ +${newHouses} hus innen ${HOMES_REACH * map.tileSize} m (${names})</span>`);
      }
      if (reached.length) {
        lines.push(`<span class="plus">${reached.map((h) => `${h.kind === "station" ? "🚉" : h.kind === "lift" ? "🚡" : "🅿"} Når fram til ${h.name}`).join("<br>")}</span>`);
      }
      if (newHouses === 0 && reached.length === 0) {
        lines.push("Ingen nye hus innen rekkevidde, men et lengre løypenett lokker flere med tog og bil.");
      }
      lines.push(`⛽ ${kr(fresh.length * COST_PER_TILE)} mer i diesel hver gang løypa preppes.`);
      if (blocked) {
        lines.push(`Stopper før: ${(blocked.reason ?? "noe som ikke kan bygges over").toLowerCase()}.`);
      }
      if (total > budget) {
        lines.push(`<span class="minus">Kassa rekker ikke hele veien — det bygges så langt pengene holder.</span>`);
      }
    }
    planPanel.innerHTML = `<div class="text">${lines.join("<br>")}</div>
      <div class="actions">${fresh.length ? `<button data-plan="build">${confirmLabel(total)}</button>` : ""}<button data-plan="cancel">Avbryt</button></div>`;
    planPanel.hidden = false;
    toast.hidden = true;
    // Keep the whole route in view above the panel, without pushing it under the status line.
    const ys = [from, ...tiles.map((t): [number, number] => [t.x, t.y])].map(([x, y]) => world.toGlobal({ x: (x + 0.5) * PX, y: (y + 0.5) * PX }).y);
    const lowest = Math.max(...ys) + PX * camera.scale;
    const room = planPanel.getBoundingClientRect().top - 12;
    if (lowest > room) {
      const highest = Math.min(...ys) - PX * camera.scale;
      camera.pan(0, -Math.min(lowest - room, Math.max(0, highest - topbar.offsetHeight - 8)));
    }
  };

  /** A building a finger has picked a spot for, waiting for the player to confirm it. */
  let placement: (() => void) | null = null;

  /** Mark a tile and ask before putting a building on it, so a stray touch never spends money. */
  const showPlacement = (x: number, y: number, text: string, label: string, place: () => void) => {
    clearPlan();
    placement = place;
    planLayer.rect(x * PX - PX, y * PX - PX, PX * 3, PX * 3).fill({ color: PLAN_COLOURS.new, alpha: 0.45 }).stroke({ width: 2, color: 0xffffff, alpha: 0.9 });
    planPanel.innerHTML = `<div class="text"><strong>${text}</strong></div>
      <div class="actions"><button data-plan="place">${label}</button><button data-plan="cancel">Avbryt</button></div>`;
    planPanel.hidden = false;
    setupPanel.hidden = true;
    toast.hidden = true;
  };

  const clearPlan = () => {
    plan = null;
    placement = null;
    planLayer.clear();
    planZone.removeChildren().forEach((c) => c.destroy({ children: true }));
    planPanel.hidden = true;
    setupPanel.hidden = fleet.garages.length > 0;
  };

  /** Lay tiles in order; a crossing asks first, and the rest follows once it is chosen. */
  const layPath = (tiles: [number, number][], built: { x: number; y: number; paid: number }[]) => {
    lastStroke = built;
    for (let i = 0; i < tiles.length; i++) {
      const [x, y] = tiles[i];
      const before = budget;
      const result = build(x, y, () => {
        built.push({ x, y, paid: before - budget });
        [crew.x, crew.y] = [x, y];
        layPath(tiles.slice(i + 1), built);
      });
      if (result.status === "asked") {
        return;
      }
      if (result.status === "blocked") {
        showRefusal(x, y, result.reason ?? "Kan ikke bygge her");
        break;
      }
      if (result.status === "built") {
        built.push({ x, y, paid: result.paid });
      }
      [crew.x, crew.y] = [x, y];
    }
    redrawTracks();
    refreshHud();
  };

  planPanel.addEventListener("click", (e) => {
    const action = (e.target as HTMLElement).closest("button")?.dataset.plan;
    if (action === "build" && plan) {
      const tiles = plan.filter((t) => t.kind !== "blocked").map((t): [number, number] => [t.x, t.y]);
      clearPlan();
      strokeCrossing = null;
      layPath(tiles, []);
    } else if (action === "place" && placement) {
      const place = placement;
      clearPlan();
      place();
    } else if (action === "cancel") {
      clearPlan();
    }
  });

  /** Take back the last stroke and the money it cost. */
  const undoLastStroke = () => {
    const undone = lastStroke.filter(({ x, y, paid }) => paid > 0 && tracks.has(x, y));
    if (undone.length === 0) {
      showToast("Ingenting å angre.");
      return;
    }
    let refund = 0;
    for (const { x, y, paid } of undone) {
      tracks.remove(x, y);
      refund += paid;
    }
    budget += refund;
    lastStroke = [];
    const back = [...tracks.each()].sort((a, b) => Math.hypot(a[0] - undone[0].x, a[1] - undone[0].y) - Math.hypot(b[0] - undone[0].x, b[1] - undone[0].y))[0];
    if (back) {
      [crew.x, crew.y] = back;
    }
    showToast(`↶ Angret ${undone.length} løyperute${undone.length === 1 ? "" : "r"}, <span class="plus">+${kr(refund)}</span> tilbake.`);
    redrawTracks();
    refreshHud();
  };
  /** Only the first refusal in a drag is shown: everything after it is just "not connected". */
  let strokeRefused = false;
  let painting: [number, number] | null = null;

  const paintStep = (x: number, y: number) => {
    if (draft) {
      const [before, last] = draft.slice(-2);
      const diagonalToBefore = last && Math.abs(before[0] - x) === 1 && Math.abs(before[1] - y) === 1;
      if (diagonalToBefore && !tracks.has(last[0], last[1]) && !tracks.obstacle(last[0], last[1])) {
        draft.pop();
      }
      draft.push([x, y]);
      drawDraft();
      return;
    }
    const paid = applyTool(x, y);
    const [before, last] = stroke.slice(-2);
    const diagonalToBefore = last && Math.abs(before.x - x) === 1 && Math.abs(before.y - y) === 1;
    // Never cut a corner through a crossing: that money bought a bridge, not a staircase step.
    const lastIsPlain = last && tracks.crossing[map.index(last.x, last.y)] === Crossing.None;
    if (tool === "build" && diagonalToBefore && last.paid > 0 && lastIsPlain) {
      tracks.remove(last.x, last.y);
      budget += last.paid;
      stroke.pop();
    }
    stroke.push({ x, y, paid });
    if (tool !== "build" || tracks.has(x, y)) {
      [crew.x, crew.y] = [x, y];
    }
  };
  let panning: { x: number; y: number } | null = null;

  app.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  let lookHintShown = false;
  /**
   * A mouse drag with the build tool: the tiles it has passed over, laid only once the plan it
   * becomes is confirmed.
   */
  let draft: [number, number][] | null = null;

  const drawDraft = () => {
    planZone.removeChildren().forEach((c) => c.destroy({ children: true }));
    planLayer.clear();
    for (const t of planFromTiles(draft ?? [])) {
      planLayer.rect(t.x * PX + 1, t.y * PX + 1, PX - 2, PX - 2).fill({ color: PLAN_COLOURS[t.kind], alpha: t.kind === "track" ? 0.25 : 0.6 });
    }
  };

  /** Fingers on the map, for two-finger pan and pinch zoom. */
  const touches = new Map<number, { x: number; y: number }>();
  let pinch: { distance: number; scale: number; wx: number; wy: number; mx: number; my: number } | null = null;
  const fingerSpread = () => {
    const [a, b] = [...touches.values()];
    return { mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
  };

  /** A second finger landed: the first one meant to move the map, not to lay those tiles. */
  const undoShortStroke = () => {
    if (stroke.length > SHORT_STROKE || asking) {
      return;
    }
    for (const { x, y, paid } of stroke) {
      if (paid > 0 && tracks.has(x, y)) {
        tracks.remove(x, y);
        budget += paid;
      }
    }
    stroke = [];
    redrawTracks();
    refreshHud();
  };

  const startPinch = () => {
    pendingTouch = null;
    undoShortStroke();
    painting = null;
    panning = null;
    const { mx, my, distance } = fingerSpread();
    const w = world.toLocal({ x: mx, y: my });
    pinch = { distance, scale: camera.scale, wx: w.x, wy: w.y, mx, my };
  };

  const endTouch = (e: PointerEvent) => {
    if (!touches.delete(e.pointerId) || !pinch || touches.size >= 2) {
      return;
    }
    camera.settle(pinch.mx, pinch.my);
    pinch = null;
  };
  window.addEventListener("pointerup", endTouch);
  window.addEventListener("pointercancel", endTouch);
  // A tap on the map must not also click whatever it just opened under the finger (a dialog, the build plan).
  app.canvas.addEventListener("touchend", (e) => e.preventDefault(), { passive: false });

  app.canvas.addEventListener("pointerdown", (e) => {
    if (closeMenus()) {
      return;
    }
    if (e.pointerType === "touch") {
      touches.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (touches.size === 2) {
        startPinch();
      }
      if (touches.size >= 2 || pinch) {
        return;
      }
    }
    if (shooting) {
      if (e.button === 0) {
        aiming = true;
        aimAt(e.offsetX, e.offsetY);
      }
      return;
    }
    const w = world.toLocal({ x: e.offsetX, y: e.offsetY });
    if (e.button === 0) {
      const picked = pickSubject(w.x, w.y);
      if (picked) {
        openInspect(picked);
        return;
      }
    }
    // A finger never hovers: tapping a tile is how its info shows up.
    describe(...tileAt(e.offsetX, e.offsetY));
    if (e.button === 0 && (whimsy.poke(w.x, w.y) || skijorer.poke(w.x, w.y))) {
      return;
    }
    const fingerTool = e.pointerType === "touch" && (tool === "build" || tool === "remove" || tool === "garage" || CABIN_TOOL_TIER[tool] !== undefined);
    if (e.button === 0 && fingerTool) {
      // A finger may be about to tap, drag or pinch: wait and see before laying anything.
      pendingTouch = { sx: e.offsetX, sy: e.offsetY, tile: tileAt(e.offsetX, e.offsetY) };
      return;
    }
    // The keyboard crew follows the mouse, so the keypad carries on from the last tile touched.
    if (e.button === 0 && tool === "look" && e.pointerType === "touch") {
      // Looking around with a finger: the flag stays where building carries on from.
      if (!lookHintShown && fleet.garages.length > 0) {
        lookHintShown = true;
        showToast(`👀 Du ser deg rundt. Trykk 👀▴ nederst til venstre og velg ⛷ Bygg løype for å bygge.`);
      }
    } else if (e.button === 0 && tool !== "garage") {
      [crew.x, crew.y] = tileAt(e.offsetX, e.offsetY);
    }
    if (e.button === 0 && tool === "garage") {
      placeGarage(...tileAt(e.offsetX, e.offsetY));
      return;
    }
    if (e.button === 0 && CABIN_TOOL_TIER[tool] !== undefined) {
      cabinTool(...tileAt(e.offsetX, e.offsetY), CABIN_TOOL_TIER[tool]!);
      return;
    }
    if (e.button === 0 && tool === "look") {
      const [lx, ly] = tileAt(e.offsetX, e.offsetY);
      const cabin = cabinNear(lx, ly, 1);
      if (cabin) {
        openCabin(cabin.x, cabin.y);
        return;
      }
      const lift = alpine.liftNear(lx, ly);
      if (lift) {
        openLift(lift.name);
        return;
      }
      if (julehus.near(lx, ly)) {
        showToast(clock.day <= LIGHTS_DOWN_DAY
          ? `🎄 <strong>Julehuset i ${region.christmasHouse?.street}</strong> – et lokalt landemerke. Tusenvis av lys, reinsdyr på plenen, og fast plass i ${region.names.newspaper} hver desember. Best etter mørkets frembrudd.`
          : `🎄 <strong>Julehuset i ${region.christmasHouse?.street}</strong> – lysene ble tatt ned på tjugendedag. Kom tilbake i desember.`);
        return;
      }
    }
    if (e.button === 0 && tool === "build") {
      const station = alpine.stationNear(...tileAt(e.offsetX, e.offsetY));
      if (station) {
        openLift(station.name);
        return;
      }
    }
    if (e.button === 0 && tool !== "look") {
      draft = tool === "build" ? [] : null;
      beginStroke(...tileAt(e.offsetX, e.offsetY));
    } else {
      panning = { x: e.clientX, y: e.clientY };
    }
  });
  /** Dragging the camera about in photo mode. */
  let aiming = false;
  window.addEventListener("pointerup", () => {
    aiming = false;
    if (pendingTouch && !pinch) {
      tapTile(...pendingTouch.tile);
    }
    pendingTouch = null;
    if (draft && draft.length > 0) {
      const tiles = draft;
      draft = null;
      if (tiles.some(([x, y]) => !tracks.has(x, y))) {
        showPlan(tiles[0], planFromTiles(tiles));
      } else if (!plan) {
        planLayer.clear();
      }
    }
    draft = null;
    if (painting && stroke.length > 0) {
      lastStroke = stroke.slice();
    }
    painting = null;
    panning = null;
  });
  app.canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch" && touches.has(e.pointerId)) {
      touches.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (pinch) {
        if (touches.size >= 2) {
          const { mx, my, distance } = fingerSpread();
          pinch.mx = mx;
          pinch.my = my;
          camera.pinchTo(pinch.scale * (distance / pinch.distance), mx, my, pinch.wx, pinch.wy);
        }
        return;
      }
    }
    if (aiming) {
      aimAt(e.offsetX, e.offsetY);
      return;
    }
    const [x, y] = tileAt(e.offsetX, e.offsetY);
    describe(x, y);
    if (pendingTouch && Math.hypot(e.offsetX - pendingTouch.sx, e.offsetY - pendingTouch.sy) > TOUCH_SLOP) {
      // One finger moves the map, as in every map app; track is laid by tapping and confirming.
      pendingTouch = null;
      panning = { x: e.clientX, y: e.clientY };
    }
    if (panning) {
      camera.pan(e.clientX - panning.x, e.clientY - panning.y);
      panning = { x: e.clientX, y: e.clientY };
    } else if (painting && (painting[0] !== x || painting[1] !== y)) {
      for (const [lx, ly] of [...lineTiles(painting[0], painting[1], x, y)].slice(1)) {
        paintStep(lx, ly);
        if (!painting) {
          break;
        }
      }
      if (painting) {
        painting = [x, y];
      }
      redrawTracks();
      refreshHud();
    }
  });
  let wheelDebt = 0;
  app.canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const touchpadScroll = !e.ctrlKey && e.deltaMode === 0 && (e.deltaX !== 0 || Math.abs(e.deltaY) < 50);
      if (touchpadScroll) {
        camera.pan(-e.deltaX, -e.deltaY);
        return;
      }
      wheelDebt += e.deltaY;
      const threshold = e.ctrlKey ? 25 : 60;
      if (Math.abs(wheelDebt) >= threshold) {
        camera.zoomAt(e.offsetX, e.offsetY, wheelDebt < 0 ? 1 : -1);
        wheelDebt = 0;
      }
    },
    { passive: false },
  );

  const crewOnScreen = () => world.toGlobal({ x: (crew.x + 0.5) * PX, y: (crew.y + 0.5) * PX });

  /** Keep the crew inside the middle of the screen as it walks. */
  const followCrew = () => {
    const p = crewOnScreen();
    const mx = app.screen.width * 0.2;
    const my = app.screen.height * 0.2;
    const dx = p.x < mx ? mx - p.x : p.x > app.screen.width - mx ? app.screen.width - mx - p.x : 0;
    const dy = p.y < my ? my - p.y : p.y > app.screen.height - my ? app.screen.height - my - p.y : 0;
    camera.pan(dx, dy);
  };

  const stepCrew = (dx: number, dy: number) => {
    const nx = crew.x + dx;
    const ny = crew.y + dy;
    if (!map.inside(nx, ny) || asking) {
      crew.refuse();
      return;
    }
    const arrive = () => {
      crew.x = nx;
      crew.y = ny;
      describe(nx, ny);
      followCrew();
    };
    if (crew.building) {
      const hereOk = tracks.has(crew.x, crew.y) || (tracks.cost(crew.x, crew.y) !== null && !connectionProblem(crew.x, crew.y));
      const tiles: [number, number][] = hereOk ? [[crew.x, crew.y], [nx, ny]] : [[nx, ny]];
      for (const [tx, ty] of tiles) {
        const isNext = tx === nx && ty === ny;
        const result = build(tx, ty, () => {
          if (isNext) {
            arrive();
          }
        });
        redrawTracks();
        refreshHud();
        if (result.status === "asked") {
          return;
        }
        if (result.status === "blocked") {
          crew.refuse();
          describe(nx, ny);
          showRefusal(tx, ty, result.reason ?? "Kan ikke bygge her");
          if (result.reason?.startsWith("Ikke råd")) {
            info.innerHTML += `<br><strong class="warn">${result.reason}</strong>`;
          }
          return;
        }
      }
    }
    arrive();
  };

  const toggleBuilding = () => {
    crew.building = !crew.building;
    refreshHud();
  };

  const zoomKey = (steps: number) => {
    const p = crewOnScreen();
    const visible = p.x >= 0 && p.y >= 0 && p.x <= app.screen.width && p.y <= app.screen.height;
    camera.zoomAt(visible ? p.x : app.screen.width / 2, visible ? p.y : app.screen.height / 2, steps);
  };

  const setTool = (t: Tool) => {
    tool = t;
    toolMenu.hidden = true;
    clearPlan();
    refreshTrailheads();
    refreshHud();
  };
  for (const btn of document.querySelectorAll<HTMLButtonElement>("[data-tool]")) {
    btn.addEventListener("click", () => setTool(btn.dataset.tool as Tool));
  }
  const snowButton = document.getElementById("snow")!;
  const toggleSnow = () => {
    precipitation.enabled = !precipitation.enabled;
    snowButton.classList.toggle("active", precipitation.enabled);
  };
  const setSpeed = (i: number) => {
    if (fleet.garages.length === 0) {
      const banner = document.getElementById("setup")!;
      banner.classList.remove("nudge");
      void banner.offsetWidth;
      banner.classList.add("nudge");
      return;
    }
    timeStarted = true;
    if (i < 0) {
      clock.paused = !clock.paused;
    } else {
      clock.paused = false;
      clock.speedIndex = Math.max(0, Math.min(SPEEDS.length - 1, i));
      // Picking a speed ends the live view's slow motion.
      if (clock.slowMotion !== null) {
        clock.slowMotion = null;
        renderInspect();
      }
    }
    refreshHud();
  };
  for (const btn of document.querySelectorAll<HTMLButtonElement>("[data-speed]")) {
    btn.addEventListener("click", () => {
      closeMenus();
      const i = Number(btn.dataset.speed);
      setSpeed(i < 0 && clock.paused ? clock.speedIndex : i);
    });
  }
  snowButton.classList.add("active");
  snowButton.addEventListener("click", toggleSnow);
  const groomButton = document.getElementById("groom-map")!;
  const legend = document.getElementById("legend")!;
  legend.innerHTML = `<strong>Sist preppet</strong>${[...GROOM_AGE.map(([, c, label]) => [c, label] as const), [NEVER_GROOMED, "aldri"] as const]
    .map(([c, label]) => `<div><span class="swatch" style="background:#${c.toString(16).padStart(6, "0")}"></span>${label}</div>`)
    .join("")}`;
  const toggleGroomMap = () => {
    groomMap = !groomMap;
    groomButton.classList.toggle("active", groomMap);
    legend.hidden = !groomMap;
    redrawTracks();
  };
  groomButton.addEventListener("click", toggleGroomMap);
  const help = document.getElementById("help")!;
  window.addEventListener("keydown", (e) => {
    if (e.code === "KeyZ" && (e.ctrlKey || e.metaKey) && !e.altKey) {
      undoLastStroke();
      e.preventDefault();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) {
      return;
    }
    const driving = inspected?.kind === "snowcat" && inspected.groomer.steering;
    if (shooting && !shooting.snap && driving && (e.code.startsWith("Arrow") || e.code === "Backspace")) {
      steer(e.code === "ArrowUp" ? "go" : e.code === "ArrowDown" ? "stop" : e.code === "ArrowLeft" ? "left" : e.code === "ArrowRight" ? "right" : "back");
      e.preventDefault();
      return;
    }
    if (shooting && !shooting.snap) {
      if (e.code === "Escape") {
        closeInspect();
      } else if (e.code === "Enter") {
        shoot();
      } else if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
        turnAim(e.code === "ArrowLeft" ? -0.17 : 0.17);
      } else if (e.code === "ArrowUp" || e.code === "ArrowDown") {
        tiltBy(e.code === "ArrowUp" ? PHOTO_TILT_STEP : -PHOTO_TILT_STEP);
      } else if (e.key === "+" || e.key === "=" || e.key === "-") {
        zoomBy(e.key === "-" ? 1 / PHOTO_ZOOM_STEP : PHOTO_ZOOM_STEP);
      } else {
        return;
      }
      e.preventDefault();
      return;
    }
    if (inspected && e.code === "Escape") {
      closeInspect();
      return;
    }
    const step = STEP_KEYS[e.code];
    const pan = PAN_KEYS[e.code];
    if (step) {
      stepCrew(...step);
    } else if (pan) {
      camera.pan(pan[0] * 120, pan[1] * 120);
    } else if (e.key === "NumLock" || e.code === "KeyT") {
      toggleBuilding();
    } else if (e.key === "+" || e.key === "=" || e.code === "PageUp") {
      zoomKey(1);
    } else if (e.key === "-" || e.code === "PageDown") {
      zoomKey(-1);
    } else if (e.code === "Backspace" || e.code === "Delete") {
      tracks.remove(crew.x, crew.y);
      redrawTracks();
      refreshHud();
    } else if (e.code === "Space") {
      setSpeed(-1);
    } else if (e.code === "Period") {
      setSpeed(clock.speedIndex + 1);
    } else if (e.code === "Comma") {
      setSpeed(clock.speedIndex - 1);
    } else if (e.code === "KeyN") {
      toggleSnow();
    } else if (e.code === "KeyG") {
      toggleGroomMap();
    } else if ((e.code === "Enter" || e.code === "NumpadEnter") && tool === "garage") {
      placeGarage(crew.x, crew.y);
    } else if (e.code === "KeyM") {
      toggleMenu();
    } else if (e.code === "KeyK") {
      showAccounts(accountsPanel.hidden);
    } else if (e.code === "KeyF") {
      showReport(reportPanel.hidden);
    } else if (e.code === "KeyV") {
      showPaper(paperPanel.hidden);
    } else if (e.code === "KeyH" || e.key === "?") {
      help.hidden = !help.hidden;
    } else if (e.code === "Escape") {
      help.hidden = true;
      showAccounts(false);
      showReport(false);
      showPaper(false);
      kioskPanel.hidden = true;
      liftPanel.hidden = true;
      showFeed(false);
      closeMenus();
      clearPlan();
    } else {
      const t = ({ Digit1: "look", Digit2: "build", Digit3: "remove", Digit4: "garage", Digit5: "koie", Digit6: "hytte" } as Record<string, Tool>)[e.code];
      if (!t) {
        return;
      }
      setTool(t);
    }
    e.preventDefault();
  });

  const snapshot = (): SaveGame => ({
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    savedAt: new Date().toISOString(),
    label: `${season.year === FIRST_SEASON ? "" : `${seasonName(season.year)} · `}${clock.label()} · ${((tracks.size * map.tileSize) / 1000).toFixed(1)} km · ${kr(budget)}`,
    map: { name: map.name, title: map.title, version: map.version, grid: map.grid },
    clock: { hours: clock.hours, speedIndex: clock.speedIndex },
    budget,
    reputation: crowd.reputation,
    today: { ...crowd.today },
    hype: crowd.hype,
    yesterday,
    yesterdayHyped,
    dieselToday,
    incidentsToday,
    incidentsYesterday,
    lastReportDay,
    snowSinceReport,
    rainSinceReport,
    weather: { snowDepth: weather.snowDepth, highDepth: weather.highDepth, plans: weather.allPlans() },
    tracks: encodeTracks(map, tracks),
    garages: fleet.groomers.map((g) => ({ tile: map.toGrid(g.garage.x, g.garage.y), totalGroomed: g.totalGroomed, onCall: g.onCall })),
    kiosks: kiosks.map((k) => ({ tile: map.toGrid(k.x, k.y), tier: k.tier, soldToday: k.soldToday, broken: k.broken, experts: k.experts, kind: k.kind, name: k.name })),
    schedule: fleet.schedule,
    reports: reports.map(({ report, rosy }) => ({ ...report, rosyChosen: rosy })),
    crew: map.toGrid(crew.x, crew.y),
    varingen: { ...paper, press: crowd.press, roadsToday, snowToday, rainToday },
    accounts: { history, dayStartBudget },
    alpine: { chairlift: alpine.hasChairlift },
    season: { ...season },
    feed,
  });

  const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} og ${xs[xs.length - 1]}` : xs[0]);

  /** Rebuild a saved game on this freshly started page. Returns what to tell the player. */
  const restore = (save: SaveGame): string => {
    timeStarted = true;
    if (save.season) {
      Object.assign(season, save.season);
      setSeason(season.year);
    }
    feed.push(...(save.feed ?? []));
    for (const p of feed) {
      lastPosted.set(p.kind, Math.max(lastPosted.get(p.kind) ?? -Infinity, p.day * 24 + p.hour));
    }
    clock.hours = save.clock.hours;
    clock.speedIndex = save.clock.speedIndex;
    clock.paused = true;
    budget = save.budget;
    history = save.accounts?.history ?? [];
    knownHeads = null;
    dayStartBudget = save.accounts?.dayStartBudget ?? save.budget;
    crowd.reputation = save.reputation;
    crowd.today = { ...emptyDay(), ...save.today };
    crowd.hype = save.hype;
    yesterday = save.yesterday;
    yesterdayHyped = save.yesterdayHyped;
    dieselToday = save.dieselToday;
    incidentsToday = [...save.incidentsToday];
    incidentsYesterday = [...save.incidentsYesterday];
    lastReportDay = save.lastReportDay;
    snowSinceReport = save.snowSinceReport;
    rainSinceReport = save.rainSinceReport;
    weather.restore(save.weather.plans, save.weather.snowDepth, clock.hours, save.weather.highDepth);
    const result = decodeTracks(map, tracks, save.tracks);
    for (const g of save.garages) {
      const local = map.fromGrid(g.tile);
      if (local) {
        const groomer = fleet.place(...local);
        groomer.totalGroomed = g.totalGroomed;
        groomer.onCall = g.onCall ?? false;
      }
    }
    fleet.schedule = save.schedule;
    for (const saved of save.kiosks ?? []) {
      const local = map.fromGrid(saved.tile);
      const cabin = saved.kind === "cabin";
      if (local && (cabin || fleet.garages.some((g) => g.x === local[0] && g.y === local[1]))) {
        const k = cabin
          ? placeOutlet(local[0], local[1], Math.min(saved.tier, CABIN_TIERS.length - 1), "cabin", saved.name ?? null)
          : placeKiosk(local[0], local[1], Math.min(saved.tier, KIOSK_TIERS.length - 1));
        k.soldToday = saved.soldToday;
        k.broken = saved.broken;
        if (saved.experts) {
          k.hireExperts();
        }
      }
    }
    for (const r of save.reports) {
      reports.push({ report: { day: r.day, honest: r.honest, rosy: r.rosy, headline: r.headline as Report["headline"] }, rosy: r.rosyChosen });
    }
    reportIndex = reports.length - 1;
    if (save.alpine?.chairlift && !alpine.hasChairlift) {
      alpine.buildChairlift();
      openChairliftHead();
    }
    if (save.varingen) {
      const v = save.varingen;
      Object.assign(paper, { editions: v.editions, week: v.week, kmAtLastEdition: v.kmAtLastEdition, bestWeek: v.bestWeek, lastDay: v.lastDay, pressUntil: v.pressUntil });
      crowd.press = v.press;
      roadsToday = [...v.roadsToday];
      snowToday = v.snowToday;
      rainToday = v.rainToday;
      editionIndex = paper.editions.length - 1;
    } else {
      paper.lastDay = clock.day;
    }
    const crewAt = map.fromGrid(save.crew);
    if (crewAt) {
      [crew.x, crew.y] = crewAt;
    }
    forecastDay = clock.day;
    refreshForecast();
    if (season.ended) {
      clock.ended = true;
      showSeason(season.summer ? "summer" : "album");
    }
    document.getElementById("setup")!.hidden = fleet.garages.length > 0;
    setTool(fleet.garages.length > 0 ? restingTool() : "garage");
    camera.centreOn((crew.x + 0.5) * PX, (crew.y + 0.5) * PX, app.screen.width, app.screen.height);
    const changed = save.map.version !== map.version;
    const notes = [];
    if (result.dropped > 0) {
      notes.push(`${result.dropped} løyperuter passet ikke lenger og ble fjernet`);
    }
    if (result.changed > 0) {
      notes.push(`${result.changed} kryssinger ble endret`);
    }
    const roads = result.ploughedRoads.map((r) => r.replace(" (brøytet skogsbilvei)", "")).filter((r) => r !== "Brøytet skogsbilvei");
    if (result.ploughed > 0) {
      season.ploughedAway = roads.length ? roads : ["en skogsbilvei"];
    }
    const ploughed = result.ploughed > 0
      ? ` ${roads.length ? `${list(roads)} brøytes` : "En skogsbilvei brøytes"} i vinter, og løypa langs veien er borte. Løypelaget jobber med alternativer.`
      : "";
    return (changed
      ? `Kartet er oppdatert siden spillet ble lagret${notes.length ? `: ${notes.join(", ")}` : ", men alt passet"}.`
      : "") + ploughed;
  };

  let leaving = false;
  const autosave = () => {
    if (!leaving && fleet.garages.length > 0) {
      writeSlot("auto", snapshot());
    }
  };
  window.addEventListener("pagehide", autosave);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      autosave();
    }
  });

  const menu = document.getElementById("game-menu")!;
  const slotName = (slot: Slot) => (slot === "auto" ? "Autolagring" : `Plass ${slot}`);
  const renderMenu = () => {
    const rows = SLOTS.map((slot) => {
      const save = readSlot(slot);
      const when = save ? new Date(save.savedAt).toLocaleString("nb-NO", { dateStyle: "short", timeStyle: "short" }) : "";
      return `<tr>
        <th>${slotName(slot)}</th>
        <td>${save ? `${save.label}<br><small>lagret ${when}</small>` : "<small>tom</small>"}</td>
        <td>${slot === "auto" ? "" : `<button data-save="${slot}">Lagre</button>`}
          ${save ? `<button data-load="${slot}">Last inn</button>` : ""}</td>
      </tr>`;
    }).join("");
    menu.innerHTML = `
      <div class="head"><strong>💾 Spill</strong><button data-menu="close">✕</button></div>
      <table>${rows}</table>
      <div class="actions">
        <button data-menu="accounts">📒 Regnskap</button>
        <button data-menu="export">Lagre til fil</button>
        <button data-menu="import">Hent fra fil</button>
        <button data-menu="new" class="danger">Nytt spill</button>
      </div>
      <input type="file" accept=".json,application/json" hidden>
      <p class="note"></p>`;
  };
  const note = (text: string) => {
    menu.querySelector(".note")!.textContent = text;
  };
  const toggleMenu = (open = menu.hidden) => {
    menu.hidden = !open;
    if (open) {
      renderMenu();
    }
  };
  const reload = () => {
    leaving = true;
    location.reload();
  };
  menu.addEventListener("click", (e) => {
    const button = (e.target as HTMLElement).closest("button");
    if (!button) {
      return;
    }
    const { save: saveTo, load, menu: action } = button.dataset;
    if (saveTo) {
      const ok = writeSlot(saveTo as Slot, snapshot());
      renderMenu();
      note(ok ? `Lagret på ${slotName(saveTo as Slot).toLowerCase()}.` : "Klarte ikke å lagre: nettleseren tillater ikke lagring.");
    } else if (load) {
      autosave();
      setBoot({ kind: "slot", slot: load as Slot });
      reload();
    } else if (action === "close") {
      toggleMenu(false);
    } else if (action === "accounts") {
      toggleMenu(false);
      showAccounts(true);
    } else if (action === "export") {
      download(snapshot());
    } else if (action === "import") {
      menu.querySelector<HTMLInputElement>("input[type=file]")!.click();
    } else if (action === "new") {
      if (confirm("Starte et nytt spill? Det som ikke er lagret på en egen plass eller til fil, blir borte.")) {
        deleteSlot("auto");
        setBoot({ kind: "new" });
        reload();
      }
    }
  });
  menu.addEventListener("change", async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    try {
      const data = JSON.parse(await file.text());
      const problem = validate(data, map);
      if (problem) {
        note(problem);
        return;
      }
      autosave();
      setBoot({ kind: "file", save: data as SaveGame });
      reload();
    } catch {
      note("Klarte ikke å lese filen.");
    } finally {
      input.value = "";
    }
  });
  document.getElementById("menu-button")!.addEventListener("click", () => toggleMenu());

  if (saved) {
    const problem = validate(saved, map);
    if (problem) {
      showToast(`Kunne ikke laste spillet: ${problem}`);
    } else {
      const message = restore(saved);
      showToast(`💾 Fortsetter spillet fra ${saved.label.split(" · ")[0]}. ${message}`);
    }
  }

  redrawTracks();
  refreshHud();
}

const SIGN_STYLE = {
  station: { plate: 0x1c3f73, edge: 0x0d2240, text: 0xffffff, size: 15, prefix: "🚆 " },
  parking: { plate: 0x2f6fe0, edge: 0x173f8a, text: 0xffffff, size: 11, prefix: "P" },
} as const;

/**
 * A sign at every place the railway can be got past without building an underpass: existing
 * bridges and underpasses, and level crossings. They are few, small and decisive, so they are
 * marked at every zoom level.
 */
function addCrossingSigns(map: GameMap, tracks: TrackNetwork, layer: Container): { node: Container; kind: string }[] {
  const open = (x: number, y: number) =>
    map.inside(x, y) && map.has(x, y, Flag.Rail) && (map.has(x, y, Flag.Passage) || map.has(x, y, Flag.LevelCrossing)) && tracks.cost(x, y) !== null;
  const seen = new Set<number>();
  const out: { node: Container; kind: string }[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (seen.has(map.index(x, y)) || !open(x, y)) {
        continue;
      }
      const cluster: [number, number][] = [];
      const queue: [number, number][] = [[x, y]];
      seen.add(map.index(x, y));
      while (queue.length) {
        const [cx, cy] = queue.pop()!;
        cluster.push([cx, cy]);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (!seen.has(map.index(nx, ny)) && open(nx, ny)) {
            seen.add(map.index(nx, ny));
            queue.push([nx, ny]);
          }
        }
      }
      const level = cluster.some(([cx, cy]) => map.has(cx, cy, Flag.LevelCrossing));
      const mx = cluster.reduce((t, [cx]) => t + cx, 0) / cluster.length;
      const my = cluster.reduce((t, [, cy]) => t + cy, 0) / cluster.length;
      const sign = new Container();
      const text = new Text({ text: level ? "🚧" : "🌉", style: { fontSize: 13 }, resolution: 4 });
      text.anchor.set(0.5);
      const ring = new Graphics()
        .circle(0, 0, 11)
        .fill(0xffffff)
        .stroke({ width: 2.5, color: level ? 0xc0392b : 0x1f5fd1 });
      sign.addChild(ring, text);
      sign.position.set((mx + 0.5) * PX, (my + 0.5) * PX);
      layer.addChild(sign);
      out.push({ node: sign, kind: "crossing" });
    }
  }
  return out;
}

function addPoiLabels(map: GameMap, layer: Container): { node: Container; kind: string }[] {
  const out: { node: Container; kind: string }[] = [];
  const add = (node: Container, kind: string) => {
    layer.addChild(node);
    out.push({ node, kind });
  };
  for (const p of map.pois) {
    if (!p.name) {
      continue;
    }
    const at = { x: p.x * PX + PX / 2, y: p.y * PX };
    if (p.kind === "station") {
      add(signboard(SIGN_STYLE.station, p.name, at), p.kind);
      continue;
    }
    if (p.kind === "parking") {
      add(signboard(SIGN_STYLE.parking, "", at), p.kind);
      continue;
    }
    if (p.kind === "cafe" || p.kind === "cabin") {
      const label = new Text({
        text: p.kind === "cafe" ? `☕ ${p.name}` : `⌂ ${p.name}`,
        style: {
          fontFamily: "system-ui, sans-serif",
          fontSize: p.kind === "cafe" ? 11 : 10,
          fontWeight: p.kind === "cafe" ? "700" : "400",
          fontStyle: p.kind === "cabin" ? "italic" : "normal",
          fill: p.kind === "cafe" ? 0x8a3b12 : 0x4b5a64,
          stroke: { color: 0xffffff, width: 4, join: "round" },
        },
        resolution: 3,
      });
      label.anchor.set(0.5, 1);
      label.position.set(at.x, at.y - 2);
      add(label, p.kind);
      continue;
    }
    const crowded = map.pois.some(
      (o) =>
        o !== p &&
        ((o.kind === "station" && Math.hypot(o.x - p.x, o.y - p.y) < 12) ||
          (o.kind === "peak" && o.name === p.name)),
    );
    if (p.kind === "place" && crowded) {
      continue;
    }
    const label = new Text({
      text: p.kind === "peak" ? `▲ ${p.name}` : p.name,
      style: {
        fontFamily: "system-ui, sans-serif",
        fontSize: p.kind === "peak" ? 11 : 12,
        fontStyle: p.kind === "peak" ? "italic" : "normal",
        fontWeight: p.kind === "place" ? "700" : "400",
        fill: p.kind === "peak" ? 0x6a4a2a : 0x23323d,
        stroke: { color: 0xffffff, width: 4, join: "round" },
      },
      resolution: 3,
    });
    label.anchor.set(0.5, 1);
    label.position.set(at.x, at.y);
    add(label, p.kind);
  }
  return out;
}

function signboard(
  style: (typeof SIGN_STYLE)[keyof typeof SIGN_STYLE],
  name: string,
  at: { x: number; y: number },
): Container {
  const sign = new Container();
  const text = new Text({
    text: style.prefix + name,
    style: { fontFamily: "system-ui, sans-serif", fontSize: style.size, fontWeight: "700", fill: style.text },
    resolution: 3,
  });
  const padX = 5;
  const padY = 2;
  const w = text.width + padX * 2;
  const h = text.height + padY * 2;
  const g = new Graphics()
    .rect(-1, -6, 2, 6).fill(0x5b3d2a)
    .roundRect(-w / 2 + 1.5, -6 - h + 1.5, w, h, 3).fill({ color: 0x000000, alpha: 0.25 })
    .roundRect(-w / 2, -6 - h, w, h, 3).fill(style.plate).stroke({ width: 1.5, color: style.edge });
  text.position.set(-w / 2 + padX, -6 - h + padY);
  sign.addChild(g, text);
  sign.position.set(at.x, at.y + PX / 2);
  return sign;
}

watchForStaleBuild();
main().catch(showStartupError);
