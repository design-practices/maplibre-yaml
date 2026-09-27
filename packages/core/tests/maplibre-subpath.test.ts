/**
 * @file Node-ESM smoke test for the `@maplibre-yaml/core/maplibre` subpath
 *
 * @description
 * The regression this guards: maplibre-gl's CJS bundle has no `exports` map,
 * so `export * from "maplibre-gl"` silently loses every named export under
 * real Node ESM (cjs-module-lexer limitation — the exact break that forced
 * the maplibre-interop revert, see renderer/maplibre-interop.ts). Vitest's
 * transform pipeline papers over this, so the only honest proof is a real
 * `node` process importing the built artifact. Skips when dist/ is absent
 * (presubmit's `build && test` ordering guarantees it in the gate).
 */

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(PKG_ROOT, "dist", "maplibre.js");

// In CI the build always precedes tests (presubmit's `build && test`, and
// both ci.yml jobs run Build first) — so an absent dist there means the
// ordering broke, and silently skipping the only real interop guard would
// be exactly the silent-pass this test exists to prevent.
if (process.env.CI && !existsSync(DIST)) {
  throw new Error(
    "dist/maplibre.js missing under CI — the build step must run before tests"
  );
}

describe("the @maplibre-yaml/core/maplibre subpath under real Node ESM", () => {
  it.skipIf(!existsSync(DIST))(
    "exposes addProtocol and the constructor surface as named exports",
    () => {
      // Self-referencing package specifier: resolves through package.json's
      // "exports" map — the same resolution a real consumer gets, which a
      // direct dist path would bypass.
      const script = `
        const m = await import("@maplibre-yaml/core/maplibre");
        if (typeof m.addProtocol !== "function") throw new Error("addProtocol is not a function: " + typeof m.addProtocol);
        if (typeof m.removeProtocol !== "function") throw new Error("removeProtocol is not a function");
        if (typeof m.Map !== "function") throw new Error("Map is not a constructor: " + typeof m.Map);
        if (typeof m.default?.addProtocol !== "function") throw new Error("default namespace missing addProtocol");
        console.log("ok");
      `;
      const out = execFileSync(
        process.execPath,
        ["--input-type=module", "-e", script],
        { cwd: PKG_ROOT, encoding: "utf8" }
      );
      expect(out.trim()).toBe("ok");
    }
  );
});
