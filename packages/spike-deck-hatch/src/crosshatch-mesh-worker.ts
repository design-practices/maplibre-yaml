/**
 * @file U12 SPIKE session 3 — route 1's local tile worker (esbuild → dist/crosshatch-mesh-worker.js)
 *
 * Replaces loaders.gl's runtime fetch of mvt-worker.js from unpkg: a bundled
 * module worker that fetches (or receives) a tile's PBF bytes and builds its
 * crosshatch mesh (`buildTileMesh`, route 2's clipped mesh builder), then
 * transfers the typed arrays back.
 */
import { buildTileMesh } from "./crosshatch-mesh-build";

interface Req {
  id: number;
  url?: string;
  raw?: ArrayBuffer;
  sourceLayer: string;
  opts?: { wallsFromGround?: boolean; groundUV?: boolean };
}

self.onmessage = async (e: MessageEvent<Req>) => {
  const { id, url, raw, sourceLayer, opts } = e.data;
  try {
    let bytes = raw;
    if (!bytes && url) {
      const r = await fetch(url);
      bytes = r.ok ? await r.arrayBuffer() : new ArrayBuffer(0);
    }
    const t0 = performance.now();
    const mesh = bytes && bytes.byteLength ? buildTileMesh(bytes, sourceLayer, opts) : null;
    const ms = performance.now() - t0;
    if (mesh) {
      (self as unknown as Worker).postMessage({ id, mesh, ms }, [mesh.vertices.buffer, mesh.indices.buffer]);
    } else {
      (self as unknown as Worker).postMessage({ id, mesh: null, ms });
    }
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
