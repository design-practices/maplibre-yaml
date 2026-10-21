/**
 * @file Type-level check: the collection-item helpers infer real field types
 * on zod 3 (Astro 4/5) AND zod 4 (Astro 6/7)
 *
 * @description
 * Runs a real `tsc` over tests/fixtures/collection-types/consumer.ts twice,
 * with `astro/zod` mapped to a copy of the module each Astro major ships
 * (zod 3, zod 4 via `zod/v4`). The fixture is the guides'
 * astro-collections Quick Start reduced to types: `entry.data.title`
 * must be a `string`, `entry.data.location.coordinates` a tuple, custom
 * fields present.
 *
 * Before ml-aot.23, the zod-4 run reported "Type 'unknown' is not assignable
 * to type 'string'" for every field (and the zod-3 run lost custom fields),
 * so a student's `astro check` failed on Astro 6/7. The CI Astro matrix
 * (scripts/astro-matrix.mjs) also `astro check`s the example site's
 * /journal pages built on these helpers on every major.
 */

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURE = join(PKG_ROOT, "tests", "fixtures", "collection-types");

function tsc(project: string): string {
  const bin = createRequire(join(PKG_ROOT, "package.json")).resolve("typescript/bin/tsc");
  try {
    execFileSync(process.execPath, [bin, "-p", join(FIXTURE, project)], {
      cwd: PKG_ROOT,
      encoding: "utf8",
    });
    return "";
  } catch (error) {
    return String((error as { stdout?: string }).stdout ?? error);
  }
}

describe("getCollectionItemWith*Schema() inferred types", () => {
  it("zod 3 host (Astro 4/5): base + custom fields are typed", () => {
    expect(tsc("tsconfig.zod3.json")).toBe("");
  }, 60_000);

  it("zod 4 host (Astro 6/7): base + custom fields are typed, not unknown", () => {
    expect(tsc("tsconfig.zod4.json")).toBe("");
  }, 60_000);
});
