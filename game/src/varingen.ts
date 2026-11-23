import { dayLabel } from "./clock";
import { Weather } from "./weather";

/** What the paper remembers about one day, logged when the day ends. */
export interface DayNews {
  day: number;
  skiers: number;
  /** Average satisfaction of those who finished a trip, or null if nobody did. */
  happy: number | null;
  donations: number;
  members: number;
  diesel: number;
  /** The day's føremelding was the embellished one. */
  hyped: boolean;
  /** Roads a snowcat held up traffic on. */
  roads: string[];
  trampled: number;
  groomed: number;
  snow: number;
  rain: number;
  tiles: number;
  icy: number;
  bare: number;
}

export type Tone = -1 | 0 | 1;

export interface Edition {
  day: number;
  number: number;
  headline: string;
  tone: Tone;
  html: string;
}

export interface EditionInput {
  day: number;
  number: number;
  week: DayNews[];
  km: number;
  kmAtLastEdition: number;
  budget: number;
  /** The most skiers in any earlier week, for "record" stories. */
  bestWeek: number;
  /** Where most of the track is, for datelines. */
  place: string;
  weather: Weather;
  lowest: number;
}

/** Varingen comes out on Thursdays. */
export const PUBLISH_WEEKDAY = "tor";
export const PUBLISH_HOUR = 8;

interface Story {
  score: number;
  tone: Tone;
  kicker: string;
  headline: string;
  lead: string;
  body: string[];
}

const REPORTERS = ["Synnøve Lien", "Knut Arild Ramstad", "Marte Bråthen", "Øystein Kolstad", "Ingrid Hovland"];
const SOUTH = ["Rotnes", "Hagan", "Slattum", "Nittedal sentrum", "Sørbygda"];
const NORTH = ["Hakadals verk", "Ekra", "Skansen", "Sagstua", "Mork"];
const FIRST = ["Per-Kristian", "Hege", "Arvid", "Tone", "Geir Ove", "Line", "Bjørnar", "Randi", "Stian", "Wenche", "Odd-Erling", "Kjersti"];
const LAST = ["Hagen", "Brattli", "Moen", "Sætre", "Fjeld", "Lund", "Nygård", "Haugen", "Bakke", "Ødegård"];

function rand(seed: number): number {
  const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function pick<T>(xs: T[], seed: number): T {
  return xs[Math.floor(rand(seed) * xs.length)];
}

function person(seed: number, from: string[]): string {
  return `${pick(FIRST, seed)} ${pick(LAST, seed + 1)} (${28 + Math.floor(rand(seed + 2) * 50)}) fra ${pick(from, seed + 3)}`;
}

const sum = (week: DayNews[], f: (d: DayNews) => number) => week.reduce((s, d) => s + f(d), 0);

function stories(input: EditionInput): Story[] {
  const { week, day, place } = input;
  const seed = day * 13;
  const out: Story[] = [];
  const skiers = sum(week, (d) => d.skiers);
  const snow = sum(week, (d) => d.snow);
  const rain = sum(week, (d) => d.rain);
  const roads = week.flatMap((d) => d.roads);
  const tiles = week.at(-1)?.tiles ?? 0;
  const groomed = sum(week, (d) => d.groomed);
  const trampled = sum(week, (d) => d.trampled);
  const members = sum(week, (d) => d.members);
  const rated = week.filter((d) => d.happy !== null);
  const happy = rated.length ? sum(rated, (d) => d.happy! * d.skiers) / Math.max(1, sum(rated, (d) => d.skiers)) : null;
  const lied = week.filter((d) => d.hyped && d.happy !== null && d.happy < 0.6);
  const last = week.at(-1);
  const newKm = input.km - input.kmAtLastEdition;

  if (input.km === 0) {
    out.push({
      score: 3,
      tone: -1,
      kicker: "Vinter i Hakadal",
      headline: "Nytt løypelag – men hvor er sporet?",
      lead: "Løypelaget har fått seg garasje og løypemaskin. Det som mangler, er løyper.",
      body: [
        `– Jeg har gått frem og tilbake ved garasjen i en time. Jeg fant ingen spor, sier ${person(seed, NORTH)}.`,
        "Løypelaget opplyser at arbeidet er «i en tidlig fase».",
      ],
    });
  }

  if (roads.length > 0) {
    const road = mostCommon(roads);
    out.push({
      score: 6 + 2 * roads.length,
      tone: -1,
      kicker: "Trafikk",
      headline: roads.length === 1 ? `Løypemaskin sperret ${road}` : `${roads.length} ganger på én uke: løypemaskin midt i ${road}`,
      lead: `Pendlere og vogntog måtte smøre seg med tålmodighet da løypelagets tråkkemaskin krysset ${road} i plan.`,
      body: [
        `– Jeg har kjørt denne veien i tretti år. Aldri har jeg måttet vente på en løypemaskin, sier vogntogsjåfør ${person(seed + 5, ["Gran", "Lunner", "Jaren", "Gjøvik"])}.`,
        "En kilde i veisektoren mener en kulvert eller bru ville løst saken. – Men det koster jo penger, og det har ikke løypelag, sier kilden.",
        "Løypemaskinen har ikke svart på Varingens henvendelser.",
      ],
    });
  }

  if (lied.length > 0) {
    out.push({
      score: 9,
      tone: -1,
      kicker: "Varingen sjekker",
      headline: "«Strålende forhold»? Skiløperne er uenige",
      lead: `Føremeldingen lovet perfekte spor ${lied.length === 1 ? "én dag" : `${lied.length} dager`} denne uka. Varingen har sammenlignet med virkeligheten. Det var ikke pent.`,
      body: [
        `– Det sto «lynraskt». Det betydde is, sier ${person(seed + 7, SOUTH)}, som hadde tatt turen nordover for første gang denne vinteren.`,
        "Løypelaget avviser at føremeldingen var pyntet. – Vi skrev det vi følte, sier en talsperson.",
      ],
    });
  }

  if (snow >= 12 && tiles > 0 && groomed < tiles) {
    out.push({
      score: 7,
      tone: -1,
      kicker: "Snøkaos",
      headline: `${Math.round(snow)} cm nysnø – og ingen løypemaskin i sikte`,
      lead: "Snøen la seg tykt over Hakadal denne uka. Løypene ble liggende.",
      body: [
        `– Jeg tråkket spor selv, med truger. Det tok hele lørdagen, forteller ${person(seed + 9, NORTH)}.`,
        "Løypelaget minner om at løypemaskinen trenger diesel, og at diesel trenger penger.",
      ],
    });
  }

  if (last && last.tiles > 0 && (last.icy > 0.4 || last.bare > 0.3)) {
    const bare = last.bare > last.icy;
    out.push({
      score: 5,
      tone: -1,
      kicker: "Føre",
      headline: bare ? "Stein i sporet: «Ta de gamle skiene»" : "Speilblankt i løypene ved " + place,
      lead: bare
        ? `Mildvær og regn har spist snøen ved ${place}. Det som er igjen, er grus, røtter og gode intensjoner.`
        : `Regn og kulde har gjort sporet til en skøytebane. Skiløperne har delt seg i to grupper: de som falt, og de som ikke har prøvd ennå.`,
      body: [
        `– Jeg smurte med skareklister og bønn, sier ${person(seed + 11, SOUTH)}.`,
        bare ? "Løypelaget håper på kaldere vær og mer snø. Det gjør Varingen også." : "Løypelaget anbefaler en tur med løypemaskinen før det fryser på igjen.",
      ],
    });
  }

  // Only a record once there are earlier full weeks to beat, and only good news if people liked it.
  if (input.number >= 3 && skiers >= 200 && skiers > input.bestWeek && (happy ?? 0) >= 0.5) {
    out.push({
      score: 7,
      tone: 1,
      kicker: "Rekord",
      headline: `Rekorduke i løypene: ${skiers.toLocaleString("nb-NO")} skiløpere`,
      lead: `Aldri før har så mange gått på ski i Hakadal på én uke. Mange av dem kom sørfra.`,
      body: [
        `– Det er ikke snø på Rotnes, så vi kjører hit, sier ${pick(FIRST, seed + 13)} ${pick(LAST, seed + 14)} (54). – Men ikke si det til naboen.`,
        "Parkeringsplassene var fulle fra klokka ti. Løypelaget oppfordrer folk til å ta toget, «hvis det går».",
      ],
    });
  }

  if (happy !== null && happy >= 0.7 && skiers >= 60) {
    out.push({
      score: 5,
      tone: 1,
      kicker: "Skiglede",
      headline: `Skryt av sporene ved ${place}`,
      lead: "Skiløperne er strålende fornøyde med løypene denne uka, og det sier de høyt.",
      body: [
        `– Beste sporet i hele Akershus. Og det sier jeg som er fra ${pick(SOUTH, seed + 15)}, sier ${pick(FIRST, seed + 16)} ${pick(LAST, seed + 17)}.`,
        "Varingen har forsøkt å finne noen som er misfornøyd. Det lyktes ikke.",
      ],
    });
  }

  if (newKm >= 1) {
    out.push({
      score: 4 + Math.min(4, newKm),
      tone: 1,
      kicker: "Løypenettet",
      headline: `${newKm.toFixed(1).replace(".", ",")} km nye løyper i Hakadal`,
      lead: `Løypelaget har vært flittig. Løypenettet er nå på ${input.km.toFixed(1).replace(".", ",")} km.`,
      body: [
        "– Vi bygger der det er snø, og der det ikke bor noen som klager, sier en representant for løypelaget.",
        `Planene om spor helt sør til Rotnes er foreløpig lagt på is. – Det er mest gress der, forklarer løypelaget.`,
      ],
    });
  }

  if (trampled >= 12) {
    out.push({
      score: 5,
      tone: 0,
      kicker: "Natur",
      headline: "Elgen går i sporet – og bryr seg ikke",
      lead: "Nykjørte løyper med elgspor tvers gjennom er blitt et vanlig syn i de stille delene av marka.",
      body: [
        `– Elgen synes nok det er like deilig å gå i preparert spor som oss, sier en lokal elgjeger. – Den gir bare ikke Vipps.`,
        "Elgen skyr folk. Jo flere som går i sporet, desto sjeldnere tråkker den der.",
      ],
    });
  }

  if (input.budget < 20_000 && tiles > 0) {
    out.push({
      score: 4,
      tone: 0,
      kicker: "Økonomi",
      headline: "Løypelaget teller kronene",
      lead: `Med under ${Math.ceil(input.budget / 1000)} 000 kroner i kassa må løypelaget vurdere hver tur med maskinen.`,
      body: ["– Vipps-nummeret står på hver eneste stolpe. Noen stolper har to, sier kassereren."],
    });
  }

  if (members >= 5) {
    out.push({
      score: 3,
      tone: 1,
      kicker: "Dugnadsånd",
      headline: `${members} nye medlemmer i løypelaget på én uke`,
      lead: "Medlemsverving med fornøyde skiløpere virker bedre enn loddsalg.",
      body: [],
    });
  }

  if (tiles > 0 && input.weather.snowDepthAt(input.lowest) < 15 && snow < 5) {
    out.push({
      score: 3,
      tone: 0,
      kicker: "Været",
      headline: "Hakadal venter på snøen",
      lead: rain > 5 ? "Det kom regn i stedet. Det teller ikke." : "Løypemaskinen står klar i garasjen. Snøen står ikke klar noe sted.",
      body: [],
    });
  }

  out.push({
    score: 1,
    tone: 0,
    kicker: "Hakadal",
    headline: pick(["Rolig uke i løypene", "Ingen elg i Rv. 4 denne uka", "Fortsatt vinter nord i bygda"], seed + 19),
    lead: "Det skjedde lite i Hakadal denne uka, noe hakadølene selv mener er helt i orden.",
    body: [`– Vi liker det sånn, sier ${person(seed + 21, NORTH)}.`],
  });

  return out.sort((a, b) => b.score - a.score);
}

function mostCommon(xs: string[]): string {
  const counts = new Map<string, number>();
  for (const x of xs) {
    counts.set(x, (counts.get(x) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/** Friendly fun at the southern end of the parish, where the snow never quite arrives. */
const FROM_THE_SOUTH = [
  "Rotnes-beboere oppdaget i helgen at bygda fortsetter nord for Kirkeby. – Det sto ingenting om det på skiltet, sier en av dem.",
  "Velforeningen på Rotnes understreker at det grønne i hagene er et bevisst valg.",
  "I Nittedal sentrum vurderer man å omtale sludd som «kystsnø».",
  "Sørbygda arrangerer også i år «Ski i hagen»-dugnad. Snø medbringes.",
  "En Rotnes-familie ble observert i Hakadal med ski på taket og solbriller i håret. De lette etter «snøen dere snakker om».",
  "Slattum melder om tre centimeter snø. To av dem var på en bil fra Hakadal.",
  "Hagan har fått sitt første snøfnugg. Det er stilt ut på biblioteket.",
  "– Vi har snø i sør også, sier en mann på Rotnes og viser frem et bilde fra 2010.",
];

const LETTERS: { from: string; text: string; reply?: string }[] = [
  { from: "Bekymret hundeeier, Mork", text: "Er det virkelig nødvendig å ha klassisksporet akkurat der hunden min liker å gå?" },
  { from: "Skøyteløper, Rotnes", text: "Hvorfor kjøres det klassisk spor i det hele tatt? Det er 2026." },
  { from: "Klassiskløper, Hakadals verk", text: "Til den som skøytet i klassisksporet ved Skansen søndag: Vi vet hvem du er." },
  {
    from: "Morgenfugl, Ekra",
    text: "I 06-tiden ble jeg forbikjørt av en rødskjegget mann på ski, trukket av to huskyer. Er dette lov?",
    reply: "Varingen har vært i kontakt med Manu og Nanook, som ikke ønsket å kommentere saken.",
  },
  { from: "Pensjonist, Sagstua", text: "Før i tida tråkket vi sporene selv. Med ullsokker. I motbakke. Begge veier." },
  { from: "Pendler, Kirkeby", text: "Hvis løypemaskinen skal stå i Rv. 4 hver kveld, kan den i det minste ta med seg kaffe." },
  { from: "Fornøyd, Skansen", text: "Takk til gutta og jentene i løypemaskina. Dere er natteravner i ordets beste forstand." },
];

const RAIL = [
  "Signalfeil på Gjøvikbanen – igjen. Jernbanen beklager, som vanlig.",
  "Toget til Hakadal var i rute tirsdag. Varingen har dobbeltsjekket.",
  "Signalfeil på Gjøvikbanen. Skiløpere med toget anbefales å smøre med tålmodighet.",
];

const fmt = (n: number) => n.toFixed(0);

/** Write the week's paper: the biggest story on the front, a few briefs, and the regular columns. */
export function writeEdition(input: EditionInput): Edition {
  const { day, number, weather } = input;
  const seed = day * 7 + number;
  const [lead, ...rest] = stories(input);
  const briefs = rest.filter((s) => s.score > 1).slice(0, 3);
  const letter = pick(LETTERS, seed + 3);
  const south = pick(FROM_THE_SOUTH, seed + 5);
  const rail = rand(seed + 9) < 0.45 ? pick(RAIL, seed + 11) : null;
  const hakadal = weather.snowDepthAt(input.lowest);
  // Rotnes is off the map, lower down and further south: always less snow than Hakadal.
  const rotnes = Math.max(0, weather.snowDepthAt(input.lowest - 30) * 0.6 - 4);

  const html = `
    <div class="masthead">
      <div class="title">Varingen</div>
      <div class="dateline"><span>Nr. ${number}</span><span>${dayLabel(day)}</span><span>Løssalg 45 kr</span></div>
    </div>
    <article class="lead tone${lead.tone}">
      <div class="kicker">${lead.kicker}</div>
      <h2>${lead.headline}</h2>
      <p class="ingress">${lead.lead}</p>
      ${lead.body.map((p) => `<p>${p}</p>`).join("")}
      <p class="byline">Tekst: ${pick(REPORTERS, seed)}</p>
    </article>
    <div class="columns">
      ${briefs.map((s) => `<article class="brief"><div class="kicker">${s.kicker}</div><h3>${s.headline}</h3><p>${s.lead}</p></article>`).join("")}
      <article class="brief south"><div class="kicker">Sør i bygda</div><p>${south}</p></article>
      ${rail ? `<article class="brief"><div class="kicker">Gjøvikbanen</div><p>${rail}</p></article>` : ""}
      <article class="brief snow"><div class="kicker">Snømåling</div>
        <p>Hakadal: <strong>${fmt(hakadal)} cm</strong><br>Rotnes: <strong>${fmt(rotnes)} cm</strong>${rotnes < 3 ? " (og en kjegle)" : ""}</p></article>
    </div>
    <article class="letter"><div class="kicker">Leserbrev</div><p>«${letter.text}»</p><p class="from">— ${letter.from}</p>
      ${letter.reply ? `<p class="reply">${letter.reply}</p>` : ""}</article>`;

  return { day, number, headline: lead.headline, tone: lead.tone, html };
}

/** How a front page moves the club's standing and the coming weekend's turnout. */
export const PRESS_REPUTATION = 0.03;
export const PRESS_DEMAND = 0.15;
export const PRESS_DAYS = 4;
