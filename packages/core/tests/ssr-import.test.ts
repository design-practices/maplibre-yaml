/**
 * @file Server-side import safety (ml-7qa.6)
 *
 * @description
 * SSR frameworks (Next.js, SvelteKit, Nuxt, Astro) evaluate a page's
 * modules in Node, where there is no `HTMLElement`, `window` or
 * `customElements`. Importing `@maplibre-yaml/core/register` or
 * `/components` there used to throw `ReferenceError: HTMLElement is not
 * defined`: `class MLMap extends HTMLElement` evaluates its base class when
 * the module loads, before register.ts's `typeof window` guard runs. The
 * elements now extend a guarded base (src/components/base-element.ts);
 * registration stays browser-gated.
 *
 * These tests import the BUILT entry points in a child `node` process —
 * vitest's jsdom environment defines the DOM globals and would hide the
 * bug. They skip when dist/ is absent outside CI (presubmit builds first),
 * as in lazy-chunks.test.ts.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MLMap } from "../src/components/ml-map";
import { MLScrollytelling } from "../src/components/ml-scrollytelling";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const built = ["index.js", "register.js", "components/index.js", "scrollytelling/index.js", "register.browser.js"].every(
  (f) => existsSync(join(PKG_ROOT, "dist", f))
);

if (process.env.CI && !built) {
  throw new Error("dist/ missing under CI — the build step must run before tests");
}

/** The DOM globals a server lacks; the child asserts none exist before importing. */
const DOM_GLOBALS = ["window", "document", "customElements", "HTMLElement", "CSSStyleSheet"];

/**
 * Import `specifier` (resolved through the package's own `exports`, from the
 * package root) in a fresh `node` process and report what it exported.
 */
function importInNode(specifier: string) {
  const script = `
    const missing = ${JSON.stringify(DOM_GLOBALS)}.filter((g) => typeof globalThis[g] !== "undefined");
    if (missing.length) throw new Error("not a DOM-free process: " + missing.join(", "));
    const mod = await import(${JSON.stringify(specifier)});
    process.stdout.write(JSON.stringify({
      exports: Object.keys(mod).sort(),
      MLMap: typeof mod.MLMap,
      customElements: typeof globalThis.customElements,
    }));
  `;
  return spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: PKG_ROOT,
    encoding: "utf8",
    timeout: 60_000,
  });
}

describe.skipIf(!built)("importing the built entry points in Node (no DOM)", () => {
  it.each([
    "@maplibre-yaml/core",
    "@maplibre-yaml/core/register",
    "@maplibre-yaml/core/components",
    "@maplibre-yaml/core/scrollytelling",
    // The CDN build of register (what the root register.js shim re-exports).
    "@maplibre-yaml/core/register.browser",
  ])("%s does not throw", (specifier) => {
    const result = importInNode(specifier);
    expect(result.status, result.stderr).toBe(0);
    const out = JSON.parse(result.stdout) as { exports: string[]; MLMap: string; customElements: string };
    expect(out.exports.length).toBeGreaterThan(0);
    // Registration is browser-gated: nothing invented a registry on the server.
    expect(out.customElements).toBe("undefined");
  });

  it("register and components still export the element classes on the server", () => {
    for (const specifier of ["@maplibre-yaml/core/register", "@maplibre-yaml/core/components"]) {
      const result = importInNode(specifier);
      expect(result.status, result.stderr).toBe(0);
      const out = JSON.parse(result.stdout) as { exports: string[]; MLMap: string };
      expect(out.MLMap).toBe("function");
      expect(out.exports).toEqual(expect.arrayContaining(["MLMap", "MLScrollytelling", "registerMLMap", "registerMLScrollytelling"]));
    }
  });

  it("a module importing register loads through Vite's SSR loader (ssrLoadModule)", () => {
    const result = spawnSync(process.execPath, [join(PKG_ROOT, "tests/fixtures/ssr/vite-ssr-load.mjs")], {
      cwd: PKG_ROOT,
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(result.status, result.stderr).toBe(0);
    const out = JSON.parse(result.stdout) as { exports: string[]; MLMap: string };
    expect(out.MLMap).toBe("function");
    expect(out.exports).toEqual(expect.arrayContaining(["MLMap", "MLScrollytelling", "components"]));
  });
});

describe("in a DOM the elements are still real HTMLElements", () => {
  it("MLMap and MLScrollytelling extend HTMLElement", () => {
    expect(MLMap.prototype).toBeInstanceOf(HTMLElement);
    expect(MLScrollytelling.prototype).toBeInstanceOf(HTMLElement);
  });
});
