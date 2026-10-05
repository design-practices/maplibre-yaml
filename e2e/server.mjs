/**
 * Hermetic static server for the browser verification fixtures.
 *
 * @remarks
 * The fixtures originally pulled maplibre-gl from esm.sh, its CSS from unpkg,
 * a basemap from demotiles, and terrain tiles from S3. That is fine for a
 * human opening a page, but as a required CI check it means four external
 * services can turn the build red for reasons unrelated to the code — and a
 * flaky required check is worse than no check, because people learn to re-run
 * reds without reading them.
 *
 * So everything is served locally:
 *  - `/vendor/maplibre-gl.js`      resolved from node_modules (UMD)
 *  - `/vendor/maplibre-gl.esm.js`  a generated ES-module wrapper, since
 *                                  maplibre-gl@4 ships no ESM build (the very
 *                                  reason the fixtures used esm.sh)
 *  - `/vendor/maplibre-gl.css`     resolved from node_modules
 *  - `/dem/{z}/{x}/{y}.png`        a synthesised elevation tile, so the
 *                                  hillshade fixture loads without S3
 *  - `/relief/{z}/{x}/{y}.png`     seamless synthetic mountains (terrarium),
 *                                  so 3D terrain twins have relief to show
 *  - `/landcover/{z}/{x}/{y}.png`  a raster coloured by the same relief,
 *                                  standing in for satellite imagery
 *  - `/dem-hills/{z}/{x}/{y}.png`  synthesised rolling terrain (0-3500 m),
 *                                  so the color-relief twin shows its ramp
 *  - `/_astro/*`, `/classics/*`, `/examples/classics/`, `/fonts/*`  the built docs site (docs/dist): the
 *                                  classics launch page, mounted where the
 *                                  site serves it
 *  - everything else               static from the repo root
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.VERIFY_PORT ?? 4174);

const MAPLIBRE_DIR = dirname(require.resolve("maplibre-gl/package.json"));

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".yaml": "text/yaml; charset=utf-8",
  ".yml": "text/yaml; charset=utf-8",
  ".png": "image/png",
  // U16 hatch twins: an <img> only decodes SVG served as image/svg+xml;
  // GIF radar frames, TTF font faces and GeoJSON round out the assets.
  ".svg": "image/svg+xml",
  ".gif": "image/gif",
  ".ttf": "font/ttf",
  ".geojson": "application/geo+json",
  ".md": "text/markdown; charset=utf-8",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

/**
 * ES-module wrapper over the UMD bundle.
 *
 * @remarks
 * Loaded as a module, the UMD factory finds neither `module` nor `define` and
 * falls through to its global branch, so `globalThis.maplibregl` is populated
 * and can be re-exported. The named exports mirror what `maplibre-interop`
 * and the fixtures actually reach for.
 */
const ESM_SHIM = `import "./maplibre-gl.js";
const gl = globalThis.maplibregl;
export default gl;
export const Map = gl.Map;
export const Popup = gl.Popup;
export const Marker = gl.Marker;
export const LngLat = gl.LngLat;
export const LngLatBounds = gl.LngLatBounds;
export const NavigationControl = gl.NavigationControl;
export const GeolocateControl = gl.GeolocateControl;
export const ScaleControl = gl.ScaleControl;
export const FullscreenControl = gl.FullscreenControl;
export const AttributionControl = gl.AttributionControl;
`;

/**
 * A 256x256 terrarium-encoded PNG at a constant elevation.
 *
 * @remarks
 * Hand-built rather than pulled from a fixture file: hillshade only needs
 * decodable pixels, and generating them keeps the repo free of binary blobs.
 * Terrarium decodes as (R * 256 + G + B / 256) - 32768, so R=128,G=0,B=0 is
 * elevation 0 — flat, valid, and enough to prove the source is consumed.
 */
function terrariumTile() {
  return encodeRgbTile(() => [128, 0, 0]);
}

/**
 * Synthetic mountains, as a pure function of world position (U15).
 *
 * @remarks
 * The flat tile above proves a raster-dem source is consumed; 3D terrain
 * needs relief to prove anything — a pitched camera over flat ground looks
 * identical with terrain on or off. Elevation is computed from normalized
 * Web-Mercator coordinates (0..1 across the world), never from tile-local
 * pixels, so neighbouring tiles and zoom levels agree and the surface has
 * no seams. Ridges repeat every ~20 km: at the gallery's zoom-12 alpine
 * cameras that reads as a mountain range.
 */
function elevationAt(mx, my) {
  const t = 2 * Math.PI;
  return (
    1400 +
    900 * Math.sin(mx * t * 1900) * Math.cos(my * t * 1700) +
    450 * Math.sin(mx * t * 5300 + my * t * 3100) +
    200 * Math.cos(mx * t * 11900 - my * t * 9700)
  );
}

/** Iterate a tile's pixels as normalized Web-Mercator coordinates. */
function worldTile(z, x, y, pixel) {
  const n = 2 ** z;
  return encodeRgbTile((px, py) =>
    pixel((x + (px + 0.5) / 256) / n, (y + (py + 0.5) / 256) / n)
  );
}

/** A terrarium-encoded relief tile (decodes to {@link elevationAt}). */
function reliefTile(z, x, y) {
  return worldTile(z, x, y, (mx, my) => {
    const v = elevationAt(mx, my) + 32768;
    const r = Math.floor(v / 256);
    const g = Math.floor(v) % 256;
    const b = Math.floor((v - Math.floor(v)) * 256);
    return [r, g, b];
  });
}

/**
 * A stand-in for satellite imagery over the same relief: valley green, rock
 * brown, snow white by elevation. It gives the 3D twins something to drape
 * over the terrain that visibly follows it.
 */
function landcoverTile(z, x, y) {
  return worldTile(z, x, y, (mx, my) => {
    // Low-frequency "continents", so a whole-world (globe) view reads as
    // land and sea rather than aliased ridge noise.
    const t = 2 * Math.PI;
    const land =
      Math.sin(mx * t * 3 + 1.2) * Math.cos(my * t * 2 - 0.4) +
        0.35 * Math.sin(mx * t * 7 + my * t * 5) >
      -0.25;
    if (!land) return [62, 104, 150];
    if (z < 6) return [112, 146, 88];
    const e = elevationAt(mx, my);
    if (e > 2400) return [244, 246, 248];
    if (e > 1800) return [150, 128, 104];
    if (e > 1100) return [92, 128, 70];
    return [128, 160, 92];
  });
}

/** Encode a 256x256 opaque RGBA PNG from a per-pixel colour function. */
function encodeRgbTile(color) {
  const size = 256;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0; // PNG filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b] = color(x, y);
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
      raw[o++] = 255; // A
    }
  }

  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

let CRC_TABLE;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

const DEM_TILE = terrariumTile();
const SYNTHETIC_TILES = new Map();

/**
 * Rolling synthetic hills for the color-relief twin (U14): elevation is a
 * smooth function of the WORLD position (not the tile pixel), so neighbouring
 * tiles agree at their seams and every zoom shows the same landscape. Spans
 * 0-3500 m so the full upstream color ramp appears on screen. Terrarium:
 * elevation + 32768 = R * 256 + G + B / 256.
 */
const HILL_PERIOD = 1 / 1600; // world units per hill (several per zoom-10 view)
const HILLS_CACHE = new Map();
function hillsTile(z, x, y) {
  const key = `${z}/${x}/${y}`;
  if (!HILLS_CACHE.has(key)) {
    const scale = 2 ** z;
    const k = (2 * Math.PI) / HILL_PERIOD;
    HILLS_CACHE.set(
      key,
      encodeRgbTile((px, py) => {
        const u = (x + px / 256) / scale;
        const v = (y + py / 256) / scale;
        const e = 1750 + 1750 * Math.sin(u * k) * Math.cos(v * k);
        const t = Math.max(0, Math.min(65535.99, e + 32768));
        return [Math.floor(t / 256), Math.floor(t) % 256, Math.floor((t % 1) * 256)];
      })
    );
  }
  return HILLS_CACHE.get(key);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = decodeURIComponent(url.pathname);

  const send = (status, body, type) => {
    res.writeHead(status, {
      "content-type": type,
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    });
    res.end(body);
  };

  try {
    if (path === "/vendor/maplibre-gl.esm.js") {
      return send(200, ESM_SHIM, TYPES[".js"]);
    }
    if (path === "/vendor/maplibre-gl.js") {
      return send(200, await readFile(join(MAPLIBRE_DIR, "dist/maplibre-gl.js")), TYPES[".js"]);
    }
    if (path === "/vendor/maplibre-gl.css") {
      return send(200, await readFile(join(MAPLIBRE_DIR, "dist/maplibre-gl.css")), TYPES[".css"]);
    }
    if (path.startsWith("/dem/") && path.endsWith(".png")) {
      return send(200, DEM_TILE, TYPES[".png"]);
    }
    // U15 3D twins: seamless synthetic relief (terrarium) and a landcover
    // raster coloured by the same elevation. Memoized — terrain re-requests
    // tiles as the camera settles.
    const synthetic = /^\/(relief|landcover)\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(path);
    if (synthetic) {
      const [, kind, z, x, y] = synthetic;
      const key = `${kind}/${z}/${x}/${y}`;
      let tile = SYNTHETIC_TILES.get(key);
      if (!tile) {
        tile = (kind === "relief" ? reliefTile : landcoverTile)(+z, +x, +y);
        if (SYNTHETIC_TILES.size > 2000) SYNTHETIC_TILES.clear();
        SYNTHETIC_TILES.set(key, tile);
      }
      return send(200, tile, TYPES[".png"]);
    }
    const hills = path.match(/^\/dem-hills\/(\d+)\/(\d+)\/(\d+)\.png$/);
    if (hills) {
      const [z, x, y] = hills.slice(1).map(Number);
      return send(200, hillsTile(z, x, y), TYPES[".png"]);
    }
    if (path.startsWith("/glyphs/") && path.endsWith(".pbf")) {
      // An empty buffer is a valid (empty) glyphs protobuf message: symbol
      // layers with text load without a network dependency or a console
      // error. No visible glyphs render — the gallery label twins assert
      // layer presence and error-freeness, not typography.
      return send(200, Buffer.alloc(0), "application/x-protobuf");
    }

    // The BUILT docs site's classics launch page (U11), at the paths the
    // site serves it from: Astro emits root-absolute URLs (/_astro/…), so
    // the page only works mounted at its own paths. Requires the docs build
    // (`pnpm build`); e2e/classics.spec.ts says so when it is missing.
    if (
      path.startsWith("/_astro/") ||
      path === "/classics" ||
      path.startsWith("/classics/") ||
      path.startsWith("/examples/classics/") ||
      path.startsWith("/fonts/")
    ) {
      const DIST = join(ROOT, "docs", "dist");
      const rel = normalize(path.endsWith("/") ? `${path}index.html` : path).replace(/^(\.\.[/\\])+/, "");
      const file = join(DIST, rel);
      if (!file.startsWith(DIST)) return send(403, "forbidden", "text/plain");
      return send(200, await readFile(file), TYPES[extname(file)] ?? "application/octet-stream");
    }

    // Docs-site root paths (U16): gallery pages reference their assets the
    // way the docs site serves them (`/gallery-assets/…`, `/gallery-js/…`).
    // Mapping those two prefixes onto docs/public lets the hermetic twins
    // and the live-config sweep load the very same URLs.
    const docsPublic = /^\/(gallery-assets|gallery-js)\//.test(path) ? "/docs/public" : "";

    // Static, confined to the repo root.
    const rel = normalize(docsPublic + path).replace(/^(\.\.[/\\])+/, "");
    const file = join(ROOT, rel);
    if (!file.startsWith(ROOT)) return send(403, "forbidden", "text/plain");

    return send(200, await readFile(file), TYPES[extname(file)] ?? "application/octet-stream");
  } catch {
    return send(404, "not found", "text/plain");
  }
});

server.listen(PORT, () => {
  console.log(`verification server on http://localhost:${PORT}`);
});
