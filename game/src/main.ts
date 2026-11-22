import { Application, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { Camera, OVERVIEW_BELOW } from "./camera";
import { dayLabel, GameClock, SPEEDS } from "./clock";
import { Fleet } from "./groomer";
import { Crowd } from "./skiers";
import { TrackCrew } from "./crew";
import { GameMap } from "./map";
import { OVERVIEW_PX, renderOverview } from "./overview";
import { PX, renderLandscape } from "./render";
import { FLAG_NAMES, TERRAIN_NAMES } from "./terrain";
import { Condition, CONDITION_NAMES, lineTiles, TrackNetwork } from "./tracks";
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
  world.addChild(trackLayer, trailheadLayer, fleet.garageLayer, fleet.machineLayer, crowd.layer);
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
  world.addChild(crowd.bubbles);
  const night = new Graphics();
  const lightsWorld = new Container();
  lightsWorld.addChild(fleet.lights);
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
  };

  const camera = new Camera(world);
  if (new URLSearchParams(location.search).has("debug")) {
    Object.assign(window, { loype: { map, world, camera, whimsy, tracks, clock, weather, fleet, crowd } });
  }
  camera.centreOn((startPoi.x + 0.5) * PX, startPoi.y * PX, app.screen.width, app.screen.height);

  let sinceRedraw = 0;
  let sinceHud = 0;
  let forecastDay = -1;
  app.ticker.add((ticker) => {
    const dt = Math.min(0.1, ticker.deltaMS / 1000);
    const hours = clock.tick(dt);
    if (hours > 0) {
      const { snow, rain } = weather.advance(clock.hours - hours, hours);
      tracks.applyWeather(hours, weather, snow, rain);
      fleet.update(hours, clock.hours, clock.hourOfDay, tracks, weather, ledger);
      crowd.update(hours, clock, weather, tracks);
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
    crowd.animate(dt, s >= OVERVIEW_BELOW);
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
    const stats = crowd.endDay();
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

  let trailheadSignature = "";
  const refreshTrailheads = () => {
    crowd.connect(tracks);
    const connected = crowd.trailheads.filter((h) => h.entry);
    const signature = connected.map((h) => `${h.x},${h.y}`).join(";");
    if (signature === trailheadSignature) {
      return;
    }
    trailheadSignature = signature;
    trailheadLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
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
    let action = cost === null ? "Kan ikke bygge her" : `Bygge løype: ${kr(cost)}`;
    if (tracks.has(x, y)) {
      const since = clock.hours - tracks.groomedAt[i];
      const groomed = Number.isFinite(since) ? `preppet for ${since < 1 ? "under en time" : `${Math.floor(since)} t`} siden` : "aldri preppet";
      action = `<strong>Løype: ${CONDITION_NAMES[tracks.condition(x, y, weather)]}</strong>
        (${Math.round(tracks.quality(x, y, weather) * 100)} %)<br>
        nysnø ${tracks.newSnow[i].toFixed(0)} cm · is ${Math.round(tracks.ice[i] * 100)} % · ${groomed}`;
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
    cursor.clear().rect(x * PX, y * PX, PX, PX).stroke({ width: 2, color: cost === null ? 0xc0392b : 0x1f5fd1 });
  };

  /** Returns what a newly built tile cost, so a corner cut later in the same drag can refund it. */
  const applyTool = (x: number, y: number): number => {
    if (tool === "build" && !tracks.has(x, y)) {
      const cost = tracks.cost(x, y);
      if (cost !== null && cost <= budget) {
        budget -= cost;
        tracks.add(x, y);
        return cost;
      }
    } else if (tool === "remove" && tracks.has(x, y)) {
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
    if (tool === "build" && diagonalToBefore && last.paid > 0) {
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
    if (e.button === 0 && whimsy.poke(w.x, w.y)) {
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
      }
      painting = [x, y];
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

  const buildAt = (x: number, y: number): string | null => {
    if (tracks.has(x, y)) {
      return null;
    }
    const cost = tracks.cost(x, y);
    if (cost === null) {
      return "Kan ikke bygge her";
    }
    if (cost > budget) {
      return `Ikke råd: ${kr(cost)}`;
    }
    budget -= cost;
    tracks.add(x, y);
    return null;
  };

  const stepCrew = (dx: number, dy: number) => {
    const nx = crew.x + dx;
    const ny = crew.y + dy;
    if (!map.inside(nx, ny)) {
      crew.refuse();
      return;
    }
    if (crew.building) {
      const here = tracks.cost(crew.x, crew.y) !== null ? buildAt(crew.x, crew.y) : null;
      const problem = here ?? buildAt(nx, ny);
      redrawTracks();
      refreshHud();
      if (problem) {
        crew.refuse();
        describe(nx, ny);
        if (tracks.cost(nx, ny) !== null) {
          info.innerHTML += `<br><strong class="warn">${problem}</strong>`;
        }
        return;
      }
    }
    crew.x = nx;
    crew.y = ny;
    describe(nx, ny);
    followCrew();
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
    } else if (e.code === "KeyH" || e.key === "?") {
      help.hidden = !help.hidden;
    } else if (e.code === "Escape") {
      help.hidden = true;
    } else {
      const t = ({ Digit1: "look", Digit2: "build", Digit3: "remove", Digit4: "garage" } as Record<string, Tool>)[e.code];
      if (!t) {
        return;
      }
      setTool(t);
    }
    e.preventDefault();
  });

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
