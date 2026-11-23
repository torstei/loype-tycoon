const kr = (n: number) => `${Math.round(n).toLocaleString("nb-NO")} kr`;

/** Where the club's money came from and went in one day. Built is everything bought: track, crossings, buildings. */
export interface DayAccount {
  donations: number;
  members: number;
  waffles: number;
  rooms: number;
  diesel: number;
  power: number;
  built: number;
}

export const emptyAccount = (): DayAccount => ({ donations: 0, members: 0, waffles: 0, rooms: 0, diesel: 0, power: 0, built: 0 });

const add = (rows: DayAccount[]): DayAccount =>
  rows.reduce((s, r) => {
    for (const k of Object.keys(s) as (keyof DayAccount)[]) {
      s[k] += r[k];
    }
    return s;
  }, emptyAccount());

export interface AccountsFacts {
  km: number;
  dieselPerKm: number;
  connected: number;
  skiersThisSeason: number;
}

const money = (n: number, sign: 1 | -1) => (n === 0 ? `<span class="zero">–</span>` : `<span class="${sign > 0 ? "plus" : "minus"}">${sign > 0 ? "+" : "−"}${kr(n)}</span>`);
const total = (n: number) => `<strong class="${n >= 0 ? "plus" : "minus"}">${n >= 0 ? "+" : "−"}${kr(Math.abs(n))}</strong>`;

/** The account: today so far, the last seven finished days and the season, with what drives the numbers. */
export function accountsHtml(finished: DayAccount[], today: DayAccount, facts: AccountsFacts): string {
  const cols = [today, add(finished.slice(-7)), add([...finished, today])];
  const income = (a: DayAccount) => a.donations + a.members + a.waffles + a.rooms;
  const running = (a: DayAccount) => a.diesel + a.power;
  const row = (label: string, f: (a: DayAccount) => string, cls = "") => `<tr class="${cls}"><th>${label}</th>${cols.map((a) => `<td>${f(a)}</td>`).join("")}</tr>`;
  const season = cols[2];
  const perSkier = facts.skiersThisSeason > 0 ? (season.donations + season.members) / facts.skiersThisSeason : 0;
  const net = income(season) - running(season);
  const fullGroom = facts.km * facts.dieselPerKm;
  return `
    <div class="head"><strong>📒 Regnskap</strong><button data-accounts="close">✕</button></div>
    <table>
      <tr class="cols"><th></th><td>I dag</td><td>Siste 7 dager</td><td>Sesongen</td></tr>
      ${row("Vipps", (a) => money(a.donations, 1))}
      ${row("Medlemskap", (a) => money(a.members, 1))}
      ${row("Vafler", (a) => money(a.waffles, 1))}
      ${row("Overnatting", (a) => money(a.rooms, 1))}
      ${row("Diesel", (a) => money(a.diesel, -1))}
      ${row("Drift av hytter og vaffelbuer", (a) => money(a.power, -1))}
      ${row("Driftsresultat", (a) => total(income(a) - running(a)), "sum")}
      ${row("Bygget og kjøpt", (a) => money(a.built, -1))}
      ${row("Endring i kassa", (a) => total(income(a) - running(a) - a.built), "sum")}
    </table>
    <ul class="facts">
      <li>⛽ Diesel koster ${kr(facts.dieselPerKm)} per km hver gang løypa preppes: ${kr(fullGroom)} for hele nettet på ${facts.km.toFixed(1).replace(".", ",")} km.</li>
      <li>⛷ Skiløperne kommer fra ${facts.connected} ${facts.connected === 1 ? "sted" : "steder"}: stasjoner, parkeringer og boligfelt løypa når fram til. Hvert hus innen 300 m fra løypa gir skiløpere, og et lengre løypenett lokker flere, særlig dem som kommer med tog og bil.</li>
      ${perSkier > 0 ? `<li>📱 Hver skiløper har gitt ${perSkier.toFixed(2).replace(".", ",")} kr i snitt i Vipps og medlemskap denne sesongen.</li>` : ""}
      ${net < 0 && finished.length >= 7 ? `<li class="warn">Driften går i minus. Vafler er den sikreste inntekten: en vaffelbu ved garasjen eller ei hytte langs løypa.</li>` : ""}
    </ul>`;
}
