/**
 * Test helpers: hand-built vector tiles (exact tile coordinates, so clip
 * and seam cases are deterministic).
 */
import { fromVectorTileJs } from "@maplibre/vt-pbf";

export interface TestFeature {
  id?: number;
  properties?: Record<string, number | string | boolean>;
  /** Rings in tile units; the first is the outer ring. Closed or not. */
  rings: Array<Array<[number, number]>>;
}

/** Encode one polygon layer as a vector tile. */
export function makeTile(layer: string, features: TestFeature[], extent = 4096): Uint8Array {
  return fromVectorTileJs({
    layers: {
      [layer]: {
        version: 2,
        name: layer,
        extent,
        length: features.length,
        feature: (i: number) => {
          const f = features[i]!;
          return {
            type: 3,
            id: f.id,
            properties: f.properties ?? {},
            extent,
            loadGeometry: () =>
              f.rings.map((ring) => {
                const pts = ring.map(([x, y]) => ({ x, y }));
                const first = pts[0]!, last = pts[pts.length - 1]!;
                if (first.x !== last.x || first.y !== last.y) pts.push({ ...first });
                return pts;
              }) as never,
          };
        },
      },
    },
  });
}
