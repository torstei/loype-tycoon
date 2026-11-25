import { region } from "./region";
import { dayLabel, seasonName } from "./clock";
import { MEMBERSHIP_FEE } from "./skiers";
import { AccountRow } from "./savegame";
import { Edition } from "./varingen";

/** What a finished winter adds up to: the season edition, the annual meeting and the record books read it. */
export interface SeasonSummary {
  year: number;
  /** 1 for the first winter the club runs. */
  number: number;
  endDay: number;
  skiers: number;
  bestDay: { day: number; skiers: number } | null;
  happy: number | null;
  newMembers: number;
  /** Everyone in the club at the end of the winter, last year's renewals included. */
  members: number;
  donations: number;
  memberFees: number;
  waffles: number;
  waffleIncome: number;
  rooms: number;
  diesel: number;
  power: number;
  built: number;
  startBudget: number;
  endBudget: number;
  km: number;
  kmStart: number;
  reputation: number;
  snow: number;
  groomed: number;
  goodHeadline: string | null;
  badHeadline: string | null;
  editions: number;
  chairlift: boolean;
  kiosks: number;
  cabins: number;
}

/** The summer's books, settled before the next winter starts. */
export interface Summer {
  renewed: number;
  renewals: number;
  grasrot: number;
  service: number;
  insurance: number;
  clearing: number;
  dugnad: boolean;
  members: number;
  budget: number;
}

export interface SeasonInput {
  year: number;
  number: number;
  endDay: number;
  history: AccountRow[];
  /** Members carried over from last winter. */
  carriedMembers: number;
  startBudget: number;
  budget: number;
  km: number;
  kmStart: number;
  reputation: number;
  editions: Edition[];
  chairlift: boolean;
  kiosks: number;
  cabins: number;
}

const total = (rows: AccountRow[], f: (r: AccountRow) => number) => rows.reduce((s, r) => s + f(r), 0);

export function summarise(input: SeasonInput): SeasonSummary {
  const h = input.history;
  const rated = h.filter((r) => r.happy !== null);
  const ratedSkiers = total(rated, (r) => r.skiers);
  const best = h.reduce<AccountRow | null>((b, r) => (!b || r.skiers > b.skiers ? r : b), null);
  const newMembers = total(h, (r) => r.members);
  const good = input.editions.filter((e) => e.tone > 0);
  const bad = input.editions.filter((e) => e.tone < 0);
  return {
    year: input.year,
    number: input.number,
    endDay: input.endDay,
    skiers: total(h, (r) => r.skiers),
    bestDay: best && best.skiers > 0 ? { day: best.day, skiers: best.skiers } : null,
    happy: ratedSkiers > 0 ? total(rated, (r) => r.happy! * r.skiers) / ratedSkiers : null,
    newMembers,
    members: input.carriedMembers + newMembers,
    donations: total(h, (r) => r.donations),
    memberFees: newMembers * MEMBERSHIP_FEE,
    waffles: total(h, (r) => r.waffles),
    waffleIncome: total(h, (r) => r.waffleIncome),
    rooms: total(h, (r) => r.rooms),
    diesel: total(h, (r) => r.diesel),
    power: total(h, (r) => r.power),
    built: total(h, (r) => r.built),
    startBudget: input.startBudget,
    endBudget: input.budget,
    km: input.km,
    kmStart: input.kmStart,
    reputation: input.reputation,
    snow: total(h, (r) => r.snow ?? 0),
    groomed: total(h, (r) => r.groomed ?? 0),
    goodHeadline: good.length ? good[Math.floor(good.length / 2)].headline : null,
    badHeadline: bad.length ? bad[0].headline : null,
    editions: input.editions.length,
    chairlift: input.chairlift,
    kiosks: input.kiosks,
    cabins: input.cabins,
  };
}

const kr = (n: number) => `${Math.round(n).toLocaleString("nb-NO")} kr`;
const n0 = (n: number) => Math.round(n).toLocaleString("nb-NO");
const km1 = (n: number) => n.toFixed(1).replace(".", ",");
const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)} %`);

function rand(seed: number): number {
  const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
const pick = <T>(xs: T[], seed: number): T => xs[Math.floor(rand(seed) * xs.length)];

type Verdict = "great" | "fine" | "poor";
/** How the winter went for the skiers, over the whole season rather than the slush at the end of it. */
export const rating = (s: SeasonSummary) => s.happy ?? s.reputation;
const verdict = (s: SeasonSummary): Verdict => (rating(s) >= 0.62 ? "great" : rating(s) >= 0.45 ? "fine" : "poor");
const income = (s: SeasonSummary) => s.donations + s.memberFees + s.waffleIncome + s.rooms;
const running = (s: SeasonSummary) => s.diesel + s.power;

/** The last paper of the winter: the season in numbers, the best and worst of it, and a goodbye to the snow. */
export function seasonEdition(s: SeasonSummary, number: number): Edition {
  const seed = s.year * 31 + s.number;
  const v = verdict(s);
  const may = s.endDay >= 151;
  const short = s.endDay <= 105;
  const end = dayLabel(s.endDay);
  const headline = may
    ? "Skiføre til mai – så var det over"
    : v === "great"
      ? `Tidenes skivinter i Hakadal?`
      : v === "fine"
        ? "Takk for vinteren!"
        : "En vinter å glemme";
  const tone = v === "great" ? 1 : v === "poor" ? -1 : 0;
  const ingress = `Snøen har gitt opp, og løypene er stengt for sesongen ${seasonName(s.year)}. ${n0(s.skiers)} skiturer, ${km1(s.km)} km løype og ${pct(s.happy)} fornøyde skiløpere: ${region.names.newspaper} gjør opp status.`;
  const leader = {
    great: "– Folk har stoppet meg på butikken for å takke. Det har aldri skjedd før, sier løypelagets leder.",
    fine: "– Det har vært en grei vinter. Vi har lært mye, og vi har kjøpt mye diesel, sier løypelagets leder.",
    poor: "– Vi tar kritikken. Neste vinter skal sporet ligge der folk forventer det, sier løypelagets leder.",
  }[v];
  const skier = {
    great: "– Jeg har gått mer på ski i år enn på ti år til sammen. Kona lurer på om jeg har flyttet ut, sier en fornøyd mosjonist fra Ekra.",
    fine: "– Noen dager var helt fantastiske. Andre dager lurte jeg på om løypemaskina hadde gått seg vill, sier en mosjonist fra Sagstua.",
    poor: "– Jeg har gått mer på isføre enn på snø i vinter. Brodder neste år, sier en skuffet skiløper fra Mork.",
  }[v];
  const ending = may
    ? `Sesongen varte helt til ${end}. – Har du ski i mai i Hakadal, har du vunnet i lotto, sier en lokal værkjenner.`
    : short
      ? `Allerede ${end} var snøen borte. – Kort vinter. Det er sånn det blir framover, frykter en lokal værkjenner.`
      : `Siste skidag ble ${end}.`;
  const best = s.bestDay ? `${dayLabel(s.bestDay.day)} med ${n0(s.bestDay.skiers)} skiløpere` : "–";
  const facts = `
    <article class="facts">
      <div class="kicker">Sesongen i tall</div>
      <table>
        <tr><td>Skiturer</td><td>${n0(s.skiers)}</td></tr>
        <tr><td>Beste dag</td><td>${best}</td></tr>
        <tr><td>Løypenett</td><td>${km1(s.km)} km${s.number > 1 && s.km > s.kmStart + 0.05 ? ` (+${km1(s.km - s.kmStart)} km i år)` : ""}</td></tr>
        <tr><td>Snøfall i dalen</td><td>${n0(s.snow)} cm</td></tr>
        <tr><td>Fornøyde skiløpere</td><td>${pct(s.happy)}</td></tr>
        <tr><td>Nye medlemmer</td><td>${n0(s.newMembers)}</td></tr>
        ${s.waffles > 0 ? `<tr><td>Vafler</td><td>${n0(s.waffles)}</td></tr>` : ""}
      </table>
    </article>`;
  const letters = [
    { from: "Takknemlig, Hakadals verk", text: "Takk til alle som har kjørt løyper i vinter. Vi sees i desember. Ta med kaffe." },
    { from: "Hundeeier, Mork", text: "Nå som snøen er borte, kan noen forklare meg hvor hunden min skal gå tur?" },
    { from: "Utålmodig, Kirkeby", text: "Når kommer snøen igjen? Jeg har allerede smurt skiene til neste år." },
    { from: "Pensjonist, Sagstua", text: "I min tid varte vinteren til midten av mai. Og vi gikk til skolen. På ski. I motbakke." },
  ];
  const letter = pick(letters, seed);
  const html = `
    <div class="masthead">
      <div class="title">${region.names.newspaper}</div>
      <div class="dateline"><span>Nr. ${number} · Sesongavslutning</span><span>${end}</span><span>Løssalg 45 kr</span></div>
    </div>
    <article class="lead tone${tone}">
      <div class="kicker">Sesongen ${seasonName(s.year)}</div>
      <h2>${headline}</h2>
      <p class="ingress">${ingress}</p>
      <p>${leader}</p>
      <p>${skier}</p>
      <p>${ending}</p>
      <p class="byline">Tekst: Synnøve Lien</p>
    </article>
    <div class="columns">
      ${facts}
      ${s.goodHeadline ? `<article class="brief"><div class="kicker">Årets beste forside</div><h3>«${s.goodHeadline}»</h3></article>` : ""}
      ${s.badHeadline ? `<article class="brief"><div class="kicker">Årets ris</div><h3>«${s.badHeadline}»</h3></article>` : ""}
      <article class="brief snow"><div class="kicker">Snømåling</div><p>Hakadal: <strong>0 cm</strong><br>Rotnes: <strong>hestehov</strong></p></article>
    </div>
    <article class="letter"><div class="kicker">Leserbrev</div><p>«${letter.text}»</p><p class="from">— ${letter.from}</p></article>
    <p class="next"><button data-open="album">Sesongen i bilder →</button></p>`;
  return { day: s.endDay, number, headline, tone, html };
}

const ANY_OTHER_BUSINESS = [
  "Forslag om å forby skøyting i klassisksporet: vedtatt med overveldende flertall. Ingen vet hvordan det skal håndheves.",
  "Spørsmål om hundebæsj langs sporet: utsatt til neste årsmøte, som vanlig.",
  "Forslag om å gi løypemaskina et navn: «Brøyte-Bjørn» vant over «Gunnars stolthet» etter loddtrekning.",
  "Spørsmål om hvorfor kringla var med rosiner i år: styret beklaget og lovet bedring.",
  "Forslag om å flytte årsmøtet til en dag uten Champions League: avvist.",
  "Et medlem ønsket å vite hvem som har lånt ut termosen til løypelaget. Saken er under etterforskning.",
];

/** The club's annual meeting: the year's report, the accounts, the vote on the board, and a prize. */
export function meetingHtml(s: SeasonSummary): string {
  const seed = s.year * 17 + s.number;
  const present = Math.max(6, Math.round(s.members * 0.06) + 4);
  const kringler = Math.max(2, Math.ceil(present / 8));
  const result = income(s) - running(s);
  const v = verdict(s);
  const vote =
    v === "great" && result >= 0
      ? `Styret ble gitt ansvarsfrihet ved akklamasjon. Applausen varte så lenge at kaffen ble kald.`
      : v !== "poor" && result >= -20_000
        ? `Ansvarsfrihet med ${present - 3} mot 3 stemmer. Ett medlem ville vite nøyaktig hva dieselen gikk til, og fikk se kvitteringene.`
        : s.chairlift && rating(s) < 0.5
          ? `Ansvarsfrihet etter lang debatt. «Dere kjøpte en stolheis mens sporet var en isbane», sa et medlem. Styret lovet å prioritere sporet neste år.`
          : result < 0
            ? `Ansvarsfrihet med knappest mulig flertall. Kassereren måtte forklare underskuddet to ganger, den andre gangen med tegninger.`
            : `Ansvarsfrihet etter lang debatt. Flere medlemmer mente sporet var for dårlig for ofte. Styret lovet bedring.`;
  const prize = s.waffles > 2000
    ? `<strong>Årets vaffeljern</strong> gikk til vaffelgjengen, for ${n0(s.waffles)} vafler stekt i vinter. Jernet ble overrakt med en klatt rømme.`
    : `<strong>Gullbrøytestikka</strong> gikk til Gunnar i løypemaskina, for ${n0(s.groomed * 0.025)} km preparert spor i vinter. Han takket kort og gikk ut for å se til maskina.`;
  const row = (label: string, value: number, cls = "") => `<tr${cls ? ` class="${cls}"` : ""}><td>${label}</td><td>${kr(value)}</td></tr>`;
  return `
    <div class="head"><strong>🏛 Årsmøte i løypelaget · ${seasonName(s.year)}</strong></div>
    <p class="status">Klubbhuset, torsdag kl. 19. Fremmøtt: ${present} medlemmer. Servert: kaffe og ${kringler} kringler.</p>
    <h4>1. Årsberetning</h4>
    <ul>
      <li>Løypenettet er på ${km1(s.km)} km${s.number > 1 && s.km > s.kmStart + 0.05 ? `, ${km1(s.km - s.kmStart)} km mer enn i fjor` : ""}.</li>
      <li>${n0(s.skiers)} skiturer i sesongen, og ${pct(s.happy)} av skiløperne var fornøyde.</li>
      <li>Laget har ${n0(s.members)} medlemmer${s.number > 1 ? `, ${n0(s.newMembers)} av dem nye i år` : ""}.</li>
      ${s.chairlift ? `<li>Stolheisen i ${region.names.skiArea} har tatt langrennsløperne til topps.</li>` : ""}
      ${s.kiosks + s.cabins > 0 ? `<li>Laget driver ${s.kiosks + s.cabins} vaffelsteder og hytter.</li>` : ""}
    </ul>
    <h4>2. Regnskap</h4>
    <table class="books">
      ${row("Vipps fra skiløpere", s.donations)}
      ${row("Medlemskontingent", s.memberFees)}
      ${s.waffleIncome > 0 ? row("Vaffelsalg", s.waffleIncome) : ""}
      ${s.rooms > 0 ? row("Overnatting", s.rooms) : ""}
      ${row("Diesel", -s.diesel)}
      ${s.power > 0 ? row("Strøm og drift", -s.power) : ""}
      ${row("Driftsresultat", result, "sum")}
      ${s.built > 0 ? row("Investert i løyper og bygg", -s.built) : ""}
      ${row("I kassa", s.endBudget, "sum")}
    </table>
    <h4>3. Ansvarsfrihet for styret</h4>
    <p>${vote}</p>
    <h4>4. Utmerkelser</h4>
    <p>${prize}</p>
    <h4>5. Eventuelt</h4>
    <p>${pick(ANY_OTHER_BUSINESS, seed)}</p>
    <p class="next"><button data-season="summer">☀️ Videre til sommeren</button></p>`;
}

const SERVICE_PER_GROOMER = 30_000;
const INSURANCE = 12_000;
const CLEARING_PER_KM = 1_500;

/** Renewals, the grassroots share and the summer's bills, settled into next winter's cash. */
export function settleSummer(s: SeasonSummary, groomers: number): Summer {
  const renewed = Math.round(s.members * (0.3 + 0.4 * rating(s)));
  const dugnad = rating(s) >= 0.55;
  const clearing = Math.round(s.km * CLEARING_PER_KM * (dugnad ? 0.5 : 1));
  const service = groomers * SERVICE_PER_GROOMER;
  const grasrot = Math.round(s.members * 25);
  const renewals = renewed * MEMBERSHIP_FEE;
  return {
    renewed,
    renewals,
    grasrot,
    service,
    insurance: INSURANCE,
    clearing,
    dugnad,
    members: renewed,
    budget: s.endBudget + renewals + grasrot - service - INSURANCE - clearing,
  };
}

const summerNotes = () => [
  "Gunnar har overhalt løypemaskina og påstår at den går bedre enn ny.",
  "Bringebærkratt og bjørkeris har grodd inn over traseene. Ryddesaga har gått varm.",
  "En elgku med kalv har tatt i bruk skiløypa som sommerbeite.",
  "Styret har hatt tre møter og spist fem kaker. Ingen vedtak ble gjort.",
  `Noen har syklet stisykkel i skiløypa og laget hjulspor. ${region.names.newspaper} har skrevet om det.`,
  "Vaffeljernet har vært på service. Det var ingenting galt med det, men det var hyggelig å få det sjekket.",
];

export function summerHtml(s: SeasonSummary, summer: Summer, nextYear: number): string {
  const seed = s.year * 7 + 3;
  const notes = [pick(summerNotes(), seed), pick(summerNotes(), seed + 1)].filter((t, i, a) => a.indexOf(t) === i);
  const row = (label: string, value: number) => `<tr><td>${label}</td><td class="${value >= 0 ? "plus" : "minus"}">${value >= 0 ? "+" : "−"}${kr(Math.abs(value))}</td></tr>`;
  return `
    <div class="head"><strong>☀️ Sommer i Hakadal</strong></div>
    <p class="status">Snøen er borte, hestehoven er ute, og løypelaget har sommerpause. Nesten.</p>
    <ul>${notes.map((t) => `<li>${t}</li>`).join("")}</ul>
    <table class="books">
      <tr><td>I kassa etter vinteren</td><td>${kr(s.endBudget)}</td></tr>
      ${row(`Kontingent: ${n0(summer.renewed)} av ${n0(s.members)} medlemmer fornyet`, summer.renewals)}
      ${row("Grasrotandelen", summer.grasrot)}
      ${row("Service på løypemaskinene", -summer.service)}
      ${row("Forsikring", -summer.insurance)}
      ${row(summer.dugnad ? "Rydding av traseer (dugnaden møtte opp: halv pris)" : "Rydding av traseer", -summer.clearing)}
      <tr class="sum"><td>I kassa 1. desember</td><td>${kr(summer.budget)}</td></tr>
    </table>
    <p class="note">Løypene, maskinene, vaffelstedene og hyttene står klare. Snøen kommer når den kommer.</p>
    <p class="next"><button data-season="next">❄️ Ny sesong ${seasonName(nextYear)}</button></p>`;
}
