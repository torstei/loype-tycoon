import { dayLabel } from "./clock";
import { GameMap } from "./map";
import { DayStats } from "./skiers";
import { Condition, CONDITION_NAMES, TrackNetwork } from "./tracks";
import { Weather, WEATHER_ICON } from "./weather";

export interface Report {
  day: number;
  honest: string;
  rosy: string;
  /** Overall condition in one word, for the badge. */
  headline: Condition | "none";
}

export interface ReportInput {
  day: number;
  now: number;
  map: GameMap;
  tracks: TrackNetwork;
  weather: Weather;
  hasMachine: boolean;
  snowSinceLast: number;
  rainSinceLast: number;
  yesterday: DayStats | null;
  yesterdayHyped: boolean;
  /** Things the snowcats got up to on the roads since the last report. */
  incidents: string[];
}

const ROSY: Record<Condition, string> = {
  fresh: "perfekt",
  ok: "strålende",
  worn: "karakterfullt",
  snowed: "deilig pudderpreget",
  icy: "lynraskt",
  bare: "naturnært",
};

const DOT: Record<Condition, string> = {
  fresh: "#2f6fe0",
  ok: "#7798d8",
  worn: "#9aa6b8",
  snowed: "#c9d3e2",
  icy: "#7cc0e8",
  bare: "#8a6a4a",
};

const SIGN_OFFS = [
  "God tur! Hilsen løypesjefen",
  "Husk å Vippse løypelaget!",
  "Vennligst ikke gå tur med hunden i klassisksporet.",
  "Skøyting i klassisksporet straffes med evig skam.",
  "Løypemaskinføreren takker for alle vinkene.",
  "Kaffen på garasjen er dessverre bare for mannskapet.",
];

const COMMENTERS = ["Kari N.", "Ole-Petter B.", "Siri H.", "Magne", "Turid L.", "Bjørn-Arne S.", "Hege", "Lars Erik"];

function pick<T>(xs: T[], seed: number): T {
  return xs[Math.abs(Math.floor(Math.sin(seed * 91.17) * 10000)) % xs.length];
}

/** What to put under the skis, from the temperature and what the track is like. */
export function wax(temperature: number, newSnow: number, iceShare: number): string {
  if (iceShare > 0.3) {
    return "Skareklister. Og godt humør.";
  }
  if (temperature > 0.5) {
    return newSnow > 1 ? "Rød klister, eller felleski hvis du vil leve et enkelt liv." : "Universalklister. Ha med tørkepapir.";
  }
  if (temperature > -1.5) {
    return "Fiolett. Eller rød. Ingen vet. Nullføre er en prøvelse.";
  }
  if (temperature > -4) {
    return "Fiolett.";
  }
  if (temperature > -9) {
    return "Blå extra. Klassisk og trygt.";
  }
  return "Grønn. Og ullundertøy.";
}

/** Which named place each track tile is nearest to, so the report can speak of areas. */
export function areas(map: GameMap, tracks: TrackNetwork): Map<string, [number, number][]> {
  const names = map.pois.filter((p) => p.name && (p.kind === "place" || p.kind === "peak" || p.kind === "station"));
  const out = new Map<string, [number, number][]>();
  for (const [x, y] of tracks.each()) {
    let best = names[0];
    let bestD = Infinity;
    for (const p of names) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    const name = best?.name ?? "Marka";
    out.set(name, [...(out.get(name) ?? []), [x, y]]);
  }
  return out;
}

function worst(conditions: Condition[]): Condition {
  const order: Condition[] = ["bare", "icy", "snowed", "worn", "ok", "fresh"];
  const counts = new Map<Condition, number>();
  for (const c of conditions) {
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  // An area is described by its most common state, unless a real problem covers a fifth of it.
  for (const c of order.slice(0, 3)) {
    if ((counts.get(c) ?? 0) >= conditions.length * 0.2) {
      return c;
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function comments(input: ReportInput): string[] {
  const y = input.yesterday;
  const lines: string[] = [];
  if (input.incidents.length > 0) {
    lines.push(pick(["Løypemaskina sto midt i Rv. 4 i går kveld. Kø helt til Grua. 😡", "Takk til løypelaget for at jeg fikk se en løypemaskin på riksveien. Barna jublet. Vogntoget mindre.", "Er det lov å kjøre tråkkemaskin over Rv. 4? Spør for en vogntogsjåfør."], input.day));
  }
  if (!y || y.skiers === 0) {
    return withLikes(lines, input.day);
  }
  const happy = y.finished > 0 ? y.satisfaction / y.finished : 0;
  if (input.yesterdayHyped && happy < 0.6) {
    lines.push("«Strålende forhold» sto det. Strålende for skøyteløpere, kanskje.");
  }
  if (happy > 0.7) {
    lines.push(pick(["Takk for fantastisk spor i går! ❤️", "Beste løypene i hele Akershus, og det sier jeg ikke ofte.", "Kjørte tre runder. Kona lurer på hvor jeg er."], input.day));
  } else if (happy > 0.45) {
    lines.push(pick(["Greit nok i går. Litt slitt mot slutten av dagen.", "Fint spor, men hvorfor er det alltid motbakke begge veier?"], input.day));
  } else {
    lines.push(pick(["Var det noen som kjørte maskin i det hele tatt?", "Gikk på ski i går. Eller, jeg gikk.", "Har løypelaget solgt løypemaskina?"], input.day));
  }
  if (y.skiers > 120) {
    lines.push(pick(["Fullt på parkeringen fra kl. 10. Kom med toget, folkens!", "Kø i sporet i går. KØ."], input.day + 1));
  }
  lines.push(pick(["Hvem eier den blå Volvoen som står på tvers på P Hakadal?", "Noen som har sett en grønn vott ved Skansen?", "Er det lov å ha med seg kjelke i lysløypa? Spør for en venn.", "Elgen sto midt i sporet igjen. Den så ikke lei seg ut.", "Møtte en rødskjegget kar med to huskyer nede i dalen kl. 06. Så jeg syner?", "Hvem er det som suser forbi med to huskyer hver kveld? Hundene smilte til meg."], input.day + 2));
  return withLikes(lines, input.day);
}

function withLikes(lines: string[], day: number): string[] {
  return lines.map((text, i) => {
    const likes = 3 + Math.abs(Math.floor(Math.sin((day + i) * 12.3) * 40));
    return `<div class="comment"><strong>${pick(COMMENTERS, day * 7 + i)}</strong> ${text} <span class="likes">👍 ${likes}</span></div>`;
  });
}

export function writeReport(input: ReportInput): Report {
  const { map, tracks, weather, now, day } = input;
  const title = `Føremelding ${dayLabel(day)} kl. 07:00`;
  if (tracks.size === 0) {
    const text = `<h3>${title}</h3><p>Løypelaget har ingen løyper ennå. Vi anbefaler sofaen.</p>`;
    return { day, honest: text, rosy: text, headline: "none" };
  }

  const groups = areas(map, tracks);
  const all = [...tracks.each()];
  const groomed = all.filter(([x, y]) => now - tracks.groomedAt[map.index(x, y)] < 14).length;
  const share = groomed / all.length;
  const iceShare = all.filter(([x, y]) => tracks.ice[map.index(x, y)] >= 0.5).length / all.length;
  const newSnow = all.reduce((s, [x, y]) => s + tracks.newSnow[map.index(x, y)], 0) / all.length;
  const elevations = all.map(([x, y]) => map.elevationAt(x, y));
  const low = Math.min(...elevations);
  const high = Math.max(...elevations);

  let groomingLine: string;
  if (share > 0.85) {
    groomingLine = "Alle løypene ble kjørt i natt.";
  } else if (share > 0.25) {
    groomingLine = "Deler av løypenettet ble kjørt i natt.";
  } else if (!input.hasMachine) {
    groomingLine = "Løypelaget har ingen løypemaskin. Sporene er tråkket for hånd, med kjærlighet.";
  } else if (weather.snowDepthAt(low) < 15) {
    groomingLine = "For lite snø til å kjøre maskin i de laveste partiene.";
  } else {
    groomingLine = "Ingen løyper ble kjørt i natt.";
  }

  let weatherLine = "";
  if (input.snowSinceLast >= 1) {
    weatherLine = `Det har kommet ${Math.round(input.snowSinceLast)} cm nysnø siden i går morges.`;
  } else if (input.rainSinceLast >= 1) {
    weatherLine = `Det har regnet ${Math.round(input.rainSinceLast)} mm siden i går. Vått og tungt.`;
  }
  const depthLine = `Snødybde ca. ${Math.round(weather.snowDepthAt(low))} cm nederst (${low} moh) og ${Math.round(weather.snowDepthAt(high))} cm øverst (${high} moh).`;

  const areaRows: { name: string; condition: Condition; groomedShare: number; trampledShare: number }[] = [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([name, tiles]) => ({
      name,
      condition: worst(tiles.map(([x, y]) => tracks.condition(x, y, weather))),
      groomedShare: tiles.filter(([x, y]) => now - tracks.groomedAt[map.index(x, y)] < 14).length / tiles.length,
      trampledShare: tiles.filter(([x, y]) => tracks.trampled(x, y)).length / tiles.length,
    }));
  const headline = worst(all.map(([x, y]) => tracks.condition(x, y, weather)));

  const warnings: string[] = [];
  for (const a of areaRows) {
    if (a.condition === "icy") warnings.push(`Isete partier ved ${a.name}. Ta det rolig i nedkjøringene.`);
    if (a.condition === "bare") warnings.push(`Steinete ved ${a.name}. Ta gamle ski.`);
    if (a.condition === "snowed") warnings.push(`Ved ${a.name} er sporet ikke kjørt etter snøfallet.`);
    if (a.trampledShare > 0.1) warnings.push(`Elgen har gått i sporet ved ${a.name}.`);
  }

  const [today] = weather.forecast(day, 1);
  const forecastLine = `I dag: ${WEATHER_ICON[today.kind]} ${today.low}° / ${today.high}°${today.precip > 0 ? `, ${today.precip} ${today.kind === "snø" ? "cm" : "mm"}` : ""}.`;
  const waxLine = wax(weather.temperature, newSnow, iceShare);
  const signOff = pick(SIGN_OFFS, day);
  const facebook = comments(input);
  const facebookBlock = facebook.length
    ? `<div class="facebook"><div class="fbhead">Fra gruppa «Skiføre i Hakadal (uoffisiell)»</div>${facebook.join("")}</div>`
    : "";

  const row = (a: (typeof areaRows)[number], rosy: boolean) =>
    `<li><span class="dot" style="background:${DOT[rosy ? "fresh" : a.condition]}"></span>
      <strong>${a.name}</strong>: ${rosy ? ROSY[a.condition] : CONDITION_NAMES[a.condition]}
      ${a.groomedShare > 0.5 ? "· kjørt i natt" : ""}</li>`;

  const honest = `
    <h3>${title}</h3>
    <p>${groomingLine} ${weatherLine}</p>
    <ul class="areas">${areaRows.map((a) => row(a, false)).join("")}</ul>
    ${warnings.length ? `<p class="warnings">⚠️ ${warnings.join(" ")}</p>` : ""}
    <p>${depthLine}</p>
    <p>${forecastLine}</p>
    <p><strong>Smøretips:</strong> ${waxLine}</p>
    <p class="signoff">${signOff}</p>
    ${facebookBlock}`;

  const rosy = `
    <h3>${title}</h3>
    <p><strong>Strålende forhold i hele Hakadal!</strong> ${share > 0.25 ? "Løypene er nykjørte og innbydende." : "Sporene ligger og venter på deg."}
      ${input.snowSinceLast >= 1 ? "Herlig nysnø!" : ""}</p>
    <ul class="areas">${areaRows.map((a) => row(a, true)).join("")}</ul>
    <p>${forecastLine} Perfekt skivær!</p>
    <p><strong>Smøretips:</strong> Det du har. Det går fint uansett!</p>
    <p class="signoff">Velkommen til Marka! 😊</p>
    ${facebookBlock}`;

  return { day, honest, rosy, headline };
}
