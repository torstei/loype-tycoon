import { Application, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { Camera, OVERVIEW_BELOW } from "./camera";
import { dayLabel, GameClock, SPEEDS } from "./clock";
import { Fleet } from "./groomer";
import { Report, writeReport } from "./report";
import { Skijorer } from "./skijor";
import { Crowd, DayStats } from "./skiers";
import { TrackCrew } from "./crew";
import { GameMap } from "./map";
import { OVERVIEW_PX, renderOverview } from "./overview";
import { PX, renderLandscape } from "./render";
import { Flag, FLAG_NAMES, TERRAIN_NAMES } from "./terrain";
import { askCrossing } from "./crossing";
import { Condition, CONDITION_NAMES, Crossing, CROSSING_NAMES, CrossingOption, crossingOptions, lineTiles, Obstacle, roadTraffic, TrackNetwork } from "./tracks";
import { Weather, WEATHER_ICON } from "./weather";
import { Precipitation, Whimsy } from "./whimsy";
import "./style.css";

type Tool = "look" | "build" | "remove" | "garage";

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
const kr = (n: number) => `${n.toLocaleString("nb-NO")} kr`;

async function main() {
  const map = await GameMap.load("hakadal");
  const tracks = new TrackNetwork(map);
  const clock = new GameClock();
  const weather = new Weather();
  weather.advance(0, clock.hours);
  const fleet = new Fleet(map);
  let dieselToday = 0;
  let incidentsToday: string[] = [];
  let incidentsYesterday: string[] = [];
  const crowd = new Crowd(map, (amount) => {
    budget += amount;
  });
  let budget = START_BUDGET;
  let tool: Tool = "build";

  const app = new Application();
  await app.init({ resizeTo: window, background: "#c9d8ea", antialias: true });
  document.getElementById("stage")!.appendChild(app.canvas);

  const world = new Container();
  app.stage.addChild(world);

  await new Promise((r) => requestAnimationFrame(r));
  const overview = new Sprite(Texture.from(renderOverview(map)));
  overview.scale.set(PX / OVERVIEW_PX);
  const detail = new Sprite(Texture.from(renderLandscape(map)));
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
  world.addChild(cursor);
  const whimsy = new Whimsy(map);
  world.addChild(whimsy.layer);
  const startPoi = map.pois.find((p) => p.kind === "station" && p.name === "Hakadal") ?? map.pois[0];
  const crew = new TrackCrew(startPoi.x, startPoi.y);
  world.addChild(crew.layer);
  const labels = new Container();
  world.addChild(labels);
  const signs = addPoiLabels(map, labels);
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
    notify: (text: string) => {
      incidentsToday.push(text);
      crowd.reputation = Math.max(0.05, crowd.reputation - 0.02);
      showToast(text);
    },
  };

  const camera = new Camera(world);
  if (new URLSearchParams(location.search).has("debug")) {
    Object.assign(window, { loype: { map, world, camera, whimsy, tracks, clock, weather, fleet, crowd, skijorer, crew, reports: () => reports } });
  }
  camera.centreOn((startPoi.x + 0.5) * PX, startPoi.y * PX, app.screen.width, app.screen.height);

  let sinceRedraw = 0;
  let snowSinceReport = 0;
  let rainSinceReport = 0;
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
    if (clock.day !== forecastDay) {
      if (forecastDay >= 0) {
        closeDay(forecastDay);
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
    whimsy.update(dt, { x0: tl.x, y0: tl.y, x1: br.x, y1: br.y });
    crew.update(dt);
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
    garageTool.title = `4 · ${kr(fleet.nextGarageCost)}`;
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
    const starting = tracks.size === 0;
    const signature = starting ? "start" : connected.map((h) => `${h.x},${h.y}`).join(";");
    if (signature === trailheadSignature) {
      return;
    }
    trailheadSignature = signature;
    trailheadLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
    if (starting) {
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

  const redrawTracks = () => {
    refreshTrailheads();
    trackLayer.clear();
    const { lines, dots } = tracks.segments();
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
    let action = detached
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
    if (tracks.has(x, y)) {
      const since = clock.hours - tracks.groomedAt[i];
      const groomed = Number.isFinite(since) ? `preppet for ${since < 1 ? "under en time" : `${Math.floor(since)} t`} siden` : "aldri preppet";
      const crossing = tracks.crossing[i] as Crossing;
      action = `${crossing !== Crossing.None ? `🌉 ${CROSSING_NAMES[crossing]}<br>` : ""}${tracks.trampled(x, y) ? "🫎 elgspor i sporet<br>" : ""}<strong>Løype: ${CONDITION_NAMES[tracks.condition(x, y, weather)]}</strong>
        (${Math.round(tracks.quality(x, y, weather) * 100)} %)<br>
        nysnø ${tracks.newSnow[i].toFixed(0)} cm · is ${Math.round(tracks.ice[i] * 100)} % · ${groomed}<br>
        ≈ ${Math.round(tracks.usage[i])} skiløpere siste døgnet`;
    } else if (tool === "garage") {
      action = fleet.canPlace(x, y, tracks) ? `Garasje: ${kr(fleet.nextGarageCost)}` : "Kan ikke sette garasje her";
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
    const blocked = cost === null || (!tracks.has(x, y) && connectionProblem(x, y) !== null);
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
  const connectionProblem = (x: number, y: number): string | null => {
    if (tracks.size === 0) {
      const nearHead = crowd.trailheads.some((h) => Math.hypot(h.x - x, h.y - y) <= h.reach);
      return nearHead ? null : "Første løype må starte ved en stasjon, parkering eller et boligfelt";
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
      const [gx, gy] = tileAt(e.offsetX, e.offsetY);
      if (fleet.canPlace(gx, gy, tracks) && budget >= fleet.nextGarageCost) {
        budget -= fleet.nextGarageCost;
        fleet.place(gx, gy);
        setTool("look");
      } else {
        crew.refuse();
      }
      refreshHud();
      return;
    }
    if (e.button === 0 && tool !== "look") {
      painting = tileAt(e.offsetX, e.offsetY);
      stroke = [];
      strokeCrossing = null;
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
    } else if (e.code === "KeyF") {
      showReport(reportPanel.hidden);
    } else if (e.code === "KeyH" || e.key === "?") {
      help.hidden = !help.hidden;
    } else if (e.code === "Escape") {
      help.hidden = true;
      showReport(false);
    } else {
      const t = ({ Digit1: "look", Digit2: "build", Digit3: "remove", Digit4: "garage" } as Record<string, Tool>)[e.code];
      if (!t) {
        return;
      }
      setTool(t);
    }
    e.preventDefault();
  });

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
