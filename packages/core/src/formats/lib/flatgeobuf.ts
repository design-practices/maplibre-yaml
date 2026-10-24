/**
 * @file The FlatGeobuf library as the `flatgeobuf` on-demand chunk sees it
 * @module @maplibre-yaml/core/formats/lib/flatgeobuf
 *
 * @description
 * Only what formats/flatgeobuf.ts uses: re-exporting the whole
 * `flatgeobuf/geojson` module would ship its writer (`serialize`) in the
 * chunk too. A leaf module: it imports nothing from core (see the seam,
 * formats/decoders.ts).
 */

export { deserialize } from "flatgeobuf/geojson";

/** `[west, south, east, north]`. */
type BBox = [number, number, number, number];

/** About how many features of the file a view holds: what {@link readIndexLevel} returns. */
export type FeaturesInView = (view: BBox) => number;

/** The bytes `[start, start + length)` of `url`, by range request (a 206, or it throws). */
async function range(url: string, start: number, length: number): Promise<ArrayBuffer> {
  const response = await fetch(url, { headers: { Range: `bytes=${start}-${start + length - 1}` } });
  if (response.status !== 206) throw new Error(`range request: ${response.status}`);
  return response.arrayBuffer();
}

/**
 * Estimate how many features a view holds before reading any of them
 * (ml-37r.17), from the highest level of a FlatGeobuf file's spatial index
 * that still has at most 4,096 nodes — at most 160 KB, read once, after the
 * 4-byte header length. Each node covers a known run of features (the last
 * may cover fewer); a view counts each node's features by the share of the
 * node's box it covers, which a Hilbert-packed tree keeps compact. The
 * layout is the packed R-tree the library reads: levels stored root first,
 * 40 bytes per node (four doubles, then an offset).
 *
 * @param count - The header's `featuresCount`.
 * @param nodeSize - The header's `indexNodeSize`.
 */
export async function readIndexLevel(url: string, count: number, nodeSize: number): Promise<FeaturesInView> {
  const treeStart = 12 + new DataView(await range(url, 8, 4)).getUint32(0, true);
  // Nodes per level, leaves first (as the library's generateLevelBounds).
  const sizes = [count];
  let n = count;
  do {
    n = Math.ceil(n / nodeSize);
    sizes.push(n);
  } while (n !== 1);
  let level = 0;
  while (sizes[level]! > 4096) level++;
  let before = 0;
  for (let i = level + 1; i < sizes.length; i++) before += sizes[i]!;
  const nodes = sizes[level]!;
  const span = nodeSize ** level;
  const bytes = new DataView(await range(url, treeStart + before * 40, nodes * 40));
  const box = (i: number, k: number) => bytes.getFloat64(i * 40 + k * 8, true);
  return (view) => {
    let features = 0;
    for (let i = 0; i < nodes; i++) {
      const w = Math.min(box(i, 2), view[2]) - Math.max(box(i, 0), view[0]);
      const h = Math.min(box(i, 3), view[3]) - Math.max(box(i, 1), view[1]);
      if (w < 0 || h < 0) continue;
      const area = (box(i, 2) - box(i, 0)) * (box(i, 3) - box(i, 1));
      features += (area > 0 ? (w * h) / area : 1) * Math.min(span, count - i * span);
    }
    return features;
  };
}
