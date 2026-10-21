/**
 * @file Palette tables and lookup (classify, 0.9): names resolve
 * case-insensitively with a did-you-mean, class counts are honoured, and a
 * few known values are pinned against the generated table.
 */

import { describe, it, expect } from "vitest";
import {
  findPalette,
  suggestPalette,
  paletteColors,
  paletteSizes,
  listPalettes,
  sampleEvenly,
} from "../../src/classify/palettes";

describe("palette lookup", () => {
  it("matches names case-insensitively, keeping ColorBrewer's spelling", () => {
    expect(findPalette("blues")?.name).toBe("Blues");
    expect(findPalette("YLGNBU")?.name).toBe("YlGnBu");
    expect(findPalette(" Okabe-Ito ")?.name).toBe("okabe-ito");
    expect(findPalette("nope")).toBeUndefined();
  });

  it("suggests the nearest name", () => {
    expect(suggestPalette("bleus")).toBe("Blues");
    expect(suggestPalette("viridus")).toBe("viridis");
    expect(suggestPalette("rdbuu")).toBe("RdBu");
  });

  it("prefers the palette a cut-short name starts (ml-aot.100)", () => {
    expect(suggestPalette("Blu")).toBe("Blues");
    expect(suggestPalette("blu")).toBe("Blues");
    expect(suggestPalette("Purp")).toBe("Purples");
    expect(suggestPalette("YlOrRed")).toBe("YlOrRd");
    expect(["Greens", "Greys"]).toContain(suggestPalette("Gre"));
  });

  it("carries the ColorBrewer set, viridis, cividis and okabe-ito", () => {
    const names = listPalettes().map((p) => p.name);
    expect(names).toHaveLength(38);
    for (const n of ["Blues", "YlOrRd", "RdBu", "Spectral", "Set2", "Paired", "viridis", "cividis", "okabe-ito"]) {
      expect(names).toContain(n);
    }
  });
});

describe("palette colours", () => {
  it("pins known ColorBrewer values", () => {
    expect(paletteColors(findPalette("Blues")!, 3)).toEqual(["#deebf7", "#9ecae1", "#3182bd"]);
    expect(paletteColors(findPalette("RdBu")!, 3)).toEqual(["#ef8a62", "#f7f7f7", "#67a9cf"]);
    expect(paletteColors(findPalette("YlOrRd")!, 9)![8]).toBe("#800026");
  });

  it("pins viridis' ends and okabe-ito's order", () => {
    const viridis = paletteColors(findPalette("viridis")!, 5)!;
    expect(viridis[0]).toBe("#440154");
    expect(viridis[4]).toBe("#fde725");
    expect(paletteColors(findPalette("okabe-ito")!, 3)).toEqual(["#e69f00", "#56b4e9", "#009e73"]);
  });

  it("offers each scheme's own sizes, and samples below the smallest", () => {
    expect(paletteSizes(findPalette("Blues")!)).toEqual([3, 4, 5, 6, 7, 8, 9]);
    expect(paletteColors(findPalette("Blues")!, 10)).toBeUndefined();
    // Two classes from a 3-class scheme keep both ends.
    expect(paletteColors(findPalette("Blues")!, 2)).toEqual(["#deebf7", "#3182bd"]);
    expect(paletteColors(findPalette("viridis")!, 12)).toHaveLength(12);
  });

  it("reverses", () => {
    expect(paletteColors(findPalette("Greens")!, 3, true)).toEqual(
      [...paletteColors(findPalette("Greens")!, 3)!].reverse()
    );
  });

  it("flags colour-blind-safe palettes", () => {
    expect(findPalette("viridis")!.cvdSafe).toBe(true);
    expect(findPalette("okabe-ito")!.cvdSafe).toBe(true);
    expect(findPalette("Blues")!.cvdSafe).toBe(true);
    expect(findPalette("Spectral")!.cvdSafe).toBe(false);
    expect(findPalette("Set1")!.cvdSafe).toBe(false);
  });

  it("samples evenly, keeping the ends", () => {
    expect(sampleEvenly([1, 2, 3, 4, 5], 3)).toEqual([1, 3, 5]);
    expect(sampleEvenly([1, 2, 3], 5)).toEqual([1, 2, 3]);
  });
});
