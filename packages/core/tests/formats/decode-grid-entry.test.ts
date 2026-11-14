// @vitest-environment node
/**
 * @file `decodeGrid` from the package entry, in Node (grid source, U4)
 *
 * @description
 * Tooling (a converter, a check in CI, `mlym`) decodes a grid file without
 * a browser: `decodeGrid(bytes, spec)` on `@maplibre-yaml/core` is an async
 * wrapper over the `grid` on-demand module, reached through the seam, so
 * the entry never value-imports the chunk (tests/lazy-chunks.test.ts checks
 * the built output). Runs against the committed scalar frame.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeGrid, isFormatError, type GridField, type GridSource, type ScalarGridField, type VectorGridField } from "../../src/index";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../../examples/verification/null-earth/data");
const GEOMETRY = { nx: 360, ny: 181, lo1: -180, la1: 90, dx: 1, dy: 1 };

const temperature: GridSource = {
  type: "grid",
  url: "data/temperature.png",
  encoding: "scalar-r",
  grid: GEOMETRY,
  range: [193, 328],
  units: "K",
  nodata: { channel: "b", above: 153 },
};

describe("decodeGrid from the package entry (Node)", () => {
  it("decodes the committed scalar frame from a Buffer into a sampleable field", async () => {
    const field: GridField = await decodeGrid(readFileSync(join(FIXTURES, "2026111400-f000-temp-2m.png")), temperature);
    expect(field.kind).toBe("scalar");
    expect(field.units).toBe("K");
    expect(field.wraps).toBe(true);
    expect(field.grid).toMatchObject(GEOMETRY);
    expect([field.nx, field.ny]).toEqual([360, 181]);
    const value = (field as ScalarGridField).sample({ lng: 10, lat: 50 });
    expect(typeof value).toBe("number");
    expect(value!).toBeGreaterThanOrEqual(193);
    expect(value!).toBeLessThanOrEqual(328);
    // The same position as a pair.
    expect((field as ScalarGridField).sample([10, 50])).toBe(value);
  });

  it("decodes the committed vector frame into { u, v, speed } samples", async () => {
    const field = (await decodeGrid(readFileSync(join(FIXTURES, "2026111400-f000-wind-10m.png")), {
      type: "grid",
      url: "data/wind.png",
      encoding: "rg-uv",
      grid: GEOMETRY,
      range: [-40, 40],
      units: "m/s",
      nodata: { channel: "b", below: 128 },
    })) as VectorGridField;
    expect(field.kind).toBe("vector");
    const sample = field.sample({ lng: -30, lat: 45 });
    expect(sample).not.toBeNull();
    expect(sample!.speed).toBeCloseTo(Math.hypot(sample!.u, sample!.v), 6);
  });

  it("refuses bytes that are not a grid image with the format-failure vocabulary", async () => {
    const error = await decodeGrid(new TextEncoder().encode("not a png"), temperature).then(
      () => undefined,
      (e: unknown) => e as Error
    );
    expect(error).toBeInstanceOf(Error);
    expect(isFormatError(error)).toBe(true);
    expect((error as Error & { failure: { format: string } }).failure.format).toBe("grid");
  });
});
