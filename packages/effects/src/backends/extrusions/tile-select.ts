/**
 * @file Which tiles to draw when MapLibre holds a parent and its children at once
 * @module @maplibre-yaml/effects/backends/extrusions
 *
 * @description
 * MapLibre's visible tile set is not always a clean cover. While a zoom
 * crosses a tile level and the new tiles are still loading, the tile manager
 * keeps the old tile beside its children (`_updateRetainedTiles` retains a
 * loaded parent for every ideal tile that is not loaded yet, and
 * `getRenderableIds` returns every renderable tile, retained or not).
 * maplibre-gl 6 makes this common: past the source's maxzoom a tile is a
 * slice with its own canonical z/x/y, so a retained z15 slice and its loaded
 * z16 slices are drawn in the same frame. On v5 the overzoomed tiles kept
 * the source's canonical z, so the same frames held one canonical tile at
 * two overscaled zooms instead.
 *
 * MapLibre's flat layers never show the overlap: fill and line draw each
 * tile through a stencil clipping mask, the masks are drawn in ascending
 * zoom order and each tile's mask overwrites the ones beneath it, so in any
 * pixel the HIGHEST-zoom tile that covers it wins and the parent only fills
 * what its children leave uncovered. Extrusions cannot be clipped like that
 * — a wall rises out of its tile's square on screen — and the backend used
 * to draw every tile whole, so parent and child meshes of the same buildings
 * overlapped and z-fought for a few frames (doubled outlines, mixed hatch;
 * ml-aot.139).
 *
 * The rule mirrors the mask at tile granularity:
 *
 * - **Children win where they cover the whole parent.** A tile whose square
 *   is completely covered by higher-zoom tiles drawn this frame is skipped —
 *   exactly what the fill layers show there.
 * - **The parent wins where its children cover only part of it.** Its
 *   partial children are skipped instead. Drawing the children alone would
 *   open holes the basemap does not have; drawing both is the overlap. The
 *   parent carries the same buildings (on v6 the children are slices of the
 *   same source tile), so the frame matches the fills' coverage at the
 *   parent's level of detail until the last child loads.
 * - **One canonical tile at two overscaled zooms** (v5 overzoom) draws once,
 *   at the higher overscaled zoom — the one MapLibre is moving to.
 *
 * Tiles are only compared within one world copy (`wrap`).
 */

/** A tile the backend is about to draw. */
export interface DrawTile {
  /** Canonical tile coordinates. */
  z: number;
  x: number;
  y: number;
  /** World copy. */
  wrap: number;
  /** The zoom the tile's mesh was built for (MapLibre's overscaled z). */
  overscaledZ: number;
}

const keyOf = (wrap: number, z: number, x: number, y: number) => `${wrap}/${z}/${x}/${y}`;

/**
 * The subset of `tiles` that draws every area from exactly one tile level,
 * in the input order (see the module description for the rule).
 */
export function selectTiles<T extends DrawTile>(tiles: readonly T[]): T[] {
  if (tiles.length < 2) return tiles.slice();

  // One canonical tile drawn twice (two overscaled zooms): keep the higher.
  const byKey = new Map<string, T>();
  for (const t of tiles) {
    const k = keyOf(t.wrap, t.z, t.x, t.y);
    const prev = byKey.get(k);
    if (!prev || t.overscaledZ > prev.overscaledZ) byKey.set(k, t);
  }

  // Every strict ancestor of a drawn tile: the squares that hold drawn tiles below them.
  const hasDescendant = new Set<string>();
  for (const t of byKey.values()) {
    for (let dz = 1; dz <= t.z; dz++) {
      const k = keyOf(t.wrap, t.z - dz, t.x >> dz, t.y >> dz);
      if (hasDescendant.has(k)) break; // its ancestors are in already
      hasDescendant.add(k);
    }
  }

  // True when drawn higher-zoom tiles cover the whole square.
  const coveredMemo = new Map<string, boolean>();
  const covered = (wrap: number, z: number, x: number, y: number): boolean => {
    const k = keyOf(wrap, z, x, y);
    const memo = coveredMemo.get(k);
    if (memo !== undefined) return memo;
    let all = true;
    for (let i = 0; i < 4 && all; i++) {
      const cz = z + 1, cx = x * 2 + (i & 1), cy = y * 2 + (i >> 1);
      const ck = keyOf(wrap, cz, cx, cy);
      all = byKey.has(ck) || (hasDescendant.has(ck) && covered(wrap, cz, cx, cy));
    }
    coveredMemo.set(k, all);
    return all;
  };

  const skip = new Set<string>();
  const ascending = [...byKey.values()].sort((a, b) => a.z - b.z);
  for (const t of ascending) {
    const k = keyOf(t.wrap, t.z, t.x, t.y);
    if (skip.has(k) || !hasDescendant.has(k)) continue;
    if (covered(t.wrap, t.z, t.x, t.y)) {
      skip.add(k); // children win
      continue;
    }
    // parent wins: skip every drawn tile inside its square
    for (const u of byKey.values()) {
      if (u.wrap === t.wrap && u.z > t.z && u.x >> (u.z - t.z) === t.x && u.y >> (u.z - t.z) === t.y) {
        skip.add(keyOf(u.wrap, u.z, u.x, u.y));
      }
    }
  }

  return tiles.filter((t) => {
    const k = keyOf(t.wrap, t.z, t.x, t.y);
    return byKey.get(k) === t && !skip.has(k);
  });
}

/**
 * True when some tile in the list is drawn together with its own ancestor
 * (or the same canonical tile twice) in one world copy — the overlap
 * {@link selectTiles} removes. For tests and diagnostics.
 */
export function hasOverlap(tiles: readonly Omit<DrawTile, "overscaledZ">[]): boolean {
  const seen = new Set<string>();
  for (const t of tiles) {
    const k = keyOf(t.wrap, t.z, t.x, t.y);
    if (seen.has(k)) return true;
    seen.add(k);
  }
  for (const t of tiles) {
    for (let dz = 1; dz <= t.z; dz++) {
      if (seen.has(keyOf(t.wrap, t.z - dz, t.x >> dz, t.y >> dz))) return true;
    }
  }
  return false;
}
