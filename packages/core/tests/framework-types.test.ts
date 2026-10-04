/**
 * @file Type-level regression check for framework consumers of `<ml-map>`
 *
 * @description
 * Runs a real `tsc` over consumer-shaped fixtures against the BUILT
 * declarations (`dist/register.d.ts`, resolved through the package's own
 * `exports` map — what a TypeScript app gets), proving two things:
 *
 *  1. Core's `HTMLElementTagNameMap["ml-map"]` augmentation ships:
 *     `document.querySelector("ml-map")?.mapReady()` type-checks uncast.
 *  2. The React JSX declaration printed in the "TypeScript with React"
 *     section of `integrations/web-components.mdx` compiles against the
 *     current `MLMap` export. It is extracted from the docs VERBATIM at test
 *     time, so the published snippet cannot drift from what passes here.
 *
 * Skips when dist/ is absent, like the maplibre subpath test (presubmit's
 * `build && test` ordering guarantees it in the gate).
 */

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(PKG_ROOT, "dist", "register.d.ts");
const FIXTURE = join(PKG_ROOT, "tests", "fixtures", "framework-types");
const DOC = join(
  PKG_ROOT,
  "..",
  "..",
  "docs",
  "src",
  "content",
  "docs",
  "integrations",
  "web-components.mdx"
);

if (process.env.CI && !existsSync(DIST)) {
  throw new Error(
    "dist/register.d.ts missing under CI — the build step must run before tests"
  );
}

/** The single ```ts fence that declares the React JSX element. */
function documentedReactDeclaration(): string {
  const mdx = readFileSync(DOC, "utf8");
  const blocks = [...mdx.matchAll(/```ts\n([\s\S]*?)```/g)]
    .map((m) => m[1])
    .filter((body) => body.includes('declare module "react"'));
  expect(blocks).toHaveLength(1);
  return blocks[0];
}

describe("framework TypeScript consumers of <ml-map>", () => {
  it.skipIf(!existsSync(DIST))(
    "type-check: tag-name map + the documented React JSX declaration",
    () => {
      mkdirSync(join(FIXTURE, "tmp"), { recursive: true });
      writeFileSync(
        join(FIXTURE, "tmp", "ml-map.d.ts"),
        documentedReactDeclaration()
      );

      const tsc = createRequire(join(PKG_ROOT, "package.json")).resolve(
        "typescript/bin/tsc"
      );
      let output = "";
      try {
        execFileSync(
          process.execPath,
          [tsc, "-p", join(FIXTURE, "tsconfig.json")],
          { cwd: PKG_ROOT, encoding: "utf8" }
        );
      } catch (error) {
        output = String((error as { stdout?: string }).stdout ?? error);
      }
      expect(output).toBe("");
    },
    60_000
  );
});
