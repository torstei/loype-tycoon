import { Application, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { Camera, OVERVIEW_BELOW } from "./camera";
import { TrackCrew } from "./crew";
import { GameMap } from "./map";
import { OVERVIEW_PX, renderOverview } from "./overview";
import { PX, renderLandscape } from "./render";
import { FLAG_NAMES, TERRAIN_NAMES } from "./terrain";
import { lineTiles, TrackNetwork } from "./tracks";
import { Snowfall, Whimsy } from "./whimsy";
import "./style.css";

type Tool = "look" | "build" | "remove";

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
  world.addChild(trackLayer);
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
  const snowfall = new Snowfall();
  app.stage.addChild(snowfall.layer);

  const camera = new Camera(world);
  if (new URLSearchParams(location.search).has("debug")) {
    Object.assign(window, { loype: { map, world, camera, whimsy, tracks } });
  }
  camera.centreOn((startPoi.x + 0.5) * PX, startPoi.y * PX, app.screen.width, app.screen.height);

  app.ticker.add((ticker) => {
    const dt = Math.min(0.1, ticker.deltaMS / 1000);
    camera.update(dt);
    world.x = Math.min(app.screen.width / 2, Math.max(app.screen.width / 2 - mapW * world.scale.x, world.x));
    world.y = Math.min(app.screen.height / 2, Math.max(app.screen.height / 2 - mapH * world.scale.y, world.y));
    const s = camera.scale;
    detail.alpha = Math.max(0, Math.min(1, (s - 0.4) / 0.1));
    detail.visible = detail.alpha > 0;
    whimsy.detail = s >= OVERVIEW_BELOW;
    for (const { node, kind } of signs) {
      node.scale.set(s < 1 ? 1 / s : 1);
      node.visible = s >= OVERVIEW_BELOW || kind !== "parking";
    }
    const tl = world.toLocal({ x: 0, y: 0 });
    const br = world.toLocal({ x: app.screen.width, y: app.screen.height });
    whimsy.update(dt, { x0: tl.x, y0: tl.y, x1: br.x, y1: br.y });
    crew.update(dt);
    snowfall.update(dt, app.screen.width, app.screen.height);
  });

  const hud = document.getElementById("hud")!;
  const info = document.getElementById("info")!;
  document.getElementById("attribution")!.textContent = map.attribution;

  const refreshHud = () => {
    const km = (tracks.size * map.tileSize) / 1000;
    hud.innerHTML = `
      <strong>Løype Tycoon</strong> · ${map.title}
      <span>Kasse: ${kr(budget)}</span>
      <span>Løypenett: ${km.toFixed(2)} km</span>
      <span class="mode ${crew.building ? "on" : ""}">Tråkkemodus: ${crew.building ? "PÅ" : "av"}</span>
      <span class="hint">H = hjelp</span>`;
    for (const btn of document.querySelectorAll<HTMLButtonElement>("[data-tool]")) {
      btn.classList.toggle("active", btn.dataset.tool === tool);
    }
  };

  const redrawTracks = () => {
    trackLayer.clear();
    const { lines, dots } = tracks.segments();
    // Stacked strokes leave two blue grooves in a groomed white band.
    for (const [width, color] of [[11, 0x1b3f7a], [9, 0xf4f8ff], [5, 0x2f6fe0], [2.5, 0xf4f8ff]] as const) {
      for (const [x0, y0, x1, y1] of lines) {
        trackLayer.moveTo(x0 * PX, y0 * PX).lineTo(x1 * PX, y1 * PX);
      }
      trackLayer.stroke({ width, color, cap: "round", join: "round" });
      for (const [x, y] of dots) {
        trackLayer.circle(x * PX, y * PX, width / 2);
      }
      trackLayer.fill(color);
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
    info.innerHTML = `
      ${poi ? `<strong>${poi.name}</strong><br>` : ""}
      ${TERRAIN_NAMES[map.terrainAt(x, y)]}${flags.length ? ` · ${flags.join(", ")}` : ""}<br>
      ${map.elevationAt(x, y)} moh · stigning ${map.slopeAt(x, y).toFixed(0)} %<br>
      ${cost === null ? "Kan ikke bygge her" : `Løype: ${kr(cost)}`}`;
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
      const problem = buildAt(crew.x, crew.y) ?? buildAt(nx, ny);
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
    snowfall.enabled = !snowfall.enabled;
    snowButton.classList.toggle("active", snowfall.enabled);
  };
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
    } else if (e.code === "KeyN") {
      toggleSnow();
    } else if (e.code === "KeyH" || e.key === "?") {
      help.hidden = !help.hidden;
    } else if (e.code === "Escape") {
      help.hidden = true;
    } else {
      const t = ({ Digit1: "look", Digit2: "build", Digit3: "remove" } as Record<string, Tool>)[e.code];
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
