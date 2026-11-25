/** Real seconds per game hour at 1× speed: slow enough to watch a skier finish a trip. */
const SECONDS_PER_HOUR = 12;

export const SPEEDS = [1, 2, 4, 8, 16];
/** 1 December to 31 May: no winter in the lowlands of Norway lasts longer. */
export const MAX_SEASON_DAYS = 182;
/** Before 1 March a thaw is only a thaw; after it, snow gone from the tracks ends the season. */
export const EARLIEST_SEASON_END = 90;

const WEEKDAYS = ["søn", "man", "tir", "ons", "tor", "fre", "lør"];

/** The calendar of the winter that starts on 1 December of `year`. */
interface SeasonCalendar {
  year: number;
  firstWeekday: number;
  months: [string, number][];
  winterBreak: number;
  easter: number;
}

const DAY_MS = 86_400_000;
const sinceDecember = (year: number, date: Date) => Math.round((date.getTime() - Date.UTC(year, 11, 1)) / DAY_MS);

function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

/** Monday of ISO week `week`. */
function isoWeekMonday(year: number, week: number): Date {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday = jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * DAY_MS;
  return new Date(monday + (week - 1) * 7 * DAY_MS);
}

function calendarFor(year: number): SeasonCalendar {
  const next = year + 1;
  const leap = (next % 4 === 0 && next % 100 !== 0) || next % 400 === 0;
  return {
    year,
    firstWeekday: new Date(Date.UTC(year, 11, 1)).getUTCDay(),
    months: [["des", 31], ["jan", 31], ["feb", leap ? 29 : 28], ["mar", 31], ["apr", 30], ["mai", 31]],
    winterBreak: sinceDecember(year, isoWeekMonday(next, 8)),
    easter: sinceDecember(year, easterSunday(next)),
  };
}

export const FIRST_SEASON = 2026;
let cal = calendarFor(FIRST_SEASON);

/** Switch every date in the game to the winter starting 1 December `year`. */
export function setSeason(year: number) {
  cal = calendarFor(year);
}

/** "2026/27" */
export function seasonName(year = cal.year): string {
  return `${year}/${String((year + 1) % 100).padStart(2, "0")}`;
}

export function seasonYear(): number {
  return cal.year;
}

export class GameClock {
  /** Hours since 00:00 on 1 December. */
  hours = 20;
  speedIndex = 0;
  paused = false;
  /** Game hours per real hour while something slows the game below 1× (the live view); null otherwise. */
  slowMotion: number | null = null;

  get speed(): number {
    return this.slowMotion !== null ? (this.slowMotion * SECONDS_PER_HOUR) / 3600 : SPEEDS[this.speedIndex];
  }

  get day(): number {
    return Math.floor(this.hours / 24);
  }

  get hourOfDay(): number {
    return this.hours % 24;
  }

  /** Set when the snow is gone from the tracks; time stands still until the next season. */
  ended = false;

  get seasonOver(): boolean {
    return this.ended || this.day >= MAX_SEASON_DAYS;
  }

  /** Advance by real seconds; returns the game hours that passed. */
  tick(realSeconds: number): number {
    if (this.paused || this.seasonOver) {
      return 0;
    }
    const h = (realSeconds / SECONDS_PER_HOUR) * this.speed;
    this.hours += h;
    return h;
  }

  /** "ons 2. des 21:30" */
  label(): string {
    const d = dayLabel(this.day);
    const h = Math.floor(this.hourOfDay);
    const m = Math.floor((this.hourOfDay - h) * 60 / 15) * 15;
    return `${d} ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  /** 0 at night, 1 in daylight, with an hour of twilight either side. */
  daylight(): number {
    const { sunrise, sunset } = sunTimes(this.day);
    const h = this.hourOfDay;
    return Math.max(0, Math.min(1, h - sunrise + 0.5, sunset - h + 0.5));
  }
}

export function dayLabel(day: number): string {
  let rest = day;
  for (const [name, length] of cal.months) {
    if (rest < length) {
      return `${weekday(day)} ${rest + 1}. ${name}`;
    }
    rest -= length;
  }
  return "juni";
}

export function weekday(day: number): string {
  return WEEKDAYS[(cal.firstWeekday + day) % 7];
}

/** Sunrise and sunset near Oslo, from the winter solstice (day 20) into May. */
export function sunTimes(day: number): { sunrise: number; sunset: number } {
  const fromSolstice = Math.min(1, Math.max(0, Math.abs(day - 20) / 100));
  const k = (1 - Math.cos(Math.PI * fromSolstice)) / 2;
  const spring = Math.max(0, day - 120);
  return { sunrise: 9.3 - k * 3.1 - spring * 0.03, sunset: 15.3 + k * 3.7 + spring * 0.04 };
}

/** How much busier than a normal day of that weekday: holidays and the odd local custom. */
export function holiday(day: number): { factor: number; name: string | null } {
  if (day >= 23 && day <= 31) {
    return { factor: 1.8, name: "juleferie" };
  }
  if (day >= cal.winterBreak - 2 && day <= cal.winterBreak + 6) {
    return { factor: 2, name: "vinterferie" };
  }
  if (day >= cal.easter - 7 && day <= cal.easter + 1) {
    return { factor: 0.7, name: "påske (alle er på fjellet)" };
  }
  return { factor: 1, name: null };
}

export function isWeekend(day: number): boolean {
  const d = (cal.firstWeekday + day) % 7;
  return d === 0 || d === 6;
}
