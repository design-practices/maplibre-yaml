/**
 * @file The CDN entry's size budget (live documents, R20)
 *
 * @description
 * The update engine ships as a lazy chunk (KTD10), so what the live
 * documents work adds to `dist/register.browser.js` — the validation gate,
 * the applied-document state, the queue, the runtime-host wrappers — is
 * bounded: gzip-9 of the entry must not exceed the recorded baseline plus
 * the declared allowance in `size-baseline.json`. The baseline was measured
 * at the plan commit with `gzip -9 -c | wc -c`, so this measures with the
 * same tool when it is on the PATH (Node's zlib at level 9 reads about
 * 1 KB larger than GNU gzip on this entry, a quarter of the allowance) and
 * falls back to zlib, saying so, where it is not.
 *
 * Skips when `dist/` is absent (a source checkout without a build), as
 * install-footprint.test.ts does; presubmit builds first, so it enforces.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

interface Baseline {
  file: string;
  baselineGzip: number;
  allowanceGzip: number;
  recordedAt: string;
}

const baseline = JSON.parse(readFileSync(join(PKG_ROOT, "size-baseline.json"), "utf8")) as Baseline;

/** gzip-9 size of `bytes`, by GNU gzip (the baseline's tool) when present, else Node's zlib. */
function gzip9(bytes: Buffer): { size: number; tool: string } {
  try {
    return { size: execFileSync("gzip", ["-9", "-c"], { input: bytes, maxBuffer: 64 * 1024 * 1024 }).length, tool: "gzip -9 -c" };
  } catch {
    return { size: gzipSync(bytes, { level: 9 }).length, tool: "node:zlib level 9 (gzip not on PATH)" };
  }
}
const entry = join(PKG_ROOT, baseline.file);
const built = existsSync(entry);

if (process.env.CI && !built) {
  throw new Error(`${baseline.file} missing under CI — the build step must run before tests`);
}

describe.skipIf(!built)(`${baseline.file} stays within its gzip budget`, () => {
  it(`gzip-9 size <= baseline (${baseline.baselineGzip}, at ${baseline.recordedAt}) + allowance (${baseline.allowanceGzip})`, () => {
    const { size: actual, tool } = gzip9(readFileSync(entry));
    const budget = baseline.baselineGzip + baseline.allowanceGzip;
    const delta = actual - baseline.baselineGzip;
    // Always printed, so the number lands in the test log for the PR body.
    console.log(
      `[bundle-size] ${baseline.file}: ${actual} bytes gzip-9 by ${tool} (budget ${budget}; ` +
        `${delta >= 0 ? "+" : ""}${delta} over the ${baseline.recordedAt} baseline, ${budget - actual} to spare)`
    );
    expect(
      actual,
      `${baseline.file} is ${actual} bytes gzip-9, over the budget of ${budget} ` +
        `(baseline ${baseline.baselineGzip} + allowance ${baseline.allowanceGzip}). Move the addition behind the ` +
        `on-demand chunk seam (formats/decoders.ts LOADERS), or have the maintainer approve a new baseline in size-baseline.json.`
    ).toBeLessThanOrEqual(budget);
  });
});

describe("size-baseline.json", () => {
  it("names the CDN entry and a positive allowance", () => {
    expect(baseline.file).toBe("dist/register.browser.js");
    expect(baseline.baselineGzip).toBeGreaterThan(0);
    expect(baseline.allowanceGzip).toBeGreaterThan(0);
    expect(baseline.recordedAt).toMatch(/^[0-9a-f]{7,40}$/);
  });
});
