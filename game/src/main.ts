import { Application, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { Camera, OVERVIEW_BELOW } from "./camera";
import { dayLabel, GameClock, SPEEDS, weekday } from "./clock";
import { Fleet, GARAGE_REACH } from "./groomer";
import { areas, Report, writeReport } from "./report";
import { DayNews, Edition, PRESS_DAYS, PRESS_DEMAND, PRESS_REPUTATION, PUBLISH_HOUR, PUBLISH_WEEKDAY, writeEdition } from "./varingen";
import {
  decodeTracks,
  deleteSlot,
  download,
  encodeTracks,
  readSlot,
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
import { Crowd, DayStats } from "./skiers";
import { TrackCrew } from "./crew";
import { GameMap } from "./map";
import { OVERVIEW_PX, renderOverview } from "./overview";
import { landscapeFields, PX, renderChunk, renderLandscape } from "./render";
import { LandscapeChunks } from "./chunks";
import { Flag, FLAG_NAMES, TERRAIN_NAMES } from "./terrain";
import { askCrossing } from "./crossing";
import { Condition, CONDITION_NAMES, Crossing, CROSSING_NAMES, CrossingOption, crossingOptions, lineTiles, Obstacle, roadTraffic, TrackNetwork } from "./tracks";
import { Weather, WEATHER_ICON } from "./weather";
import { Precipitation, Whimsy } from "./whimsy";
import "./style.css";

type Tool = "look" | "build" | "remove" | "garage";

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
/** How far from the network a drag may start and still be linked up automatically, in tiles. */
const CONNECT_REACH = 3;
const kr = (n: number) => `${n.toLocaleString("nb-NO")} kr`;

async function main() {
  const map = await GameMap.load("hakadal");
  const tracks = new TrackNetwork(map);
  const clock = new GameClock();
  clock.paused = true;
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
  const overview = new Sprite(Texture.from(renderOverview(map)));
  overview.scale.set(PX / OVERVIEW_PX);
  const chunks = new LandscapeChunks(map);
  const detail = chunks.layer;
  document.getElementById("loading")?.remove();
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
  const skijorer = new Skijorer(map);
  world.addChild(trackLayer, trailheadLayer, fleet.garageLayer, fleet.machineLayer, crowd.layer, skijorer.layer);
  const cursor = new Graphics();
  const endsLayer = new Graphics();
  world.addChild(cursor);
  const whimsy = new Whimsy(map);
  world.addChild(whimsy.layer);
  const startPoi = map.pois.find((p) => p.kind === "station" && p.name === "Hakadal") ?? map.pois[0];
  const crew = new TrackCrew(startPoi.x, startPoi.y);
  world.addChild(crew.layer);
  const labels = new Container();
  world.addChild(labels);
  const signs = addPoiLabels(map, labels);
  world.addChild(endsLayer);
  const night = new Graphics();
  const lightsWorld = new Container();
  lightsWorld.addChild(crowd.lights, fleet.lights, whimsy.bubbleLayer, skijorer.bubble, crowd.bubbles);
  const precipitation = new Precipitation();
  app.stage.addChild(night, lightsWorld, precipitation.layer);
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
    Object.assign(window, { loype: { map, world, camera, whimsy, tracks, clock, weather, fleet, crowd, skijorer, crew, chunks, render: { renderChunk, renderLandscape, landscapeFields }, reports: () => reports, paper: () => paper, publishEdition: () => publishEdition() } });
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
  app.ticker.add((ticker) => {
    const dt = Math.min(0.1, ticker.deltaMS / 1000);
    const hours = clock.tick(dt);
    if (hours > 0) {
      const { snow, rain } = weather.advance(clock.hours - hours, hours);
      snowSinceReport += snow;
      rainSinceReport += rain;
      snowToday += snow;
      rainToday += rain;
      tracks.applyWeather(hours, weather, snow, rain);
      fleet.update(hours, clock.hours, clock.hourOfDay, tracks, weather, ledger);
      crowd.update(hours, clock, weather, tracks);
      skijorer.update(hours, clock, tracks);
      whimsy.simulate(hours, tracks, clock.hours, (x, y) => crowd.near(x, y, 5));
      sinceRedraw += hours;
      if (sinceRedraw >= 0.25) {
        sinceRedraw = 0;
        redrawTracks();
      }
    }
    sinceHud += dt;
    if (sinceHud >= 0.25) {
      sinceHud = 0;
      refreshHud();
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
        autosave();
      }
      forecastDay = clock.day;
      refreshForecast();
    }
    const darkness = 1 - clock.daylight();
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
    skijorer.animate(dt, s >= OVERVIEW_BELOW, 1 - clock.daylight(), crowd.lights);
    for (const { node, kind } of signs) {
      node.scale.set(s < 1 ? 1 / s : 1);
      node.visible = s >= OVERVIEW_BELOW || kind !== "parking";
    }
    const tl = world.toLocal({ x: 0, y: 0 });
    const br = world.toLocal({ x: app.screen.width, y: app.screen.height });
    if (detail.visible) {
      chunks.update(tl.x, tl.y, br.x, br.y);
    }
    whimsy.update(dt, { x0: tl.x, y0: tl.y, x1: br.x, y1: br.y });
    crew.update(dt);
    drawEnds(dt);
    const kind = weather.precipRate <= 0 ? "none" : weather.temperature < 0.8 ? "snow" : "rain";
    precipitation.update(dt, app.screen.width, app.screen.height, kind, weather.precipRate / 1.5);
  });

  const hud = document.getElementById("hud")!;
  const info = document.getElementById("info")!;
  document.getElementById("attribution")!.textContent = map.attribution;

  const topbar = document.getElementById("topbar")!;
  const placePanels = () => {
    const top = `${topbar.offsetHeight + 8}px`;
    document.getElementById("forecast")!.style.top = top;
    document.getElementById("help")!.style.top = top;
    document.getElementById("report")!.style.top = top;
    document.getElementById("paper")!.style.top = top;
  };
  new ResizeObserver(placePanels).observe(topbar);
  const fleetPanel = document.getElementById("fleet")!;
  const forecastPanel = document.getElementById("forecast")!;

  const refreshHud = () => {
    const km = (tracks.size * map.tileSize) / 1000;
    const nowIcon = weather.precipRate > 0 ? (weather.temperature < 0.8 ? "🌨️" : "🌧️") : clock.daylight() > 0.5 ? "☀️" : "🌙";
    hud.innerHTML = `
      <strong>Løype Tycoon</strong> · ${map.title}
      <span class="clock">${clock.paused ? "⏸ " : ""}${clock.label()}</span>
      <span>${nowIcon} ${weather.temperature.toFixed(0)} °C · snø ${weather.snowDepth.toFixed(0)} cm</span>
      <span>Kasse: ${kr(budget)}</span>
      <span>⛷ ${crowd.today.skiers} i dag · omdømme ${Math.round(crowd.reputation * 100)} %</span>
      <span>Løypenett: ${km.toFixed(2)} km</span>
      <span class="mode ${crew.building ? "on" : ""}">Tråkkemodus: ${crew.building ? "PÅ" : "av"}</span>
      <span class="hint">H = hjelp</span>`;
    for (const btn of document.querySelectorAll<HTMLButtonElement>("[data-tool]")) {
      btn.classList.toggle("active", btn.dataset.tool === tool);
    }
    for (const btn of document.querySelectorAll<HTMLButtonElement>("[data-speed]")) {
      const i = Number(btn.dataset.speed);
      btn.classList.toggle("active", i < 0 ? clock.paused : !clock.paused && clock.speedIndex === i);
    }
    const garageTool = document.querySelector<HTMLButtonElement>('[data-tool="garage"]')!;
    garageTool.title = `4 · ${fleet.nextGarageCost === 0 ? "gratis" : kr(fleet.nextGarageCost)}`;
    fleetPanel.hidden = fleet.groomers.length === 0;
    fleetPanel.innerHTML = `
      <div class="head"><strong>Løypemaskiner</strong>
        <button id="schedule">${fleet.schedule === "night" ? "🌙 Prepper om natta" : "🕑 Prepper døgnet rundt"}</button></div>
      ${fleet.groomers.map((g) => `<div class="row"><span class="name">🚜 ${g.name}</span> ${g.status}</div>`).join("")}`;
  };
  fleetPanel.addEventListener("pointerdown", (e) => {
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
  const showToast = (html: string) => {
    toast.innerHTML = html;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (toast.hidden = true), 7000);
  };

  const closeDay = (day: number) => {
    yesterdayHyped = crowd.hype;
    incidentsYesterday = incidentsToday;
    incidentsToday = [];
    const stats = crowd.endDay();
    yesterday = stats;
    logNews(day, stats);
    const happy = stats.finished > 0 ? Math.round((stats.satisfaction / stats.finished) * 100) : 0;
    const diesel = dieselToday;
    dieselToday = 0;
    if (stats.skiers === 0 && diesel === 0) {
      return;
    }
    showToast(`<strong>${dayLabel(day)}:</strong> ${stats.skiers} skiløpere · ${happy} % fornøyde ·
      Vipps <span class="plus">+${kr(stats.donations)}</span>
      ${stats.members > 0 ? `· ${stats.members} nye medlemmer <span class="plus">+${kr(stats.members * 400)}</span>` : ""}
      · diesel <span class="minus">−${kr(diesel)}</span>`);
  };

  const paper = {
    editions: [] as Edition[],
    week: [] as DayNews[],
    kmAtLastEdition: 0,
    bestWeek: 0,
    lastDay: -1,
    pressUntil: -1,
  };
  let editionIndex = -1;
  const paperPanel = document.getElementById("paper")!;
  const paperButton = document.getElementById("paper-button")!;
  const trackKm = () => (tracks.size * map.tileSize) / 1000;

  const logNews = (day: number, stats: DayStats) => {
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
      icy: icy / n,
      bare: bare / n,
    });
    roadsToday = [];
    snowToday = 0;
    rainToday = 0;
    if (day + 1 >= paper.pressUntil) {
      crowd.press = 1;
    }
  };

  const publishEdition = () => {
    const groups = areas(map, tracks);
    const place = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)[0]?.[0] ?? "Hakadal";
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
    showToast(`🗞 <strong>Varingen er ute:</strong> «${edition.headline}» ${effect}`);
    if (paperPanel.hidden) {
      paperButton.classList.add("unread");
    } else {
      renderPaper();
    }
  };

  const showPaper = (open: boolean) => {
    paperPanel.hidden = !open;
    if (open) {
      paperButton.classList.remove("unread");
      renderPaper();
    }
  };

  const renderPaper = () => {
    const edition = paper.editions[editionIndex];
    const bar = `<div class="bar">
        <button data-p="prev" ${editionIndex <= 0 ? "disabled" : ""}>‹</button>
        <strong>🗞 Varingen</strong>
        <button data-p="next" ${editionIndex >= paper.editions.length - 1 ? "disabled" : ""}>›</button>
        <button data-p="close">✕</button>
      </div>`;
    paperPanel.innerHTML = `${bar}<div class="page">${edition ? edition.html : "<p class=\"empty\">Varingen kommer ut hver torsdag. Gi dem noe å skrive om.</p>"}</div>`;
  };

  paperPanel.addEventListener("click", (e) => {
    const action = (e.target as HTMLElement).closest("button")?.dataset.p;
    if (action === "close") {
      showPaper(false);
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

  const reports: { report: Report; rosy: boolean }[] = [];
  let reportIndex = -1;
  const reportPanel = document.getElementById("report")!;
  const reportButton = document.getElementById("report-button")!;

  const showReport = (open: boolean) => {
    reportPanel.hidden = !open;
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
      <div class="body">${entry.rosy ? entry.report.rosy : entry.report.honest}</div>`;
  };

  reportPanel.addEventListener("click", (e) => {
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
    if (reports.length === 1) {
      showReport(true);
    } else if (reportPanel.hidden) {
      reportButton.classList.add("unread");
    } else {
      renderReport();
    }
  };

  let trailheadSignature = "";
  const refreshTrailheads = () => {
    crowd.connect(tracks);
    const connected = crowd.trailheads.filter((h) => h.entry);
    const choosingHome = fleet.garages.length === 0;
    const starting = tracks.size === 0;
    const signature = choosingHome ? "home" : starting ? "start" : connected.map((h) => `${h.x},${h.y}`).join(";");
    if (signature === trailheadSignature) {
      return;
    }
    trailheadSignature = signature;
    trailheadLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
    if (!choosingHome && starting) {
      const garage = fleet.garages[0];
      const g = new Graphics()
        .circle((garage.x + 0.5) * PX, (garage.y + 0.5) * PX, (GARAGE_REACH + 0.5) * PX)
        .fill({ color: 0x1f5fd1, alpha: 0.1 })
        .stroke({ width: 2, color: 0x1f5fd1, alpha: 0.7 });
      trailheadLayer.addChild(g);
      return;
    }
    if (choosingHome) {
      for (const h of crowd.trailheads) {
        const g = new Graphics()
          .circle((h.x + 0.5) * PX, (h.y + 0.5) * PX, h.reach * PX)
          .fill({ color: 0x1f8a3a, alpha: 0.08 })
          .stroke({ width: 1.5, color: 0x1f8a3a, alpha: 0.5 })
          .circle((h.x + 0.5) * PX, (h.y + 0.5) * PX, 6)
          .fill(0x8fa3bf)
          .stroke({ width: 1.5, color: 0xffffff });
        const icon = new Text({ text: "⛷", style: { fontSize: 8, fill: 0xffffff }, resolution: 4 });
        icon.anchor.set(0.5);
        icon.position.set((h.x + 0.5) * PX, (h.y + 0.5) * PX);
        trailheadLayer.addChild(g, icon);
      }
      return;
    }
    for (const h of connected) {
      const [ex, ey] = h.entry!;
      const g = new Graphics()
        .moveTo((h.x + 0.5) * PX, (h.y + 0.5) * PX)
        .lineTo((ex + 0.5) * PX, (ey + 0.5) * PX)
        .stroke({ width: 1.5, color: 0x1f8a3a, alpha: 0.6 })
        .circle((h.x + 0.5) * PX, (h.y + 0.5) * PX, 6)
        .fill(0x1f8a3a)
        .stroke({ width: 1.5, color: 0xffffff });
      const icon = new Text({ text: "⛷", style: { fontSize: 8, fill: 0xffffff }, resolution: 4 });
      icon.anchor.set(0.5);
      icon.position.set((h.x + 0.5) * PX, (h.y + 0.5) * PX);
      trailheadLayer.addChild(g, icon);
    }
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

  const describe = (x: number, y: number) => {
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
      ? "Kan ikke bygge her"
      : obstacle === "rail"
        ? `Jernbane: krever undergang (fra ${kr(cost + 120_000)})`
        : obstacle === "road"
          ? `${map.roadName(x, y) ?? "Vei"}: kryssing fra ${kr(cost + roadTraffic(tracks.traffic(x, y)).levelPrice)}`
          : map.has(x, y, Flag.Passage) && (map.has(x, y, Flag.Rail) || map.has(x, y, Flag.Road))
            ? `Eksisterende bru/undergang: ${kr(cost)}`
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
        nysnø ${tracks.newSnow[i].toFixed(0)} cm · is ${Math.round(tracks.ice[i] * 100)} % · ${groomed}<br>
        ≈ ${Math.round(tracks.usage[i])} skiløpere siste døgnet`;
    } else if (tool === "garage") {
      const problem = garageProblem(x, y);
      action = problem ? `<span class="minus">${problem}</span>` : `Garasje her: ${fleet.nextGarageCost === 0 ? "gratis" : kr(fleet.nextGarageCost)}`;
    }
    const head = crowd.trailheads.find((h) => Math.abs(h.x - x) <= 1 && Math.abs(h.y - y) <= 1);
    const headLine = head
      ? `<br><span class="${head.entry ? "plus" : "minus"}">⛷ ${head.name}: ${
          head.entry ? `koblet til løypa · ${head.today} skiløpere i dag` : `ingen løype innen ${head.reach * map.tileSize} m`
        }</span>`
      : "";
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
  /** Why a garage cannot go here, or null if it can. */
  const garageProblem = (x: number, y: number): string | null => {
    if (!fleet.canPlace(x, y, tracks)) {
      return "Kan ikke sette garasje her";
    }
    if (fleet.garages.length === 0 && !crowd.trailheads.some((h) => Math.hypot(h.x - x, h.y - y) <= h.reach + GARAGE_REACH)) {
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
      showToast("🏠 Løypelaget har flyttet inn, og Gamle Gunnar har fått tak over hodet! Bygg den første løypa ut fra garasjen — med musa, eller med T og tastene rundt S. Mellomrom starter tiden.");
    } else {
      setTool("look");
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

  const drawEnds = (dt: number) => {
    endsLayer.clear();
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
      return { status: "blocked", paid: 0, reason: "Kan ikke bygge her" };
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
    if (strokeCrossing?.obstacle === obstacle && tracks.traffic(x, y) <= strokeCrossing.traffic) {
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
        title: obstacle === "rail" ? "Løypa krysser Gjøvikbanen" : `Løypa krysser ${road ?? "en vei"}`,
        lead: obstacle === "rail" ? "Å gå over skinnene er ikke lov. Ikke engang i Hakadal." : roadTraffic(traffic).describe,
        options: crossingOptions(obstacle, traffic),
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
      return result.paid;
    }
    if (tool === "remove" && tracks.has(x, y)) {
      tracks.remove(x, y);
    }
    return 0;
  };

  let stroke: { x: number; y: number; paid: number }[] = [];
  let painting: [number, number] | null = null;

  const paintStep = (x: number, y: number) => {
    const paid = applyTool(x, y);
    const [before, last] = stroke.slice(-2);
    const diagonalToBefore = before && Math.abs(before.x - x) === 1 && Math.abs(before.y - y) === 1;
    // Never cut a corner through a crossing: that money bought a bridge, not a staircase step.
    const lastIsPlain = last && tracks.crossing[map.index(last.x, last.y)] === Crossing.None;
    if (tool === "build" && diagonalToBefore && last.paid > 0 && lastIsPlain) {
      tracks.remove(last.x, last.y);
      budget += last.paid;
      stroke.pop();
    }
    stroke.push({ x, y, paid });
  };
  let panning: { x: number; y: number } | null = null;

  app.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  app.canvas.addEventListener("pointerdown", (e) => {
    const w = world.toLocal({ x: e.offsetX, y: e.offsetY });
    if (e.button === 0 && (whimsy.poke(w.x, w.y) || skijorer.poke(w.x, w.y))) {
      return;
    }
    if (e.button === 0 && tool === "look") {
      [crew.x, crew.y] = tileAt(e.offsetX, e.offsetY);
    }
    if (e.button === 0 && tool === "garage") {
      placeGarage(...tileAt(e.offsetX, e.offsetY));
      return;
    }
    if (e.button === 0 && tool !== "look") {
      painting = tileAt(e.offsetX, e.offsetY);
      stroke = [];
      strokeCrossing = null;
      const [px, py] = painting;
      if (tool === "build" && !tracks.has(px, py) && tracks.cost(px, py) !== null && connectionProblem(px, py) && fleet.garages.length > 0) {
        const link = connector(px, py);
        if (link) {
          for (const [lx, ly] of link) {
            paintStep(lx, ly);
          }
        } else {
          const anchor = nearestAnchor(px, py);
          if (anchor) {
            hint = { from: [px, py], to: anchor, ttl: 3 };
            showToast(`${connectionProblem(px, py)}. ${tracks.size > 0 ? "Nærmeste løype er markert — start draget derfra." : "Garasjen er markert."}`);
          }
          painting = null;
          return;
        }
      }
      paintStep(...painting);
      redrawTracks();
      refreshHud();
    } else {
      panning = { x: e.clientX, y: e.clientY };
    }
  });
  window.addEventListener("pointerup", () => {
    painting = null;
    panning = null;
  });
  app.canvas.addEventListener("pointermove", (e) => {
    const [x, y] = tileAt(e.offsetX, e.offsetY);
    describe(x, y);
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
    if (i < 0) {
      clock.paused = !clock.paused;
    } else {
      clock.paused = false;
      clock.speedIndex = Math.max(0, Math.min(SPEEDS.length - 1, i));
    }
    refreshHud();
  };
  for (const btn of document.querySelectorAll<HTMLButtonElement>("[data-speed]")) {
    btn.addEventListener("click", () => setSpeed(Number(btn.dataset.speed)));
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
    if (e.ctrlKey || e.metaKey || e.altKey) {
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
    } else if (e.code === "KeyF") {
      showReport(reportPanel.hidden);
    } else if (e.code === "KeyV") {
      showPaper(paperPanel.hidden);
    } else if (e.code === "KeyH" || e.key === "?") {
      help.hidden = !help.hidden;
    } else if (e.code === "Escape") {
      help.hidden = true;
      showReport(false);
      showPaper(false);
    } else {
      const t = ({ Digit1: "look", Digit2: "build", Digit3: "remove", Digit4: "garage" } as Record<string, Tool>)[e.code];
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
    label: `${clock.label()} · ${((tracks.size * map.tileSize) / 1000).toFixed(1)} km · ${kr(budget)}`,
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
    weather: { snowDepth: weather.snowDepth, plans: weather.allPlans() },
    tracks: encodeTracks(map, tracks),
    garages: fleet.groomers.map((g) => ({ tile: map.toGrid(g.garage.x, g.garage.y), totalGroomed: g.totalGroomed })),
    schedule: fleet.schedule,
    reports: reports.map(({ report, rosy }) => ({ ...report, rosyChosen: rosy })),
    crew: map.toGrid(crew.x, crew.y),
    varingen: { ...paper, press: crowd.press, roadsToday, snowToday, rainToday },
  });

  /** Rebuild a saved game on this freshly started page. Returns what to tell the player. */
  const restore = (save: SaveGame): string => {
    clock.hours = save.clock.hours;
    clock.speedIndex = save.clock.speedIndex;
    clock.paused = true;
    budget = save.budget;
    crowd.reputation = save.reputation;
    crowd.today = { ...save.today };
    crowd.hype = save.hype;
    yesterday = save.yesterday;
    yesterdayHyped = save.yesterdayHyped;
    dieselToday = save.dieselToday;
    incidentsToday = [...save.incidentsToday];
    incidentsYesterday = [...save.incidentsYesterday];
    lastReportDay = save.lastReportDay;
    snowSinceReport = save.snowSinceReport;
    rainSinceReport = save.rainSinceReport;
    weather.restore(save.weather.plans, save.weather.snowDepth, clock.hours);
    const result = decodeTracks(map, tracks, save.tracks);
    for (const g of save.garages) {
      const local = map.fromGrid(g.tile);
      if (local) {
        fleet.place(...local).totalGroomed = g.totalGroomed;
      }
    }
    fleet.schedule = save.schedule;
    for (const r of save.reports) {
      reports.push({ report: { day: r.day, honest: r.honest, rosy: r.rosy, headline: r.headline as Report["headline"] }, rosy: r.rosyChosen });
    }
    reportIndex = reports.length - 1;
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
    document.getElementById("setup")!.hidden = fleet.garages.length > 0;
    setTool(fleet.garages.length > 0 ? "look" : "garage");
    camera.centreOn((crew.x + 0.5) * PX, (crew.y + 0.5) * PX, app.screen.width, app.screen.height);
    const changed = save.map.version !== map.version;
    const notes = [];
    if (result.dropped > 0) {
      notes.push(`${result.dropped} løyperuter passet ikke lenger og ble fjernet`);
    }
    if (result.changed > 0) {
      notes.push(`${result.changed} kryssinger ble endret`);
    }
    return changed
      ? `Kartet er oppdatert siden spillet ble lagret${notes.length ? `: ${notes.join(", ")}` : ", men alt passet"}.`
      : "";
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

  // Pick up where we left off: an explicit load or new game, otherwise the autosave.
  const boot = takeBoot();
  const saved = boot?.kind === "new" ? null : boot?.kind === "file" ? boot.save : readSlot(boot?.kind === "slot" ? boot.slot : "auto");
  if (saved) {
    const problem = validate(saved, map);
    if (problem) {
      showToast(`Kunne ikke laste spillet: ${problem}`);
    } else {
      const message = restore(saved);
      showToast(`💾 Fortsetter spillet fra ${saved.label.split(" · ")[0]}. ${message} Mellomrom starter tiden.`);
    }
  }

  redrawTracks();
  refreshHud();
}

const SIGN_STYLE = {
  station: { plate: 0x1c3f73, edge: 0x0d2240, text: 0xffffff, size: 15, prefix: "🚆 " },
  parking: { plate: 0x2f6fe0, edge: 0x173f8a, text: 0xffffff, size: 11, prefix: "P" },
} as const;

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

main().catch((err) => {
  document.body.textContent = `Klarte ikke å starte: ${err}`;
});
