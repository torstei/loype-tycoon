import { MAX_SEASON_DAYS } from "./clock";

/** Elevation the weather figures refer to; the valley floor at Hakadal. */
export const REFERENCE_ELEVATION = 200;
const LAPSE_RATE = 0.0065;
/** The second snowpack, about the height of Varingskollen: colder, so more snow and a later melt. */
export const HIGH_ELEVATION = 500;
const HIGH_START_EXTRA = 15;

export interface DayPlan {
  /** Daily mean temperature at the reference elevation. */
  mean: number;
  /** Precipitation in mm water, falling between start and start + hours. */
  precip: number;
  start: number;
  hours: number;
  wind: number;
}

export interface Forecast {
  day: number;
  high: number;
  low: number;
  precip: number;
  kind: "sol" | "skyet" | "snø" | "regn" | "sludd";
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Climatological mean for the day: coldest around 20 January, then spring through April and May. */
function normalMean(day: number): number {
  return -1.5 - 5 * Math.sin(Math.PI * Math.min(1, Math.max(0, (day + 8) / 128))) + Math.max(0, day - 120) * 0.19;
}

const spring = (day: number) => Math.min(1, Math.max(0, (day - 80) / 50));

/** One step of a snowpack at temperature `temp` with `p` mm falling; `sun` is 0–1 for a clear spring midday. */
function settle(depth: number, temp: number, p: number, dt: number, day: number, sun: number): number {
  let d = depth;
  if (temp < 0.8) {
    d += p;
  } else {
    d -= p * 0.3;
  }
  if (temp > 0) {
    d -= temp * (0.04 + 0.08 * spring(day)) * dt;
  }
  if (temp > -5) {
    d -= sun * 0.6 * spring(day) * dt;
  }
  d -= d * 0.0008 * dt;
  return Math.max(0, d);
}

const FORECASTERS = [
  "Tante Ragnhild kjenner det i kneet",
  "Værhanen på låven peker",
  "Meteorologisk Tippekupong melder",
  "Gubben på Sagstua sier",
  "Elgen ser bekymret ut, så",
];

export class Weather {
  /** Snow depth at the reference elevation, cm. */
  snowDepth: number;
  /** Snow depth at HIGH_ELEVATION, cm. */
  highDepth: number;
  temperature = 0;
  /** mm/h falling right now; negative never. */
  precipRate = 0;
  wind = 0;
  private readonly plans: DayPlan[] = [];
  private readonly random: () => number;
  private anomaly = 0;

  constructor(
    seed = 2026,
    private readonly warming = 0,
  ) {
    this.random = rng(seed);
    this.snowDepth = 20 + this.random() * 15;
    this.highDepth = this.snowDepth + HIGH_START_EXTRA;
    for (let d = 0; d < MAX_SEASON_DAYS + 5; d++) {
      this.plans.push(this.planDay(d));
    }
  }

  private gauss(): number {
    return Math.sqrt(-2 * Math.log(1 - this.random())) * Math.cos(2 * Math.PI * this.random());
  }

  private planDay(day: number): DayPlan {
    this.anomaly = 0.75 * this.anomaly + this.gauss() * 2.2;
    const wet = this.random() < 0.38;
    return {
      mean: normalMean(day) + this.anomaly + this.warming,
      precip: wet ? -Math.log(1 - this.random()) * 7 : 0,
      start: Math.floor(this.random() * 20),
      hours: 3 + Math.floor(this.random() * 10),
      wind: Math.max(0, this.gauss() * 4 + 3),
    };
  }

  /** The whole season's weather, for a saved game: the rest of the season stays as it was. */
  allPlans(): DayPlan[] {
    return this.plans.map((p) => ({ ...p }));
  }

  /** Take over a saved season's weather and snowpack at an absolute game hour. */
  restore(plans: DayPlan[], snowDepth: number, now: number, highDepth = snowDepth + HIGH_START_EXTRA) {
    this.plans.splice(0, this.plans.length, ...plans.map((p) => ({ ...p })));
    this.snowDepth = snowDepth;
    this.highDepth = highDepth;
    this.temperature = this.temperatureAt(now);
    this.precipRate = this.precipRateAt(now);
    this.wind = this.plan(Math.floor(now / 24)).wind;
  }

  plan(day: number): DayPlan {
    return this.plans[Math.min(this.plans.length - 1, Math.max(0, day))];
  }

  /** Temperature at the reference elevation at an absolute game hour. */
  temperatureAt(hours: number): number {
    const day = Math.floor(hours / 24);
    const h = hours % 24;
    const today = this.plan(day);
    const next = this.plan(day + 1);
    // Fronts arrive gradually: blend towards tomorrow through the evening.
    const blend = Math.max(0, (h - 16) / 8);
    const mean = today.mean * (1 - blend) + next.mean * blend;
    const diurnal = -Math.cos(((h - 3) / 24) * 2 * Math.PI) * 2.5;
    const cloudDamping = this.precipRateAt(hours) > 0 ? 0.3 : 1;
    return mean + diurnal * cloudDamping;
  }

  precipRateAt(hours: number): number {
    const day = Math.floor(hours / 24);
    const h = hours % 24;
    const p = this.plan(day);
    return p.precip > 0 && h >= p.start && h < p.start + p.hours ? p.precip / p.hours : 0;
  }

  localTemperature(elevation: number): number {
    return this.temperature - (elevation - REFERENCE_ELEVATION) * LAPSE_RATE;
  }

  snowDepthAt(elevation: number): number {
    const k = (elevation - REFERENCE_ELEVATION) / (HIGH_ELEVATION - REFERENCE_ELEVATION);
    return Math.max(0, this.snowDepth + (this.highDepth - this.snowDepth) * k);
  }

  /** Advance the snowpack. Returns snowfall (cm) and rain (mm) at the reference elevation. */
  advance(fromHours: number, hours: number): { snow: number; rain: number } {
    let snow = 0;
    let rain = 0;
    const steps = Math.max(1, Math.ceil(hours / 0.25));
    const dt = hours / steps;
    for (let i = 0; i < steps; i++) {
      const t = fromHours + i * dt;
      const temp = this.temperatureAt(t);
      const rate = this.precipRateAt(t);
      const p = rate * dt;
      if (temp < 0.8) {
        snow += p;
      } else {
        rain += p;
      }
      const h = t % 24;
      const sun = rate > 0 ? 0 : Math.max(0, Math.sin(((h - 7) / 12) * Math.PI));
      const day = Math.floor(t / 24);
      this.snowDepth = settle(this.snowDepth, temp, p, dt, day, sun);
      this.highDepth = settle(this.highDepth, temp - (HIGH_ELEVATION - REFERENCE_ELEVATION) * LAPSE_RATE, p, dt, day, sun);
    }
    const now = fromHours + hours;
    this.temperature = this.temperatureAt(now);
    this.precipRate = this.precipRateAt(now);
    this.wind = this.plan(Math.floor(now / 24)).wind;
    return { snow, rain };
  }

  /** What the forecaster believes; less reliable the further ahead it looks. */
  forecast(today: number, days = 3): Forecast[] {
    const out: Forecast[] = [];
    for (let d = today; d < today + days; d++) {
      const lead = d - today;
      const p = this.plan(d);
      const noise = (k: number) => Math.sin(d * 12.9898 + k * 78.233) * 43758.5453 % 1;
      const mean = p.mean + noise(1) * lead * 1.5;
      const precip = Math.max(0, p.precip + noise(2) * lead * 3);
      const kind: Forecast["kind"] =
        precip < 1 ? (noise(3) > 0 ? "sol" : "skyet") : mean < -0.5 ? "snø" : mean > 1.5 ? "regn" : "sludd";
      out.push({ day: d, high: Math.round(mean + 2.5), low: Math.round(mean - 2.5), precip: Math.round(precip), kind });
    }
    return out;
  }

  /** One line of folk wisdom about tomorrow. */
  saying(today: number): string {
    const [, tomorrow] = this.forecast(today, 2);
    const who = FORECASTERS[today % FORECASTERS.length];
    const what = {
      sol: "sol og blåvoks i morra",
      skyet: "grått, men greit",
      snø: `${tomorrow.precip} cm nysnø — fyll tanken på løypemaskina`,
      regn: "regn. Klister. Fortvilelse.",
      sludd: "sludd. Ingen vet hva man skal smøre med.",
    }[tomorrow.kind];
    return `${who}: ${what}`;
  }
}

export const WEATHER_ICON: Record<Forecast["kind"], string> = {
  sol: "☀️",
  skyet: "☁️",
  snø: "🌨️",
  regn: "🌧️",
  sludd: "🌨️🌧️",
};
