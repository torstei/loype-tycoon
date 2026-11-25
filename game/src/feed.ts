import { dayLabel } from "./clock";

/** The local group where skiers and the snowcat driver post about the tracks. */
export const GROUP_NAME = "Preppestatus Hakadal og omegn";

export type PostKind = "groomed" | "perfect" | "icy" | "snowed" | "moose" | "julehus" | "waffles" | "chairlift" | "ploughed" | "offtopic";

export interface Comment {
  author: string;
  text: string;
}

export interface Post {
  day: number;
  hour: number;
  kind: PostKind;
  author: string;
  /** The snowcat driver posts as the club; everyone else as themselves. */
  driver: boolean;
  text: string;
  photo: string | null;
  likes: number;
  comments: Comment[];
  tone: -1 | 0 | 1;
}

/** What the post can mention: where it is, the weather and the numbers behind it. */
export interface PostContext {
  day: number;
  hour: number;
  place: string;
  temperature: number;
  reputation: number;
  /** The snowcat driver's name, for the driver's posts and replies. */
  driver: string;
  km?: number;
  waffles?: number;
  /** A road the post is about. */
  road?: string;
}

const FIRST = ["Kristin", "Ole Martin", "Hilde", "Thomas", "Anne Grethe", "Jørn", "Siri", "Espen", "Marit", "Lars Erik", "Tonje", "Rune", "Ida", "Bente", "Øyvind", "Camilla", "Petter", "Gro"];
const LAST = ["Johansen", "Berg", "Haugland", "Solberg", "Kristiansen", "Lie", "Dahl", "Strand", "Holm", "Aas", "Myhre", "Engen", "Bakken", "Sandvik"];

function rand(seed: number): number {
  const s = Math.sin(seed * 91.37 + 17.3) * 43758.5453;
  return s - Math.floor(s);
}
const pick = <T>(xs: T[], seed: number): T => xs[Math.floor(rand(seed) * xs.length)];
const name = (seed: number) => `${pick(FIRST, seed)} ${pick(LAST, seed + 7)}`;
const temp = (t: number) => `${Math.round(t)}`.replace("-", "−");

type Writer = (c: PostContext) => string;

const TEXTS: Record<PostKind, Writer[]> = {
  groomed: [
    (c) => `Ute nå. ${c.place} er kjørt, ${temp(c.temperature)} grader og stjerneklart ✨ God tur i morgen!`,
    (c) => `Nypreppet rundt ${c.place} i natt. Kjør forsiktig over veien, det er glatt der 🚜`,
    (c) => `${c.km ? `${c.km.toFixed(1).replace(".", ",")} km kjørt så langt i natt. ` : ""}Sporet setter seg fint i kulda. Vi sees i løypa!`,
    (c) => `Status ${dayLabel(c.day)}: ${c.place} kjørt. Takk til alle som tar med søpla si hjem igjen 💚`,
  ],
  perfect: [
    (c) => `Helt rått i dag! ${temp(c.temperature)} grader, sol og nypreppa ved ${c.place} ☀️❄️`,
    () => "Bedre blir det ikke. Takk til løypekjøreren! 🙌",
    (c) => `Blå swix og knallføre ved ${c.place}. Hjemmekontoret må vente 😅`,
    () => "Ungene gikk hele runden uten å klage. Det har aldri skjedd før.",
  ],
  icy: [
    (c) => `Speilblankt ved ${c.place}. Brodder anbefales, ski frarådes 🧊`,
    () => "Er det skiløype eller skøytebane? Spør for en venn.",
    (c) => `Falt tre ganger i bakken ned mot ${c.place}. Rumpa er blå, humøret også.`,
  ],
  snowed: [
    (c) => `Når kjøres det ved ${c.place}?? Det har snødd i to dager nå 🙄`,
    () => "Gikk i 30 cm nysnø i dag. Fin trening, men jeg ville egentlig gå på ski.",
    (c) => `Noen som vet om løypemaskina kommer til ${c.place} i dag?`,
  ],
  moose: [
    (c) => `Fikk følge av en elg ved ${c.place} i dag 🫎 Han gikk i klassisksporet, selvsagt.`,
    () => "Elgen har funnet ut at sporet er den beste stien i skogen. Hold avstand!",
    (c) => `Elg i løypa ved ${c.place}! Han så ikke ut til å bry seg om oss.`,
  ],
  julehus: [
    () => "Kjørte en omvei hjem for å se julehuset i Hadelandsveien. Ungene var helt stille i fem minutter 🎄✨",
    () => "Julehuset i Hadelandsveien er tent! Det må være Norges største strømregning 😄🎄",
  ],
  waffles: [
    (c) => `Kø ved vaffelbua ved ${c.place}! ${c.waffles ? `${c.waffles} vafler solgt i dag, sa de.` : ""} Verdt hvert minutt 🧇`,
    () => "Det beste med skiturer er vaflene. Det nest beste er å gå på ski.",
  ],
  chairlift: [
    () => "Tok stolheisen opp og gikk innover på toppen. Snøen der oppe er fantastisk! 🚡",
    () => "Stolheis til langrenn. Jeg føler meg litt lat, men mest fornøyd.",
  ],
  ploughed: [
    (c) => `Gikk innover ${c.road} med ungene og akebrettet i dag. På vei tilbake var hele veien BRØYTET. Ned til grusen! Hvem bestemmer sånt?? 😡`,
    (c) => `Hvorfor i all verden brøyter noen ${c.road}? Den er jo perfekt å gå på ski på. Vi kjørte helt fra Bærum for dette.`,
    (c) => `Til deg som brøytet ${c.road} i dag: Vi hadde to unger og en pulk der inne. Takk for ingenting.`,
    (c) => `Nydelig føre innover ${c.road}, men på vei hjem gikk vi på grus. Noen i Oslo kommune bør få beskjed om dette.`,
  ],
  offtopic: [
    () => "Noen som har funnet en blå vott ved parkeringen? Strikket av svigermor, så den MÅ finnes.",
    () => "Har noen sett en grå katt på Ekra? Han heter Tiger og lyder ikke navnet.",
    () => "Selges: Swix-voks, lite brukt. Hentes i Hakadal.",
    () => "Til deg som tok den siste kanelbollen på 7-Eleven i Hakadal i dag: Du hadde skisko på. Jeg så deg.",
    () => "Skøytesporet eller klassisksporet for en nybegynner? Ikke kast stein.",
  ],
};

const COMMENTS: Record<PostKind, Writer[]> = {
  groomed: [() => "Tusen takk! ❤️", () => "Dere er gull!", () => "Hva med Kirkebylia?", () => "Når kommer dere til Skansen?", () => "Takk for innsatsen 👏", () => "Har Vippset 200 kr!"],
  perfect: [() => "Misunnelig! 😍", () => "Var der i går, helt nydelig", () => "Hvilken smøring?", () => "Drar etter jobb!", () => "Klassisk eller skøyting?"],
  icy: [() => "Samme her. Jeg ga opp.", () => "Er det kjørt noe i dag?", () => "Takk for advarselen!", () => "Det var bedre før."],
  snowed: [(c) => `Den kommer i natt, sier ${c.driver}`, () => "Samme ved oss.", () => "Gå på truger, da 😄", () => "Tålmodighet!", () => "Det var bedre før."],
  moose: [() => "Wow! 😮", () => "Han var der i går også", () => "Husk å holde avstand!", () => "Heldiggris!"],
  julehus: [() => "Vi var der i går! Helt magisk ✨", () => "Han har visst flere lys i år", () => "Beste julestemningen i bygda 🎄"],
  waffles: [() => "Beste vaflene i Nittedal", () => "Med brunost eller syltetøy?", () => "Rømme og syltetøy, selvsagt"],
  chairlift: [() => "Endelig!", () => "Må prøves!", () => "Hvor mye koster det?"],
  ploughed: [
    () => "Det er en skogsbilvei. Den er der for tømmerbilene.",
    () => "Folk bor faktisk innover der, de må komme seg hjem de også 🙂",
    () => "La meg gjette: Ullern?",
    () => "Brøytekartet ligger ute på nett, altså.",
    () => "Tømmerbilen bryr seg lite om akebrett.",
    () => "Løypelaget har fine spor rett ved siden av!",
  ],
  offtopic: [() => "Feil gruppe 😅", () => "Har du sjekket under bilen?", () => "Delt!", () => "Håper det ordner seg"],
};

const LIKES: Record<PostKind, [number, number]> = {
  groomed: [40, 120],
  perfect: [25, 80],
  icy: [8, 30],
  snowed: [10, 35],
  moose: [70, 180],
  julehus: [90, 240],
  waffles: [20, 60],
  chairlift: [30, 90],
  ploughed: [20, 70],
  offtopic: [1, 8],
};

const TONE: Record<PostKind, -1 | 0 | 1> = {
  groomed: 1,
  perfect: 1,
  icy: -1,
  snowed: -1,
  moose: 0,
  julehus: 0,
  waffles: 1,
  chairlift: 1,
  ploughed: 0,
  offtopic: 0,
};

export function writePost(kind: PostKind, c: PostContext, photo: string | null, seed: number): Post {
  const driver = kind === "groomed";
  const author = driver ? `${c.driver} · løypelaget` : name(seed);
  const [lo, hi] = LIKES[kind];
  const mood = TONE[kind] < 0 ? 1.2 - c.reputation * 0.5 : 0.5 + c.reputation;
  const likes = Math.round((lo + rand(seed + 3) * (hi - lo)) * mood);
  const pool = COMMENTS[kind];
  const count = 1 + Math.floor(rand(seed + 5) * 3);
  const comments: Comment[] = [];
  for (let i = 0; i < count; i++) {
    const text = pick(pool, seed + 11 + i * 13)(c);
    if (!comments.some((x) => x.text === text)) {
      comments.push({ author: name(seed + 29 + i * 17), text });
    }
  }
  return { day: c.day, hour: c.hour, kind, author, driver, text: pick(TEXTS[kind], seed + 1)(c), photo, likes, comments, tone: TONE[kind] };
}

const escape = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const initials = (n: string) => n.split(/\s+/).filter((w) => /^\p{L}/u.test(w)).slice(0, 2).map((w) => w[0]).join("");

export function feedHtml(posts: Post[]): string {
  if (!posts.length) {
    return `<p class="empty">Ingen innlegg ennå. Gi folk noe å skrive om!</p>`;
  }
  return posts
    .slice()
    .reverse()
    .map((p) => `
      <article class="post${p.driver ? " driver" : ""}">
        <header><span class="avatar">${p.driver ? "🚜" : initials(p.author)}</span>
          <div><strong>${escape(p.author)}</strong><small>${dayLabel(p.day)} kl. ${String(Math.floor(p.hour)).padStart(2, "0")}</small></div></header>
        <p>${escape(p.text)}</p>
        ${p.photo ? `<img src="${p.photo}" alt="">` : ""}
        <div class="likes">👍❤️ ${p.likes} · ${p.comments.length} ${p.comments.length === 1 ? "kommentar" : "kommentarer"}</div>
        ${p.comments.map((c) => `<div class="comment"><strong>${escape(c.author)}</strong> ${escape(c.text)}</div>`).join("")}
      </article>`)
    .join("");
}
