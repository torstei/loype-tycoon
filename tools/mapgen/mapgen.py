"""Generate a Løype Tycoon tile map from OpenStreetMap and Kartverket elevation data.

    python tools/mapgen/mapgen.py hakadal

Downloads are cached under tools/mapgen/cache/, so re-running only re-rasterises.
"""

import argparse
import json
import math
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import requests
import rasterio
from PIL import Image
from pyproj import Transformer
from rasterio.features import rasterize
from rasterio.transform import from_origin
from shapely.geometry import LineString, Point, Polygon, box, mapping
import shapely
from shapely.ops import linemerge, polygonize, unary_union

ROOT = Path(__file__).resolve().parents[2]
CACHE = Path(__file__).resolve().parent / "cache"
USER_AGENT = "skitrailsim-mapgen/0.1"

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]
DTM_WCS = "https://wcs.geonorge.no/skwms1/wcs.hoyde-dtm-nhm-25833"
CRS = "EPSG:25833"


@dataclass(frozen=True)
class Region:
    name: str
    title: str
    min_x: float
    min_y: float
    size_m: int
    tile_m: int

    @property
    def tiles(self):
        return self.size_m // self.tile_m


REGIONS = {
    "hakadal": Region("hakadal", "Hakadal", 265400, 6667900, 5000, 25),
}

# Terrain ids are shared with the game (game/src/terrain.ts); keep the two in sync.
FOREST, OPEN, FARMLAND, BOG, WATER, BUILT, ROCK = 0, 1, 2, 3, 4, 5, 6

# Linear features sit on top of terrain as bit flags.
ROAD, FOREST_ROAD, RAIL, PATH, STREAM, PISTE, BUILDING = (1 << i for i in range(7))

LANDCOVER_RULES = [
    (OPEN, {"landuse": {"meadow", "grass", "recreation_ground", "village_green"},
            "natural": {"grassland", "heath", "scrub", "fell"},
            "leisure": {"park", "golf_course", "pitch", "sports_centre"}}),
    (FARMLAND, {"landuse": {"farmland", "farmyard", "orchard", "allotments"}}),
    (BUILT, {"landuse": {"residential", "industrial", "commercial", "retail", "construction",
                         "railway", "cemetery", "garages"}}),
    (ROCK, {"natural": {"bare_rock", "scree", "sand"}, "landuse": {"quarry", "landfill"}}),
    (BOG, {"natural": {"wetland"}}),
    (WATER, {"natural": {"water"}, "landuse": {"reservoir", "basin"}, "waterway": {"riverbank"}}),
]

MAJOR_HIGHWAYS = {"motorway", "trunk", "primary", "secondary", "tertiary", "unclassified",
                  "residential", "service", "living_street",
                  "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link"}


def overpass_query(bbox_ll):
    s, w, n, e = bbox_ll
    bb = f"({s},{w},{n},{e})"
    return f"""[out:json][timeout:180];
(
  way["natural"]{bb}; relation["natural"]{bb};
  way["landuse"]{bb}; relation["landuse"]{bb};
  way["leisure"]{bb}; relation["leisure"]{bb};
  way["waterway"]{bb}; relation["waterway"="riverbank"]{bb};
  way["highway"]{bb};
  way["railway"="rail"]{bb};
  way["building"]{bb};
  way["piste:type"="nordic"]{bb}; relation["piste:type"="nordic"]{bb};
  node["railway"~"^(station|halt)$"]{bb};
  node["amenity"="parking"]{bb}; way["amenity"="parking"]{bb};
  node["natural"="peak"]{bb};
  node["place"~"^(village|hamlet|suburb|neighbourhood|locality)$"]{bb};
);
out geom;"""


def fetch_osm(region, bbox_ll):
    path = CACHE / f"{region.name}-osm.json"
    if path.exists():
        return json.loads(path.read_text())
    query = overpass_query(bbox_ll)
    delay = 5
    for attempt in range(8):
        endpoint = OVERPASS_ENDPOINTS[attempt % len(OVERPASS_ENDPOINTS)]
        print(f"  overpass: {endpoint} (attempt {attempt + 1})", file=sys.stderr)
        try:
            r = requests.post(endpoint, data={"data": query},
                              headers={"User-Agent": USER_AGENT}, timeout=240)
            if r.status_code == 200 and r.text.lstrip().startswith("{"):
                data = r.json()
                path.write_text(json.dumps(data))
                return data
            print(f"    HTTP {r.status_code}", file=sys.stderr)
        except requests.RequestException as exc:
            print(f"    {type(exc).__name__}", file=sys.stderr)
        time.sleep(delay)
        delay = min(delay * 2, 60)
    sys.exit("overpass: every endpoint failed; try again later")


def fetch_dtm(region):
    path = CACHE / f"{region.name}-dtm-{region.tile_m}m.tif"
    if not path.exists():
        n = region.tiles
        params = {
            "service": "WCS", "version": "1.0.0", "request": "GetCoverage",
            "coverage": "nhm_dtm_topo_25833", "crs": CRS, "format": "GeoTIFF",
            "bbox": f"{region.min_x},{region.min_y},"
                    f"{region.min_x + region.size_m},{region.min_y + region.size_m}",
            "width": n, "height": n,
        }
        print("  kartverket: DTM", file=sys.stderr)
        r = requests.get(DTM_WCS, params=params, headers={"User-Agent": USER_AGENT}, timeout=120)
        r.raise_for_status()
        if not r.headers.get("content-type", "").startswith("image/tiff"):
            sys.exit(f"kartverket: unexpected response {r.headers.get('content-type')}")
        path.write_bytes(r.content)
    with rasterio.open(path) as src:
        return src.read(1).astype(np.float32)


def way_line(el):
    return LineString([(p["lon"], p["lat"]) for p in el["geometry"]])


def way_polygon(el):
    pts = [(p["lon"], p["lat"]) for p in el["geometry"]]
    if len(pts) < 4 or pts[0] != pts[-1]:
        return None
    poly = Polygon(pts)
    return poly if poly.is_valid else poly.buffer(0)


def relation_polygon(el):
    rings = {"outer": [], "inner": []}
    for m in el.get("members", []):
        if m.get("type") == "way" and "geometry" in m:
            role = "inner" if m.get("role") == "inner" else "outer"
            rings[role].append(LineString([(p["lon"], p["lat"]) for p in m["geometry"]]))
    if not rings["outer"]:
        return None
    outer = unary_union(list(polygonize(linemerge(rings["outer"]))))
    if rings["inner"]:
        outer = outer.difference(unary_union(list(polygonize(linemerge(rings["inner"])))))
    return None if outer.is_empty else outer


def element_area(el):
    if el["type"] == "way":
        return way_polygon(el)
    if el["type"] == "relation":
        return relation_polygon(el)
    return None


def matches(tags, rule):
    return any(tags.get(k) in values for k, values in rule.items())


def build_layers(region, osm):
    to_utm = Transformer.from_crs("EPSG:4326", CRS, always_xy=True).transform
    n = region.tiles
    transform = from_origin(region.min_x, region.min_y + region.size_m, region.tile_m, region.tile_m)
    clip = box(region.min_x, region.min_y, region.min_x + region.size_m, region.min_y + region.size_m)

    def utm(geom):
        g = shapely.transform(geom, to_utm, interleaved=False)
        return g.intersection(clip)

    terrain = np.full((n, n), FOREST, dtype=np.uint8)
    flags = np.zeros((n, n), dtype=np.uint16)
    areas = {cls: [] for cls, _ in LANDCOVER_RULES}
    lines = {f: [] for f in (ROAD, FOREST_ROAD, RAIL, PATH, STREAM, PISTE)}
    buildings = []
    pois = []

    for el in osm["elements"]:
        tags = el.get("tags", {})
        if el["type"] == "node":
            pois.append(poi(el, tags, to_utm, region))
            continue
        if "building" in tags:
            g = element_area(el)
            if g is not None:
                buildings.append(utm(g))
            continue
        for cls, rule in LANDCOVER_RULES:
            if matches(tags, rule):
                g = element_area(el)
                if g is not None:
                    areas[cls].append(utm(g))
                break
        if el["type"] != "way":
            if tags.get("piste:type") == "nordic":
                for m in el.get("members", []):
                    if m.get("type") == "way" and "geometry" in m:
                        lines[PISTE].append(utm(way_line(m)))
            continue
        line = None
        hw = tags.get("highway")
        if hw in MAJOR_HIGHWAYS:
            line = (ROAD, way_line(el))
        elif hw == "track":
            line = (FOREST_ROAD, way_line(el))
        elif hw in {"path", "footway", "bridleway", "cycleway", "steps"}:
            line = (PATH, way_line(el))
        elif tags.get("railway") == "rail":
            line = (RAIL, way_line(el))
        elif tags.get("waterway") in {"stream", "river", "canal", "ditch", "brook"}:
            line = (STREAM, way_line(el))
        if line:
            lines[line[0]].append(utm(line[1]))
        if tags.get("piste:type") == "nordic":
            lines[PISTE].append(utm(way_line(el)))
        if tags.get("amenity") == "parking":
            g = way_polygon(el)
            if g is not None:
                pois.append(poi_at(g.centroid, "parking", tags.get("name"), to_utm, region))

    # Later classes win, so the order in LANDCOVER_RULES is the paint order.
    for cls, _ in LANDCOVER_RULES:
        geoms = [mapping(g) for g in areas[cls] if not g.is_empty]
        if geoms:
            mask = rasterize(geoms, out_shape=(n, n), transform=transform, fill=0, default_value=1)
            terrain[mask == 1] = cls

    if buildings:
        mask = rasterize([mapping(g) for g in buildings if not g.is_empty], out_shape=(n, n),
                         transform=transform, fill=0, default_value=1, all_touched=True)
        flags[mask == 1] |= BUILDING
    for flag, geoms in lines.items():
        geoms = [mapping(g) for g in geoms if not g.is_empty]
        if geoms:
            mask = rasterize(geoms, out_shape=(n, n), transform=transform, fill=0,
                             default_value=1, all_touched=True)
            flags[mask == 1] |= flag

    pois = [p for p in pois if p is not None]
    return terrain, flags, pois, vector_lines(region, lines)


LINE_KINDS = {ROAD: "road", FOREST_ROAD: "forest_road", RAIL: "rail", PATH: "path",
              STREAM: "stream", PISTE: "piste"}


def vector_lines(region, lines):
    """Polylines in tile units for drawing; game rules use the rasterised flags instead."""
    top = region.min_y + region.size_m
    out = []
    for flag, geoms in lines.items():
        for g in geoms:
            parts = getattr(g, "geoms", [g])
            for part in parts:
                if part.geom_type != "LineString" or part.is_empty:
                    continue
                part = part.simplify(region.tile_m * 0.25)
                pts = [[round((x - region.min_x) / region.tile_m, 2), round((top - y) / region.tile_m, 2)]
                       for x, y in part.coords]
                if len(pts) >= 2:
                    out.append({"kind": LINE_KINDS[flag], "pts": pts})
    return out


POI_KINDS = [
    ("station", lambda t: t.get("railway") in {"station", "halt"}),
    ("parking", lambda t: t.get("amenity") == "parking"),
    ("peak", lambda t: t.get("natural") == "peak"),
    ("place", lambda t: "place" in t),
]


def poi(el, tags, to_utm, region):
    for kind, test in POI_KINDS:
        if test(tags):
            return poi_at(Point(el["lon"], el["lat"]), kind, tags.get("name"), to_utm, region)
    return None


def poi_at(pt_ll, kind, name, to_utm, region):
    x, y = to_utm(pt_ll.x, pt_ll.y)
    col = int((x - region.min_x) // region.tile_m)
    row = int((region.min_y + region.size_m - y) // region.tile_m)
    if not (0 <= col < region.tiles and 0 <= row < region.tiles):
        return None
    return {"kind": kind, "name": name, "x": col, "y": row}


def bbox_latlon(region):
    to_ll = Transformer.from_crs(CRS, "EPSG:4326", always_xy=True).transform
    xs = [region.min_x, region.min_x + region.size_m]
    ys = [region.min_y, region.min_y + region.size_m]
    corners = [to_ll(x, y) for x in xs for y in ys]
    pad = 0.002
    return (min(c[1] for c in corners) - pad, min(c[0] for c in corners) - pad,
            max(c[1] for c in corners) + pad, max(c[0] for c in corners) + pad)


PREVIEW_COLOURS = {
    FOREST: (62, 104, 70), OPEN: (196, 206, 150), FARMLAND: (222, 214, 160), BOG: (150, 160, 120),
    WATER: (90, 140, 190), BUILT: (190, 180, 175), ROCK: (160, 160, 160),
}


def hillshade(elev, cell):
    dy, dx = np.gradient(elev, cell)
    slope = np.arctan(np.hypot(dx, dy))
    aspect = np.arctan2(-dx, dy)
    az, alt = math.radians(315), math.radians(45)
    shade = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    return np.clip(shade, 0, 1)


def write_preview(path, terrain, flags, elev, region, scale=4):
    rgb = np.zeros(terrain.shape + (3,), dtype=np.float32)
    for cls, colour in PREVIEW_COLOURS.items():
        rgb[terrain == cls] = colour
    rgb *= (0.55 + 0.6 * hillshade(elev, region.tile_m))[..., None]
    for flag, colour in [(STREAM, (90, 140, 190)), (PATH, (150, 110, 70)),
                         (FOREST_ROAD, (120, 90, 60)), (ROAD, (240, 240, 230)),
                         (BUILDING, (120, 60, 60)), (RAIL, (40, 40, 40)), (PISTE, (30, 90, 220))]:
        rgb[(flags & flag) != 0] = colour
    img = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8))
    img = img.resize((img.width * scale, img.height * scale), Image.NEAREST)
    img.save(path)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("region", choices=sorted(REGIONS))
    ap.add_argument("--out", type=Path, default=ROOT / "game" / "public" / "maps")
    args = ap.parse_args()

    region = REGIONS[args.region]
    CACHE.mkdir(exist_ok=True)
    args.out.mkdir(parents=True, exist_ok=True)

    print(f"{region.title}: {region.tiles}x{region.tiles} tiles of {region.tile_m} m", file=sys.stderr)
    osm = fetch_osm(region, bbox_latlon(region))
    elev = fetch_dtm(region)
    terrain, flags, pois, lines = build_layers(region, osm)

    doc = {
        "name": region.name,
        "title": region.title,
        "crs": CRS,
        "origin": [region.min_x, region.min_y + region.size_m],
        "tileSize": region.tile_m,
        "width": region.tiles,
        "height": region.tiles,
        "terrain": terrain.ravel().tolist(),
        "flags": flags.ravel().tolist(),
        "elevation": np.round(elev).astype(int).ravel().tolist(),
        "pois": pois,
        "lines": lines,
        "attribution": "© OpenStreetMap contributors (ODbL); elevation © Kartverket (CC BY 4.0)",
    }
    (args.out / f"{region.name}.json").write_text(json.dumps(doc, separators=(",", ":")))
    write_preview(args.out / f"{region.name}-preview.png", terrain, flags, elev, region)

    counts = np.bincount(terrain.ravel(), minlength=len(PREVIEW_COLOURS))
    print("terrain:", {k: int(v) for k, v in zip(
        ["forest", "open", "farmland", "bog", "water", "built", "rock"], counts)}, file=sys.stderr)
    print(f"pois: {len(pois)}  elevation: {elev.min():.0f}-{elev.max():.0f} m", file=sys.stderr)


if __name__ == "__main__":
    main()
