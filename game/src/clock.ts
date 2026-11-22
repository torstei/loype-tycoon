/** Real seconds per game hour at 1× speed: a game day lasts a minute. */
const SECONDS_PER_HOUR = 2.5;

export const SPEEDS = [1, 2, 4, 8];
export const SEASON_DAYS = 121;

const WEEKDAYS = ["søn", "man", "tir", "ons", "tor", "fre", "lør"];
const MONTHS: [string, number][] = [["des", 31], ["jan", 31], ["feb", 28], ["mar", 31]];
// 1 December 2026 is a Tuesday.
const FIRST_WEEKDAY = 2;

export class GameClock {
  /** Hours since 00:00 on 1 December. */
  hours = 20;
  speedIndex = 0;
  paused = false;

  get speed(): number {
    return SPEEDS[this.speedIndex];
  }

  get day(): number {
    return Math.floor(this.hours / 24);
  }

  get hourOfDay(): number {
    return this.hours % 24;
  }

  get seasonOver(): boolean {
    return this.day >= SEASON_DAYS;
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
  for (const [name, length] of MONTHS) {
    if (rest < length) {
      return `${WEEKDAYS[(FIRST_WEEKDAY + day) % 7]} ${rest + 1}. ${name}`;
    }
    rest -= length;
  }
  return "april";
}

export function weekday(day: number): string {
  return WEEKDAYS[(FIRST_WEEKDAY + day) % 7];
}

/** Sunrise and sunset near Oslo, from the winter solstice (day 20) towards the end of March. */
export function sunTimes(day: number): { sunrise: number; sunset: number } {
  const fromSolstice = Math.min(1, Math.max(0, Math.abs(day - 20) / 100));
  const k = (1 - Math.cos(Math.PI * fromSolstice)) / 2;
  return { sunrise: 9.3 - k * 3.1, sunset: 15.3 + k * 3.7 };
}
