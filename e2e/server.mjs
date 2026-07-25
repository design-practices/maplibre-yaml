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
  ".md": "text/markdown; charset=utf-8",
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
  const size = 256;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0; // PNG filter: none
    for (let x = 0; x < size; x++) {
      raw[o++] = 128; // R
      raw[o++] = 0; // G
      raw[o++] = 0; // B
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

    // Static, confined to the repo root.
    const rel = normalize(path).replace(/^(\.\.[/\\])+/, "");
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
