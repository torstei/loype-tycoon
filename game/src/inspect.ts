import { personName } from "./feed";
import { SkierProfile } from "./skiers";

/** Something on the map the player can click on: a card about it, and a camera. */
export type Inspected =
  | { kind: "skier"; profile: SkierProfile }
  | { kind: "snowcat"; name: string; status: string; tonightKm: number; totalKm: number }
  | { kind: "train"; seed: number };

function rand(seed: number): number {
  const s = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** A few distinct picks from a list, the same ones every time for a seed. */
function some<T>(xs: T[], n: number, seed: number): T[] {
  return xs
    .map((x, i) => ({ x, r: rand(seed + i * 7.1) }))
    .sort((a, b) => a.r - b.r)
    .slice(0, n)
    .map((p) => p.x);
}

const escape = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const km = (tiles: number) => `${((tiles * 25) / 1000).toFixed(1).replace(".", ",")} km`;

const FACTS: Record<string, string[]> = {
  søndagsfamilie: [
    "Har kvikklunsj og appelsiner i sekken",
    "Lovte ungene vafler etter første bakke",
    "Har ikke smurt skiene siden 2019",
    "Hunden heter Bamse og elsker sporet mer enn eierne",
    "Pappa bærer akebrettet, og har gjort det i to timer",
    "Minstemann har spurt «er vi framme snart?» elleve ganger",
    "Har med termos med kakao og to typer boller",
    "Ungene vil heller bygge snølykt",
  ],
  mosjonist: [
    "Logger alt på Strava",
    "Har gått Birken elleve ganger, og nevner det",
    "Smurte med blå swix i dag",
    "Trener til Grenaderløpet",
    "Har solbærtoddy på termosen",
    "Har sterke meninger om klister",
    "Går samme runde hver tirsdag og torsdag siden 1998",
    "Hilser på alle i sporet",
  ],
  lycraløper: [
    "Ski til 14 000 kr, og en reserve i bilen",
    "Pulsklokke, pulsbelte og pulsring",
    "Har aldri stoppet for en vaffel",
    "Kjører intervaller: 4 × 8 minutter",
    "Kom på rulleski i oktober, og i august",
    "Kaller det «å ta en økt», aldri «å gå en tur»",
    "Har glider til 900 kr for hektoen",
    "Ser skrått på folk med sekk",
  ],
};

const AGES: Record<string, [number, number]> = {
  søndagsfamilie: [33, 48],
  mosjonist: [42, 74],
  lycraløper: [22, 55],
};

function moodWords(mood: number | null): string {
  if (mood === null) {
    return "Akkurat kommet i sporet";
  }
  return mood > 0.8 ? "Strålende fornøyd 😄" : mood > 0.6 ? "Fornøyd 🙂" : mood > 0.4 ? "Litt sur 😐" : "Sur 😠";
}

const SNOWCAT_FACTS = [
  "P1 på radioen, alltid",
  "Termosen er halvfull, og det er bare kaffe i den",
  "En vimpel fra Holmenkollen 1982 henger i førerhytta",
  "Har en gul post-it med «HUSK DIESEL» på dashbordet",
  "Hilser til elgen med lyset",
  "Setet er tapet med gaffatape",
  "Kjenner hver eneste stubbe i løypa ved navn",
];

const TRAIN_FACTS = [
  "Fire par ski i bagasjehyllene, og en pulk",
  "Konduktøren sier «neste stasjon» med ekstra innlevelse",
  "Noen sover allerede, enda det er tre stasjoner igjen",
  "Wi-fi-en virker til Grorud",
  "En gjeng med lycraløpere diskuterer smøring i bakerste vogn",
];

/** The card shown when the player clicks something; buttons carry data-inspect actions. */
export function inspectHtml(what: Inspected): string {
  const camera = (label: string) => `<button data-inspect="photo">📷 ${label}</button>`;
  if (what.kind === "skier") {
    const p = what.profile;
    const [lo, hi] = AGES[p.kind] ?? [30, 60];
    const age = lo + Math.floor(rand(p.seed) * (hi - lo));
    const facts = some(FACTS[p.kind] ?? [], 2, p.seed);
    return `
      <div class="head"><strong>⛷ ${escape(personName(p.seed))} (${age})</strong><button data-inspect="close" aria-label="Lukk">✕</button></div>
      <p class="kind">${p.kind[0].toUpperCase() + p.kind.slice(1)} fra ${escape(p.from)}</p>
      <ul>
        <li>Har gått ${km(p.travelled)} av planlagte ${km(p.goal)}${p.cabin ? ", med stopp på hytta" : ""}</li>
        <li>${moodWords(p.mood)}</li>
        ${facts.map((f) => `<li>${f}</li>`).join("")}
      </ul>
      <p class="actions">${camera("Ta bilde")}</p>`;
  }
  if (what.kind === "snowcat") {
    const seed = [...what.name].reduce((s, c) => s + c.charCodeAt(0), 0);
    return `
      <div class="head"><strong>🚜 ${escape(what.name)}</strong><button data-inspect="close" aria-label="Lukk">✕</button></div>
      <p class="kind">${escape(what.status)}</p>
      <ul>
        <li>Kjørt i natt: ${what.tonightKm.toFixed(1).replace(".", ",")} km</li>
        <li>Kjørt i vinter: ${what.totalKm.toFixed(0)} km</li>
        ${some(SNOWCAT_FACTS, 2, seed).map((f) => `<li>${f}</li>`).join("")}
      </ul>
      <p class="actions">${camera("Ta bilde")}<button data-inspect="live">📹 Direkte fra førerhytta</button><button data-inspect="take-wheel">🕹 Kjør selv</button></p>`;
  }
  const late = Math.floor(rand(what.seed) * 14);
  return `
    <div class="head"><strong>🚆 Gjøvikbanen</strong><button data-inspect="close" aria-label="Lukk">✕</button></div>
    <p class="kind">Regiontog mot ${rand(what.seed + 1) < 0.5 ? "Gjøvik" : "Oslo S"}</p>
    <ul>
      <li>${late < 3 ? "I rute, mot alle odds" : `${late} minutter forsinket (${late > 9 ? "signalfeil" : "sporveksel"})`}</li>
      <li>${20 + Math.floor(rand(what.seed + 2) * 60)} passasjerer</li>
      ${some(TRAIN_FACTS, 2, what.seed).map((f) => `<li>${f}</li>`).join("")}
    </ul>
    <p class="actions">${camera("Ta bilde")}<button data-inspect="live">📹 Direkte fra førerhuset</button></p>`;
}

const PHOTO_MODES: Record<Inspected["kind"], [string, (label: string) => string][]> = {
  skier: [["of", (l) => `Bilde av ${l}`], ["from", () => "Utsikt herfra"]],
  snowcat: [["of", (l) => `Bilde av ${l}`], ["front", () => "Frontruta"], ["left", () => "Venstre"], ["right", () => "Høyre"]],
  train: [["of", (l) => `Bilde av ${l}`], ["front", () => "Frontruta"], ["left", () => "Venstre"], ["right", () => "Høyre"]],
};

/** The photo panel: preview, what to shoot from where, the lens, and the shutter. Live is the snowcat's cab view while the game runs. */
/** How fast the game runs during the live view: game hours per real hour, null for the game's own speed. */
export const LIVE_PACES: Record<"snowcat" | "train", [number | null, string][]> = {
  snowcat: [[1, "Sanntid"], [10, "10× sanntid"], [null, "Spillfart"]],
  train: [[1, "Sanntid"], [3, "3× sanntid"], [null, "Spillfart"]],
};

export function cameraHtml(o: { kind: Inspected["kind"]; label: string; mode: string; zoom: number; manual: boolean; live?: { follow: boolean; pace: number | null; driving?: { go: boolean; turn: -1 | 0 | 1 } | null } }): string {
  const choices = PHOTO_MODES[o.kind].filter(([id]) => !o.live || id !== "of");
  const modes = choices.map(([id, text]) => `<button data-inspect="${id}" class="${id === o.mode ? "on" : ""}">${text(o.label)}</button>`).join("");
  const driving = o.live?.driving;
  const how = driving
    ? "Du kjører: ↑ kjører, ↓ stopper (og snur når du står), ← → velger vei i neste kryss. Maskina følger løypa og prepper det som trenger det."
    : o.live
    ? "Spillet går videre mens du ser på."
    : o.mode === "of"
      ? `Klikk eller dra på kartet der du vil stå, så ser du mot ${o.label}.`
      : o.mode === "from"
        ? "Klikk eller dra på kartet dit du vil se."
        : `Fra førersetet${o.kind === "train" ? " i toget" : ""}.`;
  return `
    <div class="head"><strong>${o.live ? `📹 Direkte fra ${o.kind === "train" ? "førerhuset" : "førerhytta"}` : "📷 Ta bilde"}</strong><button data-inspect="cancel" aria-label="Lukk">✕</button></div>
    <p class="modes">${modes}${o.live ? `<button data-inspect="follow" class="${o.live.follow ? "on" : ""}">Følg på kartet</button>` : ""}${o.live && o.kind === "snowcat" ? `<button data-inspect="wheel" class="${driving ? "on" : ""}">🕹 Kjør selv</button>` : ""}</p>
    <canvas class="preview" width="480" height="300"></canvas>
    ${driving ? `<p class="modes drive">
      <button data-inspect="drive-left" class="${driving.turn === -1 ? "on" : ""}">⬅ Venstre</button>
      <button data-inspect="drive-go" class="${driving.go ? "" : "primary"}">${driving.go ? "⏸ Stopp" : "⬆ Kjør"}</button>
      <button data-inspect="drive-right" class="${driving.turn === 1 ? "on" : ""}">Høyre ➡</button>
      <button data-inspect="drive-back">↩ Snu</button></p>` : ""}
    ${o.live ? `<p class="live-status"></p><p class="modes pace">${LIVE_PACES[o.kind === "train" ? "train" : "snowcat"].map(([pace, text], i) => `<button data-inspect="pace-${i}" class="${pace === o.live!.pace ? "on" : ""}">${text}</button>`).join("")}</p>` : ""}
    <p class="lens">
      <button data-inspect="zoom-out" aria-label="Zoom ut">−</button><span class="zoom">${zoomLabel(o.zoom)}</span><button data-inspect="zoom-in" aria-label="Zoom inn">+</button>
      <button data-inspect="tilt-up" aria-label="Se opp">⬆</button><button data-inspect="tilt-down" aria-label="Se ned">⬇</button>
      <button data-inspect="auto" class="${o.manual ? "" : "on"}">Auto</button>
    </p>
    <p class="hint">${how} Dra i bildet for å snu og vippe, rull for å zoome.${driving ? " + − zoomer" : " Piltaster og + − gjør det samme"}, Enter knipser.</p>
    <p class="actions"><button data-inspect="shoot" class="primary">📸 Knips</button><button data-inspect="cancel">${o.live ? "Lukk" : "Avbryt"}</button></p>`;
}

export const zoomLabel = (zoom: number) => `${zoom.toFixed(1).replace(".", ",")}×`;

/** The finished picture, with what can be done with it. */
export function snapHtml(photo: string, shared: boolean): string {
  return `
    <div class="head"><strong>📸 Bildet ditt</strong><button data-inspect="close" aria-label="Lukk">✕</button></div>
    <img class="snap" src="${photo}" alt="">
    <p class="actions">
      <button data-inspect="share" ${shared ? "disabled" : ""}>${shared ? "✓ Delt i gruppa" : "📱 Del i gruppa"}</button>
      <button data-inspect="download">💾 Last ned</button>
      <button data-inspect="again">Ta et nytt</button>
    </p>`;
}
