const NS = "http://www.w3.org/2000/svg";

/** Half a ski's width, in letter units. */
const W = 4.6;
/** Letters are drawn in a box 100 units high; each stroke is a ski drawn from its tip end. */
const LETTERS: Record<string, { w: number; strokes: string[] }> = {
  L: { w: 52, strokes: ["M10 -4 L10 100", "M58 92 L4 92"] },
  Ø: { w: 70, strokes: ["M35 0 C-6 0 -6 100 35 100", "M35 100 C76 100 76 0 35 0", "M70 -6 L0 106"] },
  Y: { w: 64, strokes: ["M32 22 L32 104", "M2 -2 L32 52", "M62 -2 L32 52"] },
  P: { w: 56, strokes: ["M10 -4 L10 104", "M4 6 L30 6 C64 6 64 54 30 54 L10 54"] },
  E: { w: 52, strokes: ["M10 -4 L10 104", "M56 8 L4 8", "M48 50 L4 50", "M58 92 L4 92"] },
  T: { w: 60, strokes: ["M-2 8 L62 8", "M30 2 L30 106"] },
  C: { w: 58, strokes: ["M58 14 C42 -6 2 -6 2 50 C2 106 42 106 58 86"] },
  O: { w: 66, strokes: ["M33 0 C-6 0 -6 100 33 100", "M33 100 C72 100 72 0 33 0"] },
  N: { w: 62, strokes: ["M10 -4 L10 104", "M52 -4 L52 104", "M8 2 L54 98"] },
};
const GAP = 16;

interface SkiColours {
  body: string;
  edge: string;
  stripe: string;
}
const RED: SkiColours[] = [
  { body: "#d23a2f", edge: "#5b1712", stripe: "#ffffff" },
  { body: "#b82e25", edge: "#5b1712", stripe: "#ffd65a" },
];
const BLUE: SkiColours[] = [
  { body: "#1f5fd1", edge: "#0d2a5e", stripe: "#ffffff" },
  { body: "#174ba8", edge: "#0d2a5e", stripe: "#9fd0ff" },
];

function el(name: string, attrs: Record<string, string | number>, parent: Element): SVGElement {
  const e = document.createElementNS(NS, name) as SVGElement;
  for (const [k, v] of Object.entries(attrs)) {
    e.setAttribute(k, String(v));
  }
  parent.appendChild(e);
  return e;
}

/** A ski along a path: outline, body, stripe, a tip curling up off the snow at the start, and a binding in the middle. */
function ski(d: string, colours: SkiColours, parent: Element): SVGElement {
  const g = el("g", {}, parent);
  const probe = el("path", { d, fill: "none" }, g) as SVGPathElement;
  const len = probe.getTotalLength();
  const at = (s: number) => probe.getPointAtLength(Math.max(0, Math.min(len, s)));
  const p0 = at(0);
  const p1 = at(3);
  const n = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
  const [tx, ty] = [(p1.x - p0.x) / n, (p1.y - p0.y) / n];
  let [nx, ny] = [-ty, tx];
  if (ny > 0.01 || (Math.abs(ny) <= 0.01 && nx > 0)) {
    [nx, ny] = [-nx, -ny];
  }
  const bend = { x: p0.x - tx * 7, y: p0.y - ty * 7 };
  const end = { x: p0.x - tx * 11 + nx * 9, y: p0.y - ty * 11 + ny * 9 };
  const tip = `M${p1.x} ${p1.y} L${p0.x} ${p0.y} Q${bend.x} ${bend.y} ${end.x} ${end.y}`;
  const stroke = (path: string, colour: string, width: number, cap = "butt") =>
    el("path", { d: path, fill: "none", stroke: colour, "stroke-width": width, "stroke-linecap": cap, "stroke-linejoin": "round" }, g);
  stroke(tip, colours.edge, W * 1.3 + 3, "round");
  stroke(d, colours.edge, W * 2 + 3);
  stroke(tip, colours.body, W * 1.3, "round");
  stroke(d, colours.body, W * 2);
  el("path", { d, fill: "none", stroke: colours.stripe, "stroke-width": 1.8, "stroke-linecap": "round", "stroke-dasharray": `${len - 10} 999`, "stroke-dashoffset": -4 }, g);
  const m = at(len / 2);
  const m2 = at(len / 2 + 2);
  const b = el("g", { transform: `translate(${m.x} ${m.y}) rotate(${(Math.atan2(m2.y - m.y, m2.x - m.x) * 180) / Math.PI})` }, g);
  el("rect", { x: -7, y: -W - 1.5, width: 14, height: W * 2 + 3, rx: 2.5, fill: "#2b2f36" }, b);
  el("rect", { x: -7, y: -W + 1.5, width: 4, height: W * 2 - 3, rx: 1, fill: "#c4ccd4" }, b);
  probe.remove();
  return g;
}

interface Letter {
  g: SVGElement;
  x: number;
  y: number;
  scale: number;
  w: number;
  parts: SVGElement[];
  angle: number;
}

function word(text: string, x: number, y: number, size: number, skis: SkiColours[], parent: Element): Letter[] {
  const scale = size / 100;
  let cx = x;
  let i = 0;
  const g = el("g", { filter: "url(#start-shadow)" }, parent);
  return [...text].map((ch) => {
    const spec = LETTERS[ch];
    const lg = el("g", {}, g);
    const parts = spec.strokes.map((d) => ski(d, skis[i++ % skis.length], lg));
    const letter = { g: lg, x: cx, y, scale, w: spec.w, parts, angle: 0 };
    cx += (spec.w + GAP) * scale;
    return letter;
  });
}

const wordWidth = (text: string, size: number) => ([...text].reduce((a, c) => a + LETTERS[c].w + GAP, -GAP) * size) / 100;

/** A cross-country skier seen from the side, facing right, standing on the snow at the origin. */
function skier(parent: Element, jacket: string, hat: string, opts: { beard?: string; poles?: boolean } = {}) {
  const root = el("g", {}, parent);
  const body = el("g", {}, root);
  el("path", { d: "M-17 0 L15 0 Q21 0 22 -5", fill: "none", stroke: "#23323d", "stroke-width": 2.6, "stroke-linecap": "round" }, body);
  const legs = [0, 1].map(() => el("line", { x1: 0, y1: -16, x2: 0, y2: -1, stroke: "#2b3440", "stroke-width": 4, "stroke-linecap": "round" }, body));
  el("line", { x1: 0, y1: -16, x2: 4, y2: -30, stroke: jacket, "stroke-width": 9, "stroke-linecap": "round" }, body);
  const arm = el("line", { x1: 4, y1: -28, x2: 11, y2: -20, stroke: jacket, "stroke-width": 4, "stroke-linecap": "round" }, body);
  const pole = opts.poles === false ? null : el("line", { x1: 11, y1: -21, x2: -4, y2: 0, stroke: "#8a939e", "stroke-width": 1.6 }, body);
  el("circle", { cx: 6, cy: -37, r: 5.5, fill: "#f2c9a0" }, body);
  if (opts.beard) {
    el("path", { d: "M2 -36 Q3 -28 9 -29 Q12 -31 11 -36 Z", fill: opts.beard }, body);
  }
  el("path", { d: "M0.5 -38 Q1 -45 6 -45 Q11.5 -45 11.5 -38 Z", fill: hat }, body);
  el("circle", { cx: 6, cy: -46, r: 2.4, fill: "#ffffff" }, body);
  return {
    root,
    body,
    /** Legs and pole for a stride at `phase`; `lean` tips the skier forward, in degrees. */
    pose(phase: number, lean: number) {
      const swing = Math.sin(phase) * 7;
      legs[0].setAttribute("x2", String(swing));
      legs[1].setAttribute("x2", String(-swing));
      const reach = Math.cos(phase) * 6;
      arm.setAttribute("x2", String(11 + reach));
      pole?.setAttribute("x1", String(11 + reach));
      pole?.setAttribute("x2", String(-4 + reach * 1.5));
      body.setAttribute("transform", `rotate(${lean} 0 0)`);
    },
  };
}

/** A husky seen from the side, facing right, paws on the snow at the origin. */
function husky(parent: Element, coat: string) {
  const root = el("g", {}, parent);
  const legs = [-9, -6, 6, 9].map((x) => el("line", { x1: x, y1: -8, x2: x, y2: 0, stroke: coat, "stroke-width": 3, "stroke-linecap": "round" }, root));
  el("path", { d: "M-12 -12 Q-20 -22 -13 -24 Q-10 -18 -9 -13 Z", fill: coat, stroke: "#2b2f36", "stroke-width": 1 }, root);
  el("ellipse", { cx: 0, cy: -11, rx: 13, ry: 6, fill: coat, stroke: "#2b2f36", "stroke-width": 1 }, root);
  el("ellipse", { cx: 1, cy: -8.5, rx: 9, ry: 3, fill: "#eef1f4" }, root);
  el("circle", { cx: 13, cy: -17, r: 5.5, fill: coat, stroke: "#2b2f36", "stroke-width": 1 }, root);
  el("ellipse", { cx: 18, cy: -15.5, rx: 4, ry: 2.6, fill: "#eef1f4" }, root);
  el("circle", { cx: 21.5, cy: -16, r: 1.2, fill: "#1b1d22" }, root);
  el("path", { d: "M10 -21 L11 -27 L14 -22 Z M14 -22 L16 -27 L17 -21 Z", fill: coat, stroke: "#2b2f36", "stroke-width": 0.8 }, root);
  el("circle", { cx: 14.5, cy: -18, r: 1, fill: "#1b1d22" }, root);
  return {
    root,
    gallop(phase: number) {
      legs.forEach((l, i) => l.setAttribute("x2", String([-9, -6, 6, 9][i] + Math.sin(phase + (i < 2 ? 0 : Math.PI)) * 5)));
      root.setAttribute("transform", root.getAttribute("data-at") + ` translate(0 ${-Math.abs(Math.sin(phase)) * 3})`);
    },
  };
}

const smooth = (a: number, b: number, t: number) => {
  const k = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

/** Seconds into the animation that Gamle Gunnar's blade meets the T. */
const HIT = 1.5;
/** When the Ø tips off its row, and when it lands in front of the blade. */
const Ø_FALLS = HIT + 0.3;
const Ø_LANDS = Ø_FALLS + 0.6;
/** When Gunnar sets off again, pushing the Ø ahead of him. */
const PUSH_OFF = 3.4;
/** Gunnar comes back from the right with the Ø, stops below its gap, flicks it up and leaves to the left. */
const RETURN = 6;
const ARRIVE = 7.3;
const TOSS = 7.5;
const Ø_BACK = 8.1;
const LEAVE = 8.9;
/** How far the Ø ends up from upright, in degrees. */
const Ø_CROOKED = -10;
/** By now everything has stopped moving. */
export const START_SCREEN_SECONDS = 10.5;
const GROUND = 312;
/** The T's crossbar pops up, spins and comes down on the T again, askew: letter units, seconds and degrees. */
const FLY = { height: 150, time: 1.1, drift: 6, spin: 720 + 14 };
const T_LEAN = 8;
/** Skiers and dogs are drawn this much larger than their own units. */
const FIGURE = 1.5;

interface Runner {
  x: number;
  ground: number;
  dir: 1 | -1;
  speed: number;
  delay: number;
  hop: number;
  shout?: string;
  tumble?: boolean;
  jacket: string;
  hat: string;
}

/** Skiers who had for some reason been hiding behind the letters. */
function runners(upper: Letter[], lower: Letter[]): Runner[] {
  const behind = (l: Letter, k = 0.5) => l.x + l.w * l.scale * k;
  return [
    { x: behind(upper[0], 0.6), ground: 160, dir: -1, speed: 520, delay: 0.08, hop: 18, shout: "Aaah!", jacket: "#e8a417", hat: "#1f5fd1" },
    { x: behind(upper[3], 0.7), ground: 160, dir: 1, speed: 460, delay: 0.2, hop: 10, jacket: "#8a3fa0", hat: "#e8a417" },
    { x: behind(upper[4], 0.4), ground: 160, dir: 1, speed: 380, delay: 0.32, hop: 60, shout: "Han kjører rett på!", jacket: "#2f5fb0", hat: "#c8342b" },
    { x: behind(lower[2], 0.5), ground: 300, dir: -1, speed: 430, delay: 0.12, hop: 95, jacket: "#e8791a", hat: "#2f7d4a" },
    { x: behind(lower[3], 0.5), ground: 300, dir: 1, speed: 360, delay: 0.05, hop: 0, tumble: true, jacket: "#c8342b", hat: "#ffffff" },
    { x: behind(lower[4], 0.6), ground: 300, dir: 1, speed: 470, delay: 0.25, hop: 14, jacket: "#3fa0a0", hat: "#8a3fa0" },
  ];
}

/** Where a fleeing skier is `s` seconds after it set off, how high it is hopping, and its lean. */
function flee(r: Runner, s: number): { x: number; y: number; lean: number; phase: number } {
  if (s <= 0) {
    return { x: r.x, y: 0, lean: 0, phase: 0 };
  }
  if (r.tumble) {
    // Over on its nose, a moment flat in the snow, then up and away.
    if (s < 1.3) {
      const k = Math.min(1, s / 0.35);
      return { x: r.x + r.dir * 30 * k, y: 0, lean: r.dir * 95 * k, phase: s * 30 };
    }
    const u = s - 1.3;
    const up = Math.min(1, u / 0.25);
    return { x: r.x + r.dir * (30 + r.speed * Math.max(0, u - 0.2) * Math.max(0, u - 0.2) * 1.4), y: 0, lean: r.dir * 95 * (1 - up) + r.dir * 14 * up, phase: u * 22 };
  }
  const hopTime = 0.55;
  const y = s < hopTime ? -r.hop * 4 * (s / hopTime) * (1 - s / hopTime) : 0;
  return { x: r.x + r.dir * r.speed * s * Math.min(1, s / 0.4 + 0.3), y, lean: r.dir * 16, phase: s * 24 };
}

export class StartScreen {
  readonly root = document.createElement("div");
  private readonly status: HTMLElement;
  private readonly actions: HTMLElement;
  private readonly render: (t: number) => void;
  private readonly started = performance.now();
  private skipped = false;
  private done = false;

  constructor() {
    this.root.id = "start";
    this.root.innerHTML = `
      <div class="hills"></div>
      <svg class="logo" viewBox="0 0 1000 360" role="img" aria-label="Løype Tycoon">
        <defs><filter id="start-shadow" x="-10%" y="-10%" width="120%" height="130%">
          <feDropShadow dx="3" dy="5" stdDeviation="3" flood-color="#1c3f73" flood-opacity="0.35"/></filter></defs>
      </svg>
      <div class="below"><p class="status">Tråkker opp kartet…</p><div class="actions"></div></div>`;
    this.status = this.root.querySelector(".status")!;
    this.actions = this.root.querySelector(".actions")!;
    document.body.appendChild(this.root);
    this.render = this.build(this.root.querySelector("svg")!);
    this.root.addEventListener("pointerdown", (e) => {
      if (!(e.target as HTMLElement).closest("button")) {
        this.skipped = true;
      }
    });
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const frame = () => {
      if (this.done) {
        return;
      }
      const t = reduced || this.skipped ? START_SCREEN_SECONDS : (performance.now() - this.started) / 1000;
      this.render(Math.min(t, START_SCREEN_SECONDS));
      if (t < START_SCREEN_SECONDS) {
        requestAnimationFrame(frame);
      }
    };
    requestAnimationFrame(frame);
  }

  /** Draw the moment `t` seconds in; for screenshots. */
  seek(t: number) {
    this.done = true;
    this.render(t);
  }

  /** The game is ready: offer the ways in, each closing the start screen before it acts. */
  ready(choices: { label: string; primary?: boolean; act: () => void }[]) {
    this.status.textContent = "";
    for (const c of choices) {
      const b = document.createElement("button");
      b.textContent = c.label;
      b.classList.toggle("primary", !!c.primary);
      b.addEventListener("click", () => {
        this.close();
        c.act();
      });
      this.actions.appendChild(b);
    }
    this.actions.querySelector<HTMLButtonElement>(".primary")?.focus();
  }

  close() {
    this.done = true;
    this.root.classList.add("closing");
    setTimeout(() => this.root.remove(), 400);
  }

  private build(svg: SVGSVGElement): (t: number) => void {
    const scene = el("g", {}, svg);
    const upperSize = 130;
    const lowerSize = 95;
    const uw = wordWidth("LØYPE", upperSize);
    const lw = wordWidth("TYCOON", lowerSize);
    el("path", { d: `M${470 - uw / 2} 168 Q500 150 ${530 + uw / 2} 168 Q500 180 ${470 - uw / 2} 168Z`, fill: "#fff", opacity: 0.9 }, scene);
    el("path", { d: `M${440 - lw / 2} 300 Q500 284 ${600 + lw / 2} 300 Q500 314 ${440 - lw / 2} 300Z`, fill: "#fff", opacity: 0.9 }, scene);
    const hiding = el("g", {}, scene);
    const upper = word("LØYPE", 500 - uw / 2, 22, upperSize, RED, scene);
    const lower = word("TYCOON", 500 - lw / 2, 200, lowerSize, BLUE, scene);
    const front = el("g", { filter: "url(#start-shadow)" }, scene);

    const people = runners(upper, lower).map((r) => {
      const fig = skier(hiding, r.jacket, r.hat);
      const bubble = r.shout ? shout(scene, r.shout) : null;
      return { r, fig, bubble };
    });

    // The skijorer and his dogs, badly hidden behind the N.
    const N = lower[5];
    const team = el("g", {}, hiding);
    const owner = skier(team, "#2f7d4a", "#23323d", { beard: "#c0561e", poles: false });
    const dogs = ["#8e959f", "#5d636c"].map((coat) => husky(team, coat));
    const leash = el("path", { d: "", fill: "none", stroke: "#c8342b", "stroke-width": 1.6 }, team);
    const teamShout = shout(scene, "Manu! Nanook! Vent!");
    const teamStart = N.x + N.w * N.scale * 0.45;

    // Gamle Gunnar, facing right, drawn round the front of his blade at ground level.
    const cat = el("g", {}, scene);
    const catBody = el("g", {}, cat);
    el("rect", { x: -128, y: -20, width: 18, height: 14, rx: 3, fill: "#8a939e", stroke: "#2b2f36", "stroke-width": 2 }, catBody);
    el("rect", { x: -112, y: -24, width: 92, height: 24, rx: 12, fill: "#2b2f36" }, catBody);
    const wheelX = [-100, -78, -56, -34];
    const wheels = wheelX.map((wx) => {
      const wg = el("g", {}, catBody);
      el("circle", { r: 8, fill: "#6f7883" }, wg);
      el("rect", { x: -1.5, y: -7, width: 3, height: 14, fill: "#2b2f36" }, wg);
      return wg;
    });
    el("rect", { x: -108, y: -50, width: 82, height: 28, rx: 5, fill: "#c8342b", stroke: "#5b1712", "stroke-width": 2.5 }, catBody);
    el("rect", { x: -78, y: -82, width: 46, height: 34, rx: 5, fill: "#c8342b", stroke: "#5b1712", "stroke-width": 2.5 }, catBody);
    el("rect", { x: -60, y: -76, width: 22, height: 20, rx: 3, fill: "#bfe3ff", stroke: "#5b1712", "stroke-width": 2 }, catBody);
    el("circle", { cx: -66, cy: -66, r: 5, fill: "#f2c9a0" }, catBody);
    el("rect", { x: -72, y: -73, width: 12, height: 4, rx: 2, fill: "#1f5fd1" }, catBody);
    el("rect", { x: -60, y: -90, width: 10, height: 8, rx: 3, fill: "#ffb020", stroke: "#6b4705", "stroke-width": 1.5 }, catBody);
    el("rect", { x: -100, y: -64, width: 5, height: 16, fill: "#4a4f57" }, catBody);
    el("path", { d: "M-24 -46 Q-2 -40 0 -6 L-8 0 L-26 -10 Z", fill: "#e8a417", stroke: "#6b4705", "stroke-width": 2.5, "stroke-linejoin": "round" }, catBody);
    const puffs = [0, 1, 2].map(() => el("circle", { r: 6, fill: "#aab4bf", opacity: 0 }, cat));
    const catShout = shout(scene, "Oi sann!");
    const backShout = shout(scene, "Sånn ja!");

    const T = lower[0];
    const crossbar = T.parts[0];
    const Ø = upper[1];
    const contact = T.x + 8;
    const recoiled = contact - 26;
    const carriedWidth = Ø.w * Ø.scale;
    const stop = Ø.x + 4 + carriedWidth;
    const catX = (t: number) => {
      if (t < HIT) {
        return -60 + (contact + 60) * (t / HIT);
      }
      if (t < PUSH_OFF) {
        return contact - 26 * smooth(HIT, HIT + 0.35, t);
      }
      if (t < RETURN) {
        const u = t - PUSH_OFF;
        return recoiled + u * u * 160 + u * 40;
      }
      if (t < LEAVE) {
        return stop + (1300 - stop) * (1 - smooth(RETURN, ARRIVE, t));
      }
      const u = t - LEAVE;
      return stop - u * u * 220 - u * 40;
    };

    const springs = [
      ...upper.map((l, i) => ({ l, kick: 35 * (i % 2 ? -1 : 1), at: HIT + 0.12, target: 0, again: null as number | null })),
      ...lower.map((l, i) => ({ l, kick: i === 0 ? 150 : 170 / (1 + i * 0.7), at: HIT + i * 0.07, target: i === 0 ? T_LEAN : 0, again: i === 0 ? HIT + 0.03 + FLY.time : null })),
    ];
    /** Each letter rocks on a spring about the bottom of its stem; a push sets it swinging. */
    const swing = (t: number) => {
      const dt = 1 / 240;
      for (const a of springs) {
        let th = 0;
        let w = 0;
        let kicked = false;
        let landed = false;
        for (let s = 0; s < t; s += dt) {
          if (!kicked && s >= a.at) {
            w += a.kick;
            kicked = true;
          }
          if (a.again !== null && !landed && s >= a.again) {
            w -= 70;
            landed = true;
          }
          if (kicked) {
            w += (-140 * (th - a.target) - 5 * w) * dt;
            th += w * dt;
          }
        }
        a.l.angle = th;
      }
    };

    return (t: number) => {
      swing(t);
      for (const l of [...upper, ...lower]) {
        if (l !== Ø) {
          l.g.setAttribute("transform", `translate(${l.x} ${l.y}) scale(${l.scale}) rotate(${l.angle} ${l.w / 2} 100)`);
        }
      }
      const x = catX(t);

      // The Ø tips off its row and lands leaning on Gunnar's blade, to be pushed away like snow, and then comes back.
      const size = Ø.scale;
      const place = (fx: number, fy: number, angle: number, pivot = Ø.w / 2) =>
        Ø.g.setAttribute("transform", `translate(${fx} ${fy}) scale(${size}) rotate(${angle} ${pivot} 100)`);
      const carried = { x: x - 4 - carriedWidth, y: GROUND - 100 * size, angle: 10 };
      if (t < Ø_FALLS) {
        place(Ø.x, Ø.y, Ø.angle);
      } else {
        if (Ø.g.parentNode !== front) {
          front.appendChild(Ø.g);
        }
        if (t < RETURN) {
          const k = Math.min(1, (t - Ø_FALLS) / (Ø_LANDS - Ø_FALLS));
          const rest = { x: x + 4, y: GROUND - 100 * size };
          const fx = Ø.x + (rest.x - Ø.x) * k;
          const fy = Ø.y + (rest.y - Ø.y) * k * k - 40 * Math.sin(Math.PI * k) * (1 - k);
          place(fx, fy, Ø.angle + (-12 - Ø.angle) * k + Math.sin(Math.PI * k) * -50, 0);
        } else if (t < TOSS) {
          place(carried.x, carried.y, carried.angle);
        } else if (t < Ø_BACK) {
          const k = (t - TOSS) / (Ø_BACK - TOSS);
          const from = { x: stop - 4 - carriedWidth, y: carried.y };
          place(from.x + (Ø.x + 3 - from.x) * k, from.y + (Ø.y - from.y) * k - 120 * Math.sin(Math.PI * k), carried.angle + (360 + Ø_CROOKED - carried.angle) * k);
        } else {
          const u = t - Ø_BACK;
          place(Ø.x + 3, Ø.y, Ø_CROOKED + 8 * Math.exp(-5 * u) * Math.sin(18 * u));
        }
      }

      const ft = Math.max(0, t - HIT - 0.03);
      if (ft > 0) {
        const k = Math.min(1, ft / FLY.time);
        crossbar.setAttribute("transform", `translate(${FLY.drift * k} ${-FLY.height * 4 * k * (1 - k)}) rotate(${FLY.spin * k} 30 8)`);
      } else {
        crossbar.removeAttribute("transform");
      }

      const rear = t > HIT ? Math.sin(Math.min(1, (t - HIT) / 0.5) * Math.PI) * -6 : 0;
      const moving = t < HIT || (t > PUSH_OFF && t < ARRIVE) || t > LEAVE;
      const bounce = moving ? Math.abs(Math.sin(t * 18)) * 1.2 : 0;
      const facing = t < RETURN ? 1 : -1;
      const flick = t > TOSS && t < Ø_BACK ? Math.sin(((t - TOSS) / (Ø_BACK - TOSS)) * Math.PI) * -5 : 0;
      cat.setAttribute("transform", `translate(${x} ${GROUND - bounce}) scale(${facing} 1)`);
      catBody.setAttribute("transform", `rotate(${rear + flick} -110 0)`);
      wheels.forEach((w, i) => w.setAttribute("transform", `translate(${wheelX[i]} -12) rotate(${x * 2.2})`));
      puffs.forEach((p, i) => {
        const age = (t * 1.6 + i / 3) % 1;
        p.setAttribute("cx", String(-97 - age * 30));
        p.setAttribute("cy", String(-66 - age * 30));
        p.setAttribute("r", String(4 + age * 9));
        p.setAttribute("opacity", String((1 - age) * 0.7));
      });
      catShout.setAttribute("transform", `translate(${x - 20} ${GROUND - 104})`);
      catShout.setAttribute("opacity", String(smooth(HIT + 0.2, HIT + 0.35, t) * (1 - smooth(3.1, 3.3, t))));
      backShout.setAttribute("transform", `translate(${x + 20} ${GROUND - 104})`);
      backShout.setAttribute("opacity", String(smooth(Ø_BACK + 0.05, Ø_BACK + 0.2, t) * (1 - smooth(LEAVE + 0.4, LEAVE + 0.6, t))));

      for (const { r, fig, bubble } of people) {
        const s = t - HIT - r.delay;
        const p = flee(r, s);
        const peek = s <= 0 ? Math.sin(t * 2 + r.x) * 1.5 : 0;
        fig.root.setAttribute("transform", `translate(${p.x} ${r.ground + p.y + peek}) scale(${r.dir * FIGURE} ${FIGURE})`);
        fig.pose(p.phase, p.lean * r.dir);
        if (s > 0 && fig.root.parentNode !== front) {
          front.appendChild(fig.root);
        }
        if (bubble) {
          bubble.setAttribute("transform", `translate(${p.x} ${r.ground - 80})`);
          bubble.setAttribute("opacity", String(smooth(0.05, 0.15, s) * (1 - smooth(1.2, 1.4, s))));
        }
      }

      // The dogs bolt first and the skijorer goes with them, whether he likes it or not.
      const s = t - HIT - 0.15;
      const run = s > 0 ? s * s * 260 + s * 120 : 0;
      const ox = teamStart + run;
      const lean = s > 0 ? -18 + Math.min(1, s / 0.6) * 34 : 0;
      owner.root.setAttribute("transform", `translate(${ox} 300) scale(${FIGURE})`);
      owner.pose(s > 0 ? s * 10 : 0, lean);
      dogs.forEach((d, i) => {
        const dx = ox + (46 + i * 30 + (s > 0 ? Math.min(14, s * 40) : 0)) * FIGURE;
        d.root.setAttribute("data-at", `translate(${dx} 300) scale(${FIGURE})`);
        d.gallop(s > 0 ? s * 26 + i : Math.sin(t * 4 + i) * 0.4);
      });
      leash.setAttribute("d", `M${ox + 10 * FIGURE} ${300 - 18 * FIGURE} Q${ox + 30 * FIGURE} ${300 - (s > 0 ? 14 : 4) * FIGURE} ${ox + 36 * FIGURE} ${300 - 11 * FIGURE}`);
      if (s > 0 && team.parentNode !== front) {
        front.appendChild(team);
      }
      teamShout.setAttribute("transform", `translate(${ox + 40} 216)`);
      teamShout.setAttribute("opacity", String(smooth(0.1, 0.2, s) * (1 - smooth(1.4, 1.6, s))));

      const shake = t > HIT && t < HIT + 0.4 ? (1 - (t - HIT) / 0.4) * 5 : 0;
      scene.setAttribute("transform", `translate(${Math.sin(t * 90) * shake} ${Math.cos(t * 70) * shake})`);
    };
  }
}

/** A speech bubble with its tail pointing down at the origin, hidden until shown. */
function shout(parent: Element, text: string, x = 0, y = 0): SVGElement {
  const g = el("g", { opacity: 0 }, parent);
  const inner = el("g", { transform: `translate(${x} ${y})` }, g);
  const w = text.length * 11 + 26;
  el("path", { d: `M${-w / 2} -46 h${w} a9 9 0 0 1 9 9 v20 a9 9 0 0 1 -9 9 h${-w / 2 + 6} l-12 14 l1 -14 h${-w / 2 + 5} a9 9 0 0 1 -9 -9 v-20 a9 9 0 0 1 9 -9z`, fill: "#fff", stroke: "#23323d", "stroke-width": 2.5 }, inner);
  const label = el("text", { x: 4.5, y: -21, "text-anchor": "middle", "font-size": 19, "font-weight": 800, fill: "#23323d", "font-family": "system-ui, sans-serif" }, inner);
  label.textContent = text;
  return g;
}
