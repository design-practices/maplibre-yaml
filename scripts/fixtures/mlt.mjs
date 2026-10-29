#!/usr/bin/env node
/**
 * The MLT PMTiles fixtures (0.10, U4): two tiny vector archives whose tiles
 * are MapLibre Tiles (MLT, PMTiles tile type 6), for the browser tests of
 * `encoding: mlt` set from the archive header and of the 64-bit integer
 * notice.
 *
 * Synthetic and CC0, like scripts/fixtures/cloud-native.py: 50 points from a
 * fixed seed in the same fictional study area (Tyrrhenian Sea, no real
 * places), so the files regenerate byte-for-byte. The files are committed;
 * CI never runs this script.
 *
 * Tiles are encoded with `@maplibre/mlt`'s own encoder (`encodeTile`, the
 * decoder maplibre-gl 6 draws with, already in the install tree through
 * maplibre-gl), and packed into a PMTiles v3 archive written here (header,
 * one root directory, JSON metadata, tile data; no compression). Neither
 * freestiler nor tylertoo is needed.
 *
 * Run from the repo root (Node 22.15+ for `module.registerHooks`):
 *
 *     node scripts/fixtures/mlt.mjs
 *
 * Writes to docs/public/gallery-assets/cloud-native/:
 *
 *     lots-mlt.pmtiles        layer `lots`, 50 points, z0-10; `lot_id` as a
 *                             double (draws on maplibre-gl 6+)
 *     lots-mlt-int64.pmtiles  the same with `lot_id` as int64, which
 *                             MapLibre's MLT decoder returns as BigInt. In
 *                             maplibre-gl 6.12 these tiles draw, but a
 *                             `promoteId: lot_id` fails every tile in the
 *                             worker ("Cannot convert a BigInt value to a
 *                             number"), and an expression that makes it a
 *                             string warns once ("Do not know how to
 *                             serialize a BigInt", the text PLUTO's
 *                             freestiler build failed every tile with)
 */

import { createRequire, registerHooks } from "node:module";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "docs", "public", "gallery-assets", "cloud-native");

// @maplibre/mlt's ESM build imports its own files without extensions (it is
// meant for bundlers): resolve `./x` to `./x.js` when Node can't.
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (/^\.\.?\//.test(specifier) && !/\.[cm]?js$/.test(specifier)) return next(`${specifier}.js`, context);
      throw error;
    }
  },
});
// Found through maplibre-gl, which depends on it (pnpm doesn't hoist it).
const core = createRequire(join(ROOT, "packages", "core", "package.json"));
const fromGl = createRequire(core.resolve("maplibre-gl/package.json"));
const mltDir = dirname(fromGl.resolve("@maplibre/mlt/package.json"));
const { encodeTile, decodeTile } = await import(pathToFileURL(join(mltDir, "dist", "index.js")).href);

// The study area of scripts/fixtures/cloud-native.py.
const [W, S, E, N] = [10.0, 42.0, 10.4, 42.3];
const MAXZOOM = 10;
const EXTENT = 4096;

/** mulberry32: a small seeded PRNG, so the files regenerate byte-for-byte. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = rng(42);
const KINDS = ["residential", "industrial", "park", "commercial"];
const LOTS = Array.from({ length: 50 }, (_, i) => ({
  lon: W + random() * (E - W),
  lat: S + random() * (N - S),
  name: `Lot ${i + 1}`,
  kind: KINDS[i % KINDS.length],
  value: Math.round(random() * 10000) / 100,
  // Ten digits, as NYC's BBL (borough-block-lot) is: written as int64 by
  // tools that keep the source column's type.
  lotId: 1_000_000_000 + i * 104_729,
}));

/** Web Mercator tile coordinates (fractional) of a position at zoom z. */
function tileXY(lon, lat, z) {
  const n = 2 ** z;
  const x = ((lon + 180) / 360) * n;
  const r = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  return [x, y];
}

/** The PMTiles tile id of z/x/y (Hilbert order within a zoom). */
function zxyToTileId(z, x, y) {
  let acc = 0;
  for (let t = 0; t < z; t++) acc += 4 ** t;
  const n = 2 ** z;
  let d = 0;
  let [tx, ty] = [x, y];
  for (let s = n / 2; s >= 1; s /= 2) {
    const rx = (tx & s) > 0 ? 1 : 0;
    const ry = (ty & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    // rotate
    if (ry === 0) {
      if (rx === 1) {
        tx = s - 1 - tx;
        ty = s - 1 - ty;
      }
      [tx, ty] = [ty, tx];
    }
  }
  return acc + d;
}

/** One archive's tiles: tile id → MLT bytes. */
function tiles(int64) {
  const out = new Map();
  for (let z = 0; z <= MAXZOOM; z++) {
    const byTile = new Map();
    for (const lot of LOTS) {
      const [fx, fy] = tileXY(lot.lon, lot.lat, z);
      const [x, y] = [Math.floor(fx), Math.floor(fy)];
      const key = `${x}/${y}`;
      if (!byTile.has(key)) byTile.set(key, { x, y, features: [] });
      byTile.get(key).features.push({
        id: LOTS.indexOf(lot) + 1,
        geometry: { type: "Point", coordinates: [Math.round((fx - x) * EXTENT), Math.round((fy - y) * EXTENT)] },
        properties: {
          name: lot.name,
          kind: lot.kind,
          value: lot.value,
          lot_id: int64 ? BigInt(lot.lotId) : lot.lotId,
        },
      });
    }
    for (const { x, y, features } of byTile.values()) {
      const data = encodeTile([{ name: "lots", features, extent: EXTENT }], {
        propertyTypes: { lot_id: int64 ? "int64" : "double", value: "double" },
      });
      out.set(zxyToTileId(z, x, y), data);
    }
  }
  return new Map([...out].sort(([a], [b]) => a - b));
}

/** An unsigned LEB128 varint. */
function varint(n, bytes) {
  let v = n;
  while (v >= 0x80) {
    bytes.push((v % 0x80) | 0x80);
    v = Math.floor(v / 0x80);
  }
  bytes.push(v);
}

/** A PMTiles v3 archive of MLT tiles: header, root directory, metadata, tile data. */
function archive(tileMap, metadata) {
  const entries = [];
  const chunks = [];
  let offset = 0;
  for (const [tileId, data] of tileMap) {
    entries.push({ tileId, offset, length: data.length });
    chunks.push(data);
    offset += data.length;
  }
  const dir = [];
  varint(entries.length, dir);
  let last = 0;
  for (const e of entries) {
    varint(e.tileId - last, dir);
    last = e.tileId;
  }
  for (const _ of entries) varint(1, dir); // run lengths
  for (const e of entries) varint(e.length, dir);
  entries.forEach((e, i) => {
    const prev = entries[i - 1];
    varint(i > 0 && e.offset === prev.offset + prev.length ? 0 : e.offset + 1, dir);
  });
  const meta = new TextEncoder().encode(JSON.stringify(metadata));
  const HEADER = 127;
  const rootOffset = HEADER;
  const metaOffset = rootOffset + dir.length;
  const dataOffset = metaOffset + meta.length;
  if (dataOffset > 16384) throw new Error("the root directory must fit in the first 16 KB");

  const header = new DataView(new ArrayBuffer(HEADER));
  new TextEncoder().encode("PMTiles").forEach((b, i) => header.setUint8(i, b));
  header.setUint8(7, 3);
  const u64 = (at, v) => header.setBigUint64(at, BigInt(v), true);
  u64(8, rootOffset);
  u64(16, dir.length);
  u64(24, metaOffset);
  u64(32, meta.length);
  u64(40, 0); // no leaf directories
  u64(48, 0);
  u64(56, dataOffset);
  u64(64, offset);
  u64(72, entries.length); // addressed tiles
  u64(80, entries.length); // tile entries
  u64(88, entries.length); // tile contents
  header.setUint8(96, 1); // clustered
  header.setUint8(97, 1); // internal compression: none
  header.setUint8(98, 1); // tile compression: none
  header.setUint8(99, 6); // tile type: MLT
  header.setUint8(100, 0);
  header.setUint8(101, MAXZOOM);
  const e7 = (at, v) => header.setInt32(at, Math.round(v * 1e7), true);
  e7(102, W);
  e7(106, S);
  e7(110, E);
  e7(114, N);
  header.setUint8(118, 9);
  e7(119, (W + E) / 2);
  e7(123, (S + N) / 2);

  const out = new Uint8Array(dataOffset + offset);
  out.set(new Uint8Array(header.buffer), 0);
  out.set(dir, rootOffset);
  out.set(meta, metaOffset);
  let at = dataOffset;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

for (const [file, int64] of [
  ["lots-mlt.pmtiles", false],
  ["lots-mlt-int64.pmtiles", true],
]) {
  const tileMap = tiles(int64);
  // The encoder's own decoder reads every tile back, with every lot at z10.
  let atMax = 0;
  for (const [tileId, data] of tileMap) {
    const [table] = decodeTile(data);
    if (table.name !== "lots") throw new Error(`tile ${tileId}: layer ${table.name}`);
    if (tileId >= zxyToTileId(MAXZOOM, 0, 0)) atMax += table.numFeatures;
  }
  if (atMax !== LOTS.length) throw new Error(`${file}: ${atMax} lots at z${MAXZOOM}, expected ${LOTS.length}`);
  const bytes = archive(tileMap, {
    name: "maplibre-yaml MLT fixture",
    description: int64 ? "lot_id written as int64" : "lot_id written as double",
    attribution: "Synthetic data (CC0)",
    vector_layers: [
      {
        id: "lots",
        minzoom: 0,
        maxzoom: MAXZOOM,
        fields: { name: "String", kind: "String", value: "Number", lot_id: "Number" },
      },
    ],
  });
  writeFileSync(join(OUT, file), bytes);
  console.log(`${file}: ${tileMap.size} tiles, ${bytes.length} bytes`);
}
