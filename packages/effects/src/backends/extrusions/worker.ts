/**
 * @file The extrusions mesh worker (bundled to dist/extrusions-worker.js)
 * @module @maplibre-yaml/effects/backends/extrusions
 *
 * @description
 * Receives a copy of a tile's raw bytes plus the static layer's filter and
 * height/base expressions, builds the mesh off the main thread, and
 * transfers the typed arrays back. No network access: the bytes are
 * MapLibre's own.
 */

import { buildTileMesh, type BuildInput } from "./mesh-build";

interface Request extends BuildInput {
  id: number;
}

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<Request>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

scope.onmessage = (e) => {
  const { id, ...input } = e.data;
  try {
    const t0 = performance.now();
    const mesh = buildTileMesh(input);
    const ms = performance.now() - t0;
    if (mesh) {
      scope.postMessage({ id, mesh, ms }, [mesh.vertices.buffer, mesh.indices.buffer, mesh.cuts.buffer]);
    } else {
      scope.postMessage({ id, mesh: null, ms });
    }
  } catch (err) {
    scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
