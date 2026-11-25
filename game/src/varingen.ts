import { capital, fill, neighbourhood, region } from "./region";
import { dayLabel } from "./clock";
import { SurveyTally } from "./skiers";
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
  /** Absent in days logged before waffle stands existed. */
  waffles?: number;
  kioskBought?: string | null;
  kioskUpgrade?: boolean;
  expertsHired?: boolean;
  chairlift?: string | null;
  cabinClaimed?: string | null;
  cabinBuilt?: string | null;
  guests?: number;
  kioskBroken?: boolean;
  kiosks?: number;
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
  /** What each kind of skier thought since the last edition. */
  survey: SurveyTally[];
  /** In the winter's first edition: the forest roads ploughed this winter, and those the club lost track along. */
  ploughing?: { roads: string[]; lost: string[] };
}

/** The paper comes out on Thursdays. */
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
/** Where lorry drivers on the main road come from: far away. */
const HAULIERS = ["Gjøvik", "Hamar", "Trondheim", "Drammen", "Kongsvinger"];
const FIRST = ["Per-Kristian", "Hege", "Arvid", "Tone", "Geir Ove", "Line", "Bjørnar", "Randi", "Stian", "Wenche", "Odd-Erling", "Kjersti"];
const LAST = ["Hagen", "Brattli", "Moen", "Sætre", "Fjeld", "Lund", "Nygård", "Haugen", "Bakke", "Ødegård"];

function rand(seed: number): number {
  const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function pick<T>(xs: T[], seed: number): T {
  return xs[Math.floor(rand(seed) * xs.length)];
}

const capitalise = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const andList = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} og ${xs[xs.length - 1]}` : xs[0]);

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

  const plough = input.ploughing;
  if (plough?.lost.length) {
    out.push({
      score: 6,
      tone: 0,
      kicker: "Brøytekartet",
      headline: capitalise(`${andList(plough.lost)} brøytes i vinter`),
      lead: `Skogeieren har lagt fram vinterens brøytekart, og løypa langs ${andList(plough.lost)} ligger nå under brøytekanten. Løypelaget jobber med alternativer.`,
      body: [
        "– Veiene er der for tømmeret og for dem som bor i marka. Det får vi bare respektere, sier lederen i løypelaget.",
        `– Vi gikk der hver søndag i fjor. Nå må vi finne en ny runde, sier ${person(seed + 41, region.names.neighbourhoods)}.`,
      ],
    });
  } else if (plough?.roads.length) {
    out.push({
      score: 1.5,
      tone: 0,
      kicker: "Brøytekartet",
      headline: "Brøytekartet for vinteren er klart",
      lead: `I vinter brøyter skogeieren blant annet ${andList(plough.roads.slice(0, 3))}. Skiløpere bes holde seg unna veiene når tømmerbilene går.`,
      body: [],
    });
  }

  if (input.km === 0) {
    out.push({
      score: 3,
      tone: -1,
      kicker: `Vinter ${region.names.at}`,
      headline: "Nytt løypelag – men hvor er sporet?",
      lead: "Løypelaget har fått seg garasje og løypemaskin. Det som mangler, er løyper.",
      body: [
        `– Jeg har gått frem og tilbake ved garasjen i en time. Jeg fant ingen spor, sier ${person(seed, region.names.neighbourhoods)}.`,
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
        `– Jeg har kjørt denne veien i tretti år. Aldri har jeg måttet vente på en løypemaskin, sier vogntogsjåfør ${person(seed + 5, HAULIERS)}.`,
        "En kilde i veisektoren mener en kulvert eller bru ville løst saken. – Men det koster jo penger, og det har ikke løypelag, sier kilden.",
        `Løypemaskinen har ikke svart på henvendelser fra ${region.names.newspaper}.`,
      ],
    });
  }

  if (lied.length > 0) {
    out.push({
      score: 9,
      tone: -1,
      kicker: `${region.names.newspaper} sjekker`,
      headline: "«Strålende forhold»? Skiløperne er uenige",
      lead: `Føremeldingen lovet perfekte spor ${lied.length === 1 ? "én dag" : `${lied.length} dager`} denne uka. ${region.names.newspaper} har sammenlignet med virkeligheten. Det var ikke pent.`,
      body: [
        `– Det sto «lynraskt». Det betydde is, sier ${person(seed + 7, visitors())}, som hadde tatt turen hit for første gang denne vinteren.`,
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
      lead: `Snøen la seg tykt over ${region.title} denne uka. Løypene ble liggende.`,
      body: [
        `– Jeg tråkket spor selv, med truger. Det tok hele lørdagen, forteller ${person(seed + 9, region.names.neighbourhoods)}.`,
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
        `– Jeg smurte med skareklister og bønn, sier ${person(seed + 11, visitors())}.`,
        bare ? `Løypelaget håper på kaldere vær og mer snø. Det gjør ${region.names.newspaper} også.` : "Løypelaget anbefaler en tur med løypemaskinen før det fryser på igjen.",
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
      lead: `Aldri før har så mange gått på ski ${region.names.at} på én uke. ${region.names.lowland ? `Mange av dem kom fra ${region.names.lowland.name}.` : "Mange av dem kom langveisfra."}`,
      body: [
        region.names.lowland
          ? `– Det er ikke snø der vi bor, så vi kjører hit, sier ${person(seed + 13, visitors())}. – Men ikke si det til naboen.`
          : `– Vi har ventet hele vinteren på dette, sier ${person(seed + 13, visitors())}.`,
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
        `– Beste sporet i hele fylket. Og det sier jeg som ${region.names.lowland ? `er fra ${pick(region.names.lowland.places, seed + 15)}` : "har gått på ski overalt"}, sier ${pick(FIRST, seed + 16)} ${pick(LAST, seed + 17)}.`,
        `${region.names.newspaper} har forsøkt å finne noen som er misfornøyd. Det lyktes ikke.`,
      ],
    });
  }

  if (newKm >= 1) {
    out.push({
      score: 4 + Math.min(4, newKm),
      tone: 1,
      kicker: "Løypenettet",
      headline: `${newKm.toFixed(1).replace(".", ",")} km nye løyper ${region.names.at}`,
      lead: `Løypelaget har vært flittig. Løypenettet er nå på ${input.km.toFixed(1).replace(".", ",")} km.`,
      body: [
        "– Vi bygger der det er snø, og der det ikke bor noen som klager, sier en representant for løypelaget.",
        ...(region.names.lowland ? [`Planene om spor helt ned til ${region.names.lowland.name} er foreløpig lagt på is. – Det er mest gress der, forklarer løypelaget.`] : []),
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

  const waffles = sum(week, (d) => d.waffles ?? 0);
  const bought = week.map((d) => d.kioskBought).filter((b): b is string => !!b);
  const hasKiosk = (last?.kiosks ?? 0) > 0;
  if (bought.includes("Vaffel-O-Matic 3000")) {
    out.push({
      score: 6,
      tone: 0,
      kicker: "Investering",
      headline: "Løypelaget kjøpte vaffelmaskin til 220 000 kroner",
      lead: "Den heter Vaffel-O-Matic 3000, har røresilo, transportbånd og LED-skilt, og kan lage 2 000 vafler om dagen.",
      body: [
        `– Hvem skal spise alle de vaflene? spør ${person(seed + 23, region.names.neighbourhoods)}, som bor rett ved garasjen og nå har lys i soverommet til klokka ti om kvelden.`,
        "Løypelaget mener investeringen vil betale seg «i løpet av noen sesonger, avhengig av brunostprisen».",
      ],
    });
  } else if (bought.length > 0) {
    const upgraded = week.some((d) => d.kioskBought && d.kioskUpgrade);
    out.push({
      score: 3,
      tone: 1,
      kicker: "Nytt i løypa",
      headline: upgraded ? "Vaffelsalget ved garasjen blir større" : "Nå får du vafler ved løypelagets garasje",
      lead: upgraded
        ? `Løypelaget har oppgradert til «${bought.at(-1)}». – Det var kø ved luka hver lørdag, forklarer løypelaget.`
        : `Løypelaget har satt opp «${bought.at(-1)}». Duften når helt ned til parkeringen.`,
      body: [],
    });
  }
  for (const name of week.map((d) => d.cabinClaimed).filter((n): n is string => !!n)) {
    out.push({
      score: 6,
      tone: 1,
      kicker: "Turmål",
      headline: `Nå går løypa helt til ${name}`,
      lead: `Løypelaget har kjørt opp spor til ${name}. Vaffelrøra er klar, og peisen er tent.`,
      body: [
        `– Endelig har turen et mål. Før gikk vi bare rundt, sier ${person(seed + 29, region.names.neighbourhoods)}.`,
        `Vertskapet melder om god pågang allerede første helg.`,
      ],
    });
  }
  for (const what of week.map((d) => d.cabinBuilt).filter((n): n is string => !!n)) {
    const staffed = what.startsWith("Betjent");
    out.push({
      score: staffed ? 7 : 4,
      tone: staffed ? 0 : 1,
      kicker: staffed ? "Storsatsing" : "Dugnad",
      headline: staffed ? `Løypelaget åpner betjent hytte` : `Ny dugnadskoie i marka`,
      lead: staffed
        ? `${what}: ti rom, kjøkken og betjening. Løypelaget har lånt penger av nesten alle.`
        : `${what}. Frivillige selger vafler og kaffe i helgene.`,
      body: staffed ? [`– Vi har tro på det, sier kassereren, og ser bort.`] : [],
    });
  }
  const guests = sum(week, (d) => d.guests ?? 0);
  if (guests >= 30) {
    out.push({
      score: 3,
      tone: 1,
      kicker: "Overnatting",
      headline: `${guests} overnattinger på hytta denne uka`,
      lead: "Folk kommer på ski med sekk og sovepose og blir til frokost.",
      body: [],
    });
  }
  const street = region.christmasHouse?.street;
  if (street && day >= 7 && day <= 13) {
    out.push({
      score: 8,
      tone: 1,
      kicker: "Julestemning",
      headline: `Julehuset i ${street} har tent lysene`,
      lead: `Også i år lyser det i ${street}. Taket, hagen, grantreet og et reinsdyr på plenen: alt blinker.`,
      body: [
        `– Vi kjører forbi hver kveld bare for å se. Ungene nekter å legge seg før vi har vært der, sier ${person(seed + 51, region.names.neighbourhoods)}.`,
        "– Hvor mange lys? Jeg har sluttet å telle, sier huseieren beskjedent. – Strømregningen teller for meg.",
      ],
    });
  }
  if (street && day >= 14 && day <= 20) {
    out.push({
      score: 4,
      tone: 0,
      kicker: "Trafikk",
      headline: "Saktekjøring forbi julehuset",
      lead: `Bilistene sakker ned i ${street} for å se på julelysene. Politiet ber folk heller stoppe på en lomme.`,
      body: [],
    });
  }
  if (street && day > 43 && day <= 50) {
    out.push({
      score: 3,
      tone: 0,
      kicker: "Tjugendedag",
      headline: `Mørkt i ${street}`,
      lead: `Tjugendedag knut jager jula ut: julelysene i ${street} er tatt ned for i år. Reinsdyret er satt på låven.`,
      body: [],
    });
  }
  const chairlift = week.find((d) => d.chairlift)?.chairlift;
  if (chairlift) {
    out.push({
      score: 9,
      tone: 1,
      kicker: "Endelig",
      headline: `Stolheis i ${region.names.skiArea}!`,
      lead: `Etter år med prat går det stoler opp ${chairlift}. Løypelaget har spleiset, og nå tar langrennsfolk også heisen til topps.`,
      body: [
        `– Jeg har stått i T-krok i førti år. Nå sitter jeg. Det føles nesten som juks, sier ${person(seed + 41, region.names.neighbourhoods)}.`,
        "– Oppe på toppen ligger snøen lenge etter at den har regnet bort i dalen. Det er der løypene bør gå, sier løypelagets leder.",
      ],
    });
  }
  if (week.some((d) => d.expertsHired)) {
    out.push({
      score: 5,
      tone: 1,
      kicker: "Samarbeid",
      headline: "Skytterlaget treffer blink med vaflene",
      lead: `Løypelaget har inngått avtale med ${region.names.waffleClub}: i helgene er det skytterne som står ved vaffeljernet.`,
      body: [
        `– Det handler om konsentrasjon, pust og presis dosering av røra, sier en av skytterlagets vaffelsteikere. – Akkurat som på standplass.`,
        `– De beste vaflene jeg har smakt. Og jeg har smakt mange, sier ${person(seed + 27, region.names.neighbourhoods)}.`,
      ],
    });
  }
  if (waffles >= 200) {
    out.push({
      score: 4 + Math.min(3, waffles / 500),
      tone: 1,
      kicker: "Vaffelfeber",
      headline: `${waffles.toLocaleString("nb-NO")} vafler solgt på én uke`,
      lead: "Vaffeljernet ved garasjen har gått varmt. Mange tar en ekstra runde bare for å komme forbi en gang til.",
      body: [`– Jeg kom for sporet. Jeg ble for vaflene, sier ${person(seed + 25, visitors())}.`],
    });
  }
  if (week.some((d) => d.kioskBroken)) {
    out.push({
      score: 3,
      tone: 0,
      kicker: "Teknisk",
      headline: "Vaffel-O-Matic i ustand – igjen",
      lead: "Røren stivnet i dysene, og skiløperne måtte klare seg med kvikklunsj.",
      body: [],
    });
  }
  if (skiers >= 300) {
    out.push({
      score: 2,
      tone: 0,
      kicker: "Handel",
      headline: `${capital(region.names.shop)}: «Rekordsalg av vaffel og boller!»`,
      lead: hasKiosk
        ? "Butikken merker skiløperne. – Løypelagets vaffelbu? Vi merker ingenting, sier butikksjefen, og legger enda flere boller i disken."
        : "Butikken takker skiløperne for en travel uke. – Folk kommer rett fra sporet og vil ha noe varmt, sier butikksjefen.",
      body: [],
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
      headline: `${region.title} venter på snøen`,
      lead: rain > 5 ? "Det kom regn i stedet. Det teller ikke." : "Løypemaskinen står klar i garasjen. Snøen står ikke klar noe sted.",
      body: [],
    });
  }

  out.push({
    score: 1,
    tone: 0,
    kicker: region.title,
    headline: pick(["Rolig uke i løypene", `Ingen elg i ${region.names.mainRoad} denne uka`, "Fortsatt vinter i bygda"], seed + 19),
    lead: `Det skjedde lite ${region.names.at} denne uka, noe ${region.names.locals} selv mener er helt i orden.`,
    body: [`– Vi liker det sånn, sier ${person(seed + 21, region.names.neighbourhoods)}.`],
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

/** Where people who come to ski here live: the lowland's places when the region has one. */
const visitors = () => region.names.lowland?.places ?? region.names.neighbourhoods;

/** Letters to the paper, signed from the neighbourhoods; the region's own come on top. */
const letters = (seed: number): { from: string; text: string; reply?: string }[] => {
  const n = (k: number) => neighbourhood(seed + k);
  return [
    { from: `Bekymret hundeeier, ${n(1)}`, text: "Er det virkelig nødvendig å ha klassisksporet akkurat der hunden min liker å gå?" },
    { from: `Skøyteløper, ${region.names.lowland?.name ?? n(8)}`, text: "Hvorfor kjøres det klassisk spor i det hele tatt? Det er 2026." },
    { from: `Klassiskløper, ${n(2)}`, text: `Til den som skøytet i klassisksporet ved ${n(3)} søndag: Vi vet hvem du er.` },
    {
      from: `Morgenfugl, ${n(4)}`,
      text: "I 06-tiden ble jeg forbikjørt av en rødskjegget mann på ski, trukket av to huskyer. Er dette lov?",
      reply: `${region.names.newspaper} har vært i kontakt med Manu og Nanook, som ikke ønsket å kommentere saken.`,
    },
    { from: `Pensjonist, ${n(5)}`, text: "Før i tida tråkket vi sporene selv. Med ullsokker. I motbakke. Begge veier." },
    { from: `Pendler, ${n(6)}`, text: `Hvis løypemaskinen skal stå i ${region.names.mainRoad} hver kveld, kan den i det minste ta med seg kaffe.` },
    { from: `Fornøyd, ${n(7)}`, text: "Takk til gutta og jentene i løypemaskina. Dere er natteravner i ordets beste forstand." },
    ...region.texts.letters.map((l) => ({ from: fill(l.from, seed + 8), text: fill(l.text, seed + 9), reply: l.reply && fill(l.reply, seed + 10) })),
  ];
};

const railNews = () => [
  `Signalfeil på ${region.names.railway} – igjen. Jernbanen beklager, som vanlig.`,
  `Toget til ${region.title} var i rute tirsdag. ${region.names.newspaper} har dobbeltsjekket.`,
  `Signalfeil på ${region.names.railway}. Skiløpere med toget anbefales å smøre med tålmodighet.`,
];

const fmt = (n: number) => n.toFixed(0);

const SURVEY_ORDER: [string, string][] = [["søndagsfamilie", "👨‍👩‍👧 Søndagsfamilier"], ["mosjonist", "🎿 Mosjonister"], ["lycraløper", "⚡ Lycraløpere"]];

/** What each kind of skier (family, fitness, racer, in SURVEY_ORDER) says about whatever pulled their verdict down most. */
const SURVEY_QUOTES: Record<"quality" | "roadMood" | "longEnough" | "variety" | "praise", [string, string, string]> = {
  quality: ["Ungene ga opp etter første bakke. Sporet var borte.", "Sporet var slitt og nedsnødd. Kjør maskina oftere, så kommer jeg oftere.", "Glid? Hvilket glid? Det er jo ikke spor engang."],
  roadMood: ["Å krysse veien med tre unger og et akebrett er ingen spøk.", "Jeg kom for å gå på ski, ikke for å stå ved et fotgjengerfelt.", "For mange veier å krysse. Bygg ei bru!"],
  longEnough: ["Litt kort, men de minste syntes det var nok.", "Fint, men altfor kort.", "Ferdig på en halvtime. Vi trenger lengre løyper."],
  variety: ["Ungene spurte om vi ikke hadde vært her før.", "Rundt og rundt i samme sløyfe. Jeg ble svimmel.", "Jeg kjenner hver eneste gran nå."],
  praise: ["Perfekt for hele familien!", "Beste sporet i bygda.", "Endelig noe å trene på. Kommer igjen i morgen."],
};

/** The weekly survey: how happy each kind of skier is, and what they would change. */
function surveyBox(survey: SurveyTally[]): string {
  const asked = survey.reduce((s, t) => s + t.n, 0);
  if (asked < 10) {
    return "";
  }
  const rows = SURVEY_ORDER.map(([kind, label], i) => {
    const t = survey.find((s) => s.kind === kind);
    if (!t || t.n < 5) {
      return `<div class="row"><span class="who">${label}</span><span class="pct">–</span><p class="quote">For få svar.</p></div>`;
    }
    const share = Math.round(t.satisfaction * 100);
    const weak = ([
      ["quality", t.quality, 0.8],
      ["roadMood", t.roadMood, 0.95],
      ["longEnough", t.longEnough, 0.9],
      ["variety", t.variety, 0.85],
    ] as const)
      .filter(([, value, limit]) => value < limit)
      .sort((a, b) => a[1] / a[2] - b[1] / b[2])[0];
    const quote = SURVEY_QUOTES[weak ? weak[0] : "praise"][i];
    return `<div class="row"><span class="who">${label}</span><span class="bar"><span style="width:${share}%"></span></span><span class="pct">${share} %</span><p class="quote">«${quote}»</p></div>`;
  }).join("");
  return `<article class="survey"><div class="kicker">${region.names.newspaper} spør</div><h3>Hvor fornøyd er du med løypene?</h3>${rows}
    <p class="method">${region.names.newspaper} spurte ${asked.toLocaleString("nb-NO")} skiløpere ved parkeringen. Hvor fornøyd de var med turen, i snitt.</p></article>`;
}

/** Write the week's paper: the biggest story on the front, a few briefs, and the regular columns. */
export function writeEdition(input: EditionInput): Edition {
  const { day, number, weather } = input;
  const seed = day * 7 + number;
  const [lead, ...rest] = stories(input);
  const briefs = rest.filter((s) => s.score > 1).slice(0, 3);
  const letter = pick(letters(seed), seed + 3);
  const low = region.names.lowland;
  const lowlandNews = low ? region.texts.lowlandNews.map((t, i) => fill(t, seed + i)) : [];
  const lowland = lowlandNews.length ? pick(lowlandNews, seed + 5) : null;
  const rail = region.railwayOnMap && rand(seed + 9) < 0.45 ? pick(railNews(), seed + 11) : null;
  const valley = weather.snowDepthAt(input.lowest);
  // The lowland is further down: always less snow than in the valley.
  const below = Math.max(0, weather.snowDepthAt(input.lowest - 30) * 0.6 - 4);

  const html = `
    <div class="masthead">
      <div class="title">${region.names.newspaper}</div>
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
      ${lowland ? `<article class="brief south"><div class="kicker">${low!.heading}</div><p>${lowland}</p></article>` : ""}
      ${rail ? `<article class="brief"><div class="kicker">${capital(region.names.railway)}</div><p>${rail}</p></article>` : ""}
      <article class="brief snow"><div class="kicker">Snømåling</div>
        <p>${region.title}: <strong>${fmt(valley)} cm</strong>${low ? `<br>${low.name}: <strong>${fmt(below)} cm</strong>${below < 3 ? " (og en kjegle)" : ""}` : ""}</p></article>
    </div>
    ${surveyBox(input.survey)}
    <article class="letter"><div class="kicker">Leserbrev</div><p>«${letter.text}»</p><p class="from">— ${letter.from}</p>
      ${letter.reply ? `<p class="reply">${letter.reply}</p>` : ""}</article>`;

  return { day, number, headline: lead.headline, tone: lead.tone, html };
}

/** How a front page moves the club's standing and the coming weekend's turnout. */
export const PRESS_REPUTATION = 0.03;
export const PRESS_DEMAND = 0.15;
export const PRESS_DAYS = 4;
