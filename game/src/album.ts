import { dayLabel, seasonName } from "./clock";
import { PostKind } from "./feed";
import { GameMap } from "./map";
import { OVERVIEW_PX } from "./overview";
import { LandscapeFields, PX, renderLandscape } from "./render";
import { TrackNetwork } from "./tracks";

/** A photo kept for the end-of-season album: the season's best liked, and where it was taken. */
export interface AlbumPhoto {
  x: number;
  y: number;
  day: number;
  kind: PostKind;
  author: string;
  text: string;
  likes: number;
  photo: string;
}

const ALBUM_SIZE = 8;
const PER_KIND = 2;

/** Add a photo if it is among the most liked, keeping a mix of kinds. */
export function keepInAlbum(album: AlbumPhoto[], photo: AlbumPhoto): AlbumPhoto[] {
  const picked: AlbumPhoto[] = [];
  for (const p of [...album, photo].sort((a, b) => b.likes - a.likes)) {
    if (picked.length < ALBUM_SIZE && picked.filter((q) => q.kind === p.kind).length < PER_KIND) {
      picked.push(p);
    }
  }
  return picked;
}

const VIEW_W = 1000;
const PHOTO_W = 200;
const PHOTO_H = 125;
/** Polaroid border: thin on three sides, wider at the bottom. */
const EDGE = 6;
const CHIN = 16;

/** Above this many tiles across, the album map comes from the overview instead of the detailed landscape. */
const DETAILED_UP_TO = 140;

/** The network on the winter map, cropped round the track; tile positions map into it. */
export function seasonMap(map: GameMap, overview: HTMLCanvasElement, fields: LandscapeFields, tracks: TrackNetwork, fallback: [number, number]) {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of tracks.each()) {
    [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x + 1), Math.max(y1, y + 1)];
  }
  if (x0 === Infinity) {
    [x0, y0, x1, y1] = [fallback[0] - 30, fallback[1] - 20, fallback[0] + 30, fallback[1] + 20];
  }
  const margin = 12;
  [x0, y0, x1, y1] = [x0 - margin, y0 - margin, x1 + margin, y1 + margin];
  // Keep the picture landscape-shaped: widen or heighten round the middle.
  const aspect = (y1 - y0) / (x1 - x0);
  if (aspect < 0.5) {
    const grow = ((x1 - x0) * 0.5 - (y1 - y0)) / 2;
    [y0, y1] = [y0 - grow, y1 + grow];
  } else if (aspect > 0.75) {
    const grow = ((y1 - y0) / 0.75 - (x1 - x0)) / 2;
    [x0, x1] = [x0 - grow, x1 + grow];
  }
  const shift = (lo: number, hi: number, max: number): [number, number] => {
    const span = Math.min(hi - lo, max);
    const start = Math.min(Math.max(0, lo), max - span);
    return [start, start + span];
  };
  [x0, x1] = shift(x0, x1, map.width);
  [y0, y1] = shift(y0, y1, map.height);
  const width = VIEW_W;
  const height = Math.round((width * (y1 - y0)) / (x1 - x0));
  const k = width / (x1 - x0);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  if (x1 - x0 <= DETAILED_UP_TO) {
    const rect = { x: Math.floor(x0), y: Math.floor(y0), w: Math.ceil(x1) - Math.floor(x0), h: Math.ceil(y1) - Math.floor(y0) };
    const land = renderLandscape(map, rect, fields);
    ctx.drawImage(land, (x0 - rect.x) * PX, (y0 - rect.y) * PX, (x1 - x0) * PX, (y1 - y0) * PX, 0, 0, width, height);
  } else {
    ctx.drawImage(overview, x0 * OVERVIEW_PX, y0 * OVERVIEW_PX, (x1 - x0) * OVERVIEW_PX, (y1 - y0) * OVERVIEW_PX, 0, 0, width, height);
  }
  const at = (x: number, y: number): [number, number] => [(x - x0) * k, (y - y0) * k];
  for (const [colour, w] of [["#ffffff", Math.max(4, k * 0.9)], ["#1f5fd1", Math.max(2.5, k * 0.5)]] as const) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = w;
    ctx.lineCap = "round";
    ctx.beginPath();
    for (const [x, y] of tracks.each()) {
      for (const [nx, ny] of tracks.neighbours(x, y)) {
        if (ny * 10000 + nx > y * 10000 + x) {
          ctx.moveTo(...at(x + 0.5, y + 0.5));
          ctx.lineTo(...at(nx + 0.5, ny + 0.5));
        }
      }
    }
    ctx.stroke();
  }
  const track = [...tracks.each()].map(([x, y]) => at(x + 0.5, y + 0.5));
  return { url: canvas.toDataURL("image/jpeg", 0.82), width, height, at, track };
}

const escape = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

interface Placed {
  i: number;
  p: AlbumPhoto;
  pin: [number, number];
  x: number;
  y: number;
}

/**
 * Most liked first, each photo takes the spot nearest its pin that covers no earlier photo and no
 * pin, and as little of the track as it can.
 */
function place(album: AlbumPhoto[], view: ReturnType<typeof seasonMap>): Placed[] {
  const w = PHOTO_W + EDGE * 2 + 12;
  const h = PHOTO_H + EDGE + CHIN + 12;
  const pins = album.map((p) => view.at(p.x, p.y));
  const overlap = (ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number) =>
    Math.max(0, (aw + bw) / 2 - Math.abs(ax - bx)) * Math.max(0, (ah + bh) / 2 - Math.abs(ay - by));
  const placed: Placed[] = [];
  for (const [i, p] of album.entries()) {
    const pin = pins[i];
    let best = { x: pin[0], y: pin[1], cost: Infinity };
    for (let ring = 1; ring <= 7; ring++) {
      for (let step = 0; step < 24; step++) {
        const angle = (step / 24) * Math.PI * 2;
        const x = Math.min(Math.max(pin[0] + Math.cos(angle) * ring * w * 0.32, w / 2), VIEW_W - w / 2);
        const y = Math.min(Math.max(pin[1] + Math.sin(angle) * ring * h * 0.32, h / 2), view.height - h / 2);
        let cost = Math.hypot(x - pin[0], y - pin[1]);
        for (const q of placed) {
          cost += overlap(x, y, w, h, q.x, q.y, w, h) * 2;
        }
        for (const q of pins) {
          cost += overlap(x, y, w, h, q[0], q[1], 24, 24) * 20;
        }
        for (const [tx, ty] of view.track) {
          cost += Math.abs(tx - x) < w / 2 && Math.abs(ty - y) < h / 2 ? 6 : 0;
        }
        if (cost < best.cost) {
          best = { x, y, cost };
        }
      }
    }
    placed.push({ i, p, pin, x: best.x, y: best.y });
  }
  return placed;
}

/** The season in pictures: each photo pinned to the map next to the spot it was taken. */
export function albumHtml(year: number, album: AlbumPhoto[], view: ReturnType<typeof seasonMap>): string {
  const placed = place(album, view);
  const strings = placed.map(({ pin, x, y }) => `<line x1="${pin[0]}" y1="${pin[1]}" x2="${x}" y2="${y}" class="string"/>`).join("");
  const photos = placed
    .map(({ i, p, x, y }) => {
      const tilt = ((i * 5) % 7) - 3;
      const [left, top] = [x - PHOTO_W / 2 - EDGE, y - (PHOTO_H + EDGE + CHIN) / 2];
      return `<g class="thumb" data-photo="${i}" transform="rotate(${tilt} ${x} ${y})">
          <rect x="${left}" y="${top}" width="${PHOTO_W + EDGE * 2}" height="${PHOTO_H + EDGE + CHIN}" rx="2" class="frame"/>
          <image href="${p.photo}" x="${left + EDGE}" y="${top + EDGE}" width="${PHOTO_W}" height="${PHOTO_H}" preserveAspectRatio="xMidYMid slice"/>
          <circle cx="${x}" cy="${top + 3}" r="5" class="tack"/>
        </g>`;
    })
    .join("");
  const svg = `<svg viewBox="0 0 ${VIEW_W} ${view.height}" class="album-map">
      <image href="${view.url}" x="0" y="0" width="${view.width}" height="${view.height}"/>
      ${strings}
      ${photos}
      ${placed.map(({ pin }) => `<circle cx="${pin[0]}" cy="${pin[1]}" r="7" class="pin"/>`).join("")}
    </svg>`;
  const captions = album
    .map((p, i) => `<figure data-zoom="${i}" hidden><img src="${p.photo}" alt=""><figcaption><strong>${escape(p.author)}</strong>, ${dayLabel(p.day)}: ${escape(p.text)} <small>👍❤️ ${p.likes}</small></figcaption></figure>`)
    .join("");
  return `
    <div class="head"><strong>📸 Sesongen i bilder · ${seasonName(year)}</strong></div>
    <p class="status">${album.length ? "Vinterens mest likte bilder fra gruppa, der de ble tatt. Klikk på et bilde for å se det større." : "Ingen bilder fra gruppa i år, men her er løypenettet."}</p>
    ${svg}
    ${captions}
    <p class="next"><button data-season="meeting">Til årsmøtet →</button></p>`;
}
