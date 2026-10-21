/**
 * Tile selection while MapLibre holds a parent tile beside its children
 * (ml-aot.139): every area draws from exactly one tile level — the children
 * where they cover the whole parent (what MapLibre's fill layers show), the
 * parent where they cover only part of it (no holes).
 */
import { describe, it, expect } from "vitest";
import { selectTiles, hasOverlap, type DrawTile } from "../src/backends/extrusions/tile-select";

const t = (z: number, x: number, y: number, wrap = 0, overscaledZ = z): DrawTile => ({ z, x, y, wrap, overscaledZ });
const ids = (tiles: DrawTile[]) => tiles.map((d) => `${d.z}/${d.x}/${d.y}@${d.wrap}#${d.overscaledZ}`).sort();
const children = (z: number, x: number, y: number) => [0, 1, 2, 3].map((i) => t(z + 1, x * 2 + (i & 1), y * 2 + (i >> 1)));

describe("selectTiles", () => {
  it("keeps a clean cover untouched, in input order", () => {
    // near tiles deeper, far tiles shallower (a pitched view), none inside another
    const cover = [t(16, 19294, 24640), t(16, 19295, 24640), t(15, 9646, 12319), t(14, 4822, 6158)];
    expect(selectTiles(cover)).toEqual(cover);
    expect(hasOverlap(cover)).toBe(false);
  });

  it("children win when they cover the whole parent (the retained v6 slice is skipped)", () => {
    const parent = t(15, 9647, 12320);
    const kids = children(15, 9647, 12320);
    const drawn = selectTiles([parent, ...kids]);
    expect(ids(drawn)).toEqual(ids(kids));
    expect(hasOverlap(drawn)).toBe(false);
  });

  it("the parent wins when its children cover only part of it", () => {
    const parent = t(15, 9647, 12320);
    const [a, b] = children(15, 9647, 12320);
    const other = t(15, 9648, 12320);
    const drawn = selectTiles([a!, parent, b!, other]);
    expect(ids(drawn)).toEqual(ids([parent, other]));
    expect(hasOverlap(drawn)).toBe(false);
  });

  it("coverage counts grandchildren: a quadrant covered one level deeper still covers", () => {
    const parent = t(14, 4823, 6160);
    const [q0, q1, q2, q3] = children(14, 4823, 6160);
    const deep = children(q3!.z, q3!.x, q3!.y);
    const drawn = selectTiles([parent, q0!, q1!, q2!, ...deep]);
    expect(ids(drawn)).toEqual(ids([q0!, q1!, q2!, ...deep]));
    expect(hasOverlap(drawn)).toBe(false);
  });

  it("a partly covered quadrant keeps the quadrant tile and drops its partial children", () => {
    const parent = t(14, 4823, 6160);
    const [q0, q1, q2, q3] = children(14, 4823, 6160);
    const [g0] = children(q3!.z, q3!.x, q3!.y);
    // the parent is covered (q3 is drawn); q3 is only partly covered by g0
    const drawn = selectTiles([parent, q0!, q1!, q2!, q3!, g0!]);
    expect(ids(drawn)).toEqual(ids([q0!, q1!, q2!, q3!]));
  });

  it("an ancestor more than one level up still counts (fallback meshes up to 4 levels)", () => {
    const grand = t(13, 2411, 3080);
    const leaf = t(16, 2411 * 8 + 3, 3080 * 8 + 5);
    const drawn = selectTiles([leaf, grand]);
    expect(ids(drawn)).toEqual(ids([grand]));
  });

  it("one canonical tile at two overscaled zooms (v5 overzoom) draws once, at the higher", () => {
    const at16 = t(14, 4823, 6160, 0, 16);
    const at17 = t(14, 4823, 6160, 0, 17);
    expect(selectTiles([at16, at17])).toEqual([at17]);
    expect(selectTiles([at17, at16])).toEqual([at17]);
    expect(hasOverlap([at16, at17])).toBe(true);
  });

  it("compares tiles only within one world copy", () => {
    const parent = t(15, 0, 100, -1);
    const child = t(16, 0, 200, 0);
    expect(selectTiles([parent, child])).toEqual([parent, child]);
    expect(hasOverlap([parent, child])).toBe(false);
    // the same pair in one copy overlaps
    expect(hasOverlap([parent, { ...child, wrap: -1 }])).toBe(true);
    expect(selectTiles([parent, { ...child, wrap: -1 }])).toEqual([parent]);
  });

  it("never leaves an area undrawn that some input tile covered", () => {
    // random parent/child mixes: the union of drawn squares equals the
    // union of input squares, at z18 resolution
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const cells = (tiles: DrawTile[]) => {
      const s = new Set<string>();
      for (const d of tiles) {
        const k = 2 ** (18 - d.z);
        for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) s.add(`${d.x * k + i}/${d.y * k + j}`);
      }
      return s;
    };
    for (let run = 0; run < 200; run++) {
      const tiles: DrawTile[] = [];
      const root = { z: 15, x: 9640, y: 12320 };
      const n = 1 + Math.floor(rnd() * 12);
      for (let i = 0; i < n; i++) {
        const dz = Math.floor(rnd() * 4);
        const span = 2 ** dz;
        tiles.push(t(root.z + dz, root.x * span + Math.floor(rnd() * span), root.y * span + Math.floor(rnd() * span)));
      }
      const drawn = selectTiles(tiles);
      expect(hasOverlap(drawn)).toBe(false);
      expect([...cells(drawn)].sort()).toEqual([...cells(tiles)].sort());
    }
  });
});
