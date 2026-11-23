import { Container, Graphics, Text } from "pixi.js";
import { isWeekend } from "./clock";
import { PX } from "./render";

export interface KioskTier {
  name: string;
  short: string;
  price: number;
  pitch: string;
  /** Waffles it can turn out in a day. */
  capacity: number;
  /** What a skier pays, and what the batter, jam and sour cream cost the club. */
  salePrice: number;
  ingredients: number;
  /** Chance a skier passing by stops for one. */
  appeal: number;
  /** Extra skiers drawn to the area, as a share of the usual turnout. */
  draw: number;
  open: [number, number];
  weekendsOnly: boolean;
  /** Paid every day the stand exists, open or not. */
  dailyCost: number;
  /** Chance per day that it will not work tomorrow. */
  breakdown: number;
}

export const KIOSK_TIERS: KioskTier[] = [
  {
    name: "Termos og vaffeljern på et bord",
    short: "Vaffelbord",
    price: 1_500,
    pitch: "Et campingbord, et vaffeljern på skjøteledning og en dugnadsvakt i helgene. Ekte vare.",
    capacity: 40,
    salePrice: 25,
    ingredients: 8,
    appeal: 0.25,
    draw: 0.02,
    open: [10, 15],
    weekendsOnly: true,
    dailyCost: 0,
    breakdown: 0,
  },
  {
    name: "Vaffelbu med gassbrenner",
    short: "Vaffelbu",
    price: 20_000,
    pitch: "Et lite skur med luke, to vaffeljern og en gassbrenner. Åpent hver dag så lenge det er lyst.",
    capacity: 120,
    salePrice: 30,
    ingredients: 8,
    appeal: 0.35,
    draw: 0.06,
    open: [10, 16],
    weekendsOnly: false,
    dailyCost: 0,
    breakdown: 0,
  },
  {
    name: "Kiosk med kaffetrakter, bålpanne og benker",
    short: "Kiosk",
    price: 80_000,
    pitch: "Brunost, rømme, kaffe fra trakteren og bål i panna. Folk blir sittende, og de kommer igjen.",
    capacity: 300,
    salePrice: 35,
    ingredients: 9,
    appeal: 0.45,
    draw: 0.12,
    open: [9, 19],
    weekendsOnly: false,
    dailyCost: 0,
    breakdown: 0,
  },
  {
    name: "Vaffel-O-Matic 3000",
    short: "Vaffel-O-Matic",
    price: 220_000,
    pitch: "Helautomatisk vaffelanlegg med røresilo, transportbånd og LED-skilt. Åpent til sent. Trenger mye strøm, og sjelden, men av og til, en tekniker.",
    capacity: 2_000,
    salePrice: 45,
    ingredients: 10,
    appeal: 0.55,
    draw: 0.2,
    open: [8, 22],
    weekendsOnly: false,
    dailyCost: 600,
    breakdown: 0.12,
  },
];

/**
 * An agreement with Nittedal Skytterlag: their best waffle makers staff the stand at weekends.
 * More waffles, a faster queue, and waffles good enough that people pay a little extra.
 */
export const EXPERTS = {
  name: "Vaffeleksperter fra Nittedal Skytterlag",
  pitch: "Skytterlaget stiller med sine beste vaffelsteikere hver lørdag og søndag. Treffsikre på røra, jevnt stekt, aldri brent. Flere vafler, kortere kø, og folk betaler gjerne litt ekstra for skyttervafler.",
  price: 15_000,
  /** Not at a camping table: they need at least the booth. */
  minTier: 1,
  capacity: 1.5,
  appeal: 1.3,
  extraPrice: 5,
};

/** How close, in tiles, a skier must pass to smell the waffles. */
export const KIOSK_REACH = 3;
/** However many stands there are, they draw at most this much extra turnout. */
const MAX_DRAW = 0.3;

export class Kiosk {
  readonly sprite = new Container();
  soldToday = 0;
  /** Out of order for the current day. */
  broken = false;
  /** Nittedal Skytterlag helps out at weekends. */
  experts = false;

  constructor(
    /** The garage it stands beside. */
    readonly x: number,
    readonly y: number,
    public tier: number,
  ) {
    this.sprite.position.set((x + 2.4) * PX, (y + 0.4) * PX);
    this.sprite.scale.set(1.35);
    this.redraw();
  }

  get spec(): KioskTier {
    return KIOSK_TIERS[this.tier];
  }

  /** Where the stand's counter is, in tiles: sales are measured from here. */
  get spot(): [number, number] {
    return [this.x + 2, this.y];
  }

  isOpen(day: number, hourOfDay: number): boolean {
    const [from, to] = this.spec.open;
    return !this.broken && hourOfDay >= from && hourOfDay < to && (!this.spec.weekendsOnly || isWeekend(day));
  }

  /** The waffle experts are on duty: the stand has the agreement and it is the weekend. */
  expertsOn(day: number): boolean {
    return this.experts && isWeekend(day);
  }

  capacityOn(day: number): number {
    return Math.round(this.spec.capacity * (this.expertsOn(day) ? EXPERTS.capacity : 1));
  }

  appealOn(day: number): number {
    return this.spec.appeal * (this.expertsOn(day) ? EXPERTS.appeal : 1);
  }

  salePriceOn(day: number): number {
    return this.spec.salePrice + (this.expertsOn(day) ? EXPERTS.extraPrice : 0);
  }

  hasWaffles(day: number): boolean {
    return this.soldToday < this.capacityOn(day);
  }

  hireExperts() {
    this.experts = true;
    this.redraw();
  }

  upgrade(tier: number) {
    this.tier = tier;
    this.redraw();
  }

  redraw() {
    this.sprite.removeChildren().forEach((c) => c.destroy({ children: true }));
    const g = new Graphics();
    const s = PX;
    g.ellipse(0, s * 0.55, s * (0.7 + this.tier * 0.2), s * 0.18).fill({ color: 0x3c548c, alpha: 0.22 });
    if (this.tier === 0) {
      g.rect(-s * 0.5, -s * 0.05, s, s * 0.12).fill(0xd94b3d).stroke({ width: 0.6, color: 0x7a2a22 });
      for (let i = 0; i < 4; i++) {
        g.rect(-s * 0.5 + i * s * 0.25, -s * 0.05, s * 0.125, s * 0.12).fill(0xffffff);
      }
      g.moveTo(-s * 0.4, s * 0.07).lineTo(-s * 0.45, s * 0.5).moveTo(s * 0.4, s * 0.07).lineTo(s * 0.45, s * 0.5).stroke({ width: 1, color: 0x6b6b6b });
      g.roundRect(-s * 0.15, -s * 0.22, s * 0.3, s * 0.17, 2).fill(0x4a4a4a);
      g.rect(s * 0.25, -s * 0.32, s * 0.1, s * 0.27).fill(0xc7372f);
    } else if (this.tier === 1) {
      g.rect(-s * 0.55, -s * 0.45, s * 1.1, s * 0.95).fill(0xb07a4a).stroke({ width: 1, color: 0x5a3a20 });
      g.rect(-s * 0.4, -s * 0.25, s * 0.8, s * 0.35).fill(0x2a1c14).stroke({ width: 0.8, color: 0xffe3a3 });
      g.poly([-s * 0.7, -s * 0.45, 0, -s * 0.85, s * 0.7, -s * 0.45]).fill(0xfbfdff).stroke({ width: 1, color: 0x5b6270, join: "round" });
    } else if (this.tier === 2) {
      g.rect(-s * 0.8, -s * 0.5, s * 1.6, s * 1.0).fill(0x2f6a4c).stroke({ width: 1, color: 0x173a28 });
      g.rect(-s * 0.6, -s * 0.3, s * 1.2, s * 0.38).fill(0x2a1c14).stroke({ width: 0.8, color: 0xffe3a3 });
      g.poly([-s * 0.95, -s * 0.5, 0, -s * 0.95, s * 0.95, -s * 0.5]).fill(0xfbfdff).stroke({ width: 1, color: 0x5b6270, join: "round" });
      g.rect(-s * 1.3, s * 0.3, s * 0.4, s * 0.1).fill(0x8a5a30);
      g.rect(s * 0.9, s * 0.3, s * 0.4, s * 0.1).fill(0x8a5a30);
      g.circle(s * 1.55, s * 0.35, s * 0.16).fill(0x3a3a3a);
      g.circle(s * 1.55, s * 0.28, s * 0.09).fill(0xf28c28);
    } else {
      g.roundRect(-s * 1.0, -s * 0.6, s * 2.0, s * 1.1, 3).fill(0xc9d1db).stroke({ width: 1.2, color: 0x56606e });
      g.rect(-s * 0.8, -s * 0.35, s * 1.6, s * 0.25).fill(0x1f2a36);
      for (let i = 0; i < 6; i++) {
        g.circle(-s * 0.7 + i * s * 0.28, -s * 0.22, s * 0.06).fill(i % 2 ? 0xff4fa3 : 0x4fe0ff);
      }
      g.rect(-s * 0.9, s * 0.05, s * 1.8, s * 0.12).fill(0x3a3a3a);
      for (let i = 0; i < 5; i++) {
        g.roundRect(-s * 0.8 + i * s * 0.36, s * 0.0, s * 0.24, s * 0.08, 1).fill(0xe0a64a);
      }
      g.rect(s * 0.55, -s * 1.15, s * 0.22, s * 0.55).fill(0x9aa3ad).stroke({ width: 0.8, color: 0x56606e });
      g.rect(-s * 0.85, -s * 1.0, s * 0.45, s * 0.4).fill(0xf2f2f2).stroke({ width: 0.8, color: 0x56606e });
    }
    const sign = new Text({ text: "🧇", style: { fontSize: 9 + this.tier * 2 }, resolution: 4 });
    sign.anchor.set(0.5, 1);
    sign.position.set(0, -s * (this.tier === 0 ? 0.3 : this.tier === 3 ? 1.15 : 0.85));
    this.sprite.addChild(g, sign);
    if (this.experts) {
      const badge = new Text({ text: "🎯", style: { fontSize: 8 }, resolution: 4 });
      badge.anchor.set(0, 1);
      badge.position.set(sign.width / 2 - 1, sign.y - sign.height * 0.45);
      this.sprite.addChild(badge);
    }
  }
}

/** Extra turnout from all the club's stands together. */
export function kioskDraw(kiosks: Kiosk[]): number {
  return Math.min(MAX_DRAW, kiosks.reduce((sum, k) => sum + k.spec.draw, 0));
}

/** Cold days sell more waffles; mild ones fewer. */
export function coldAppetite(temperature: number): number {
  return temperature < -8 ? 1.35 : temperature < -3 ? 1.15 : temperature > 1 ? 0.75 : 1;
}
