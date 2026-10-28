/**
 * @file The story stylesheet ships minified in the browser builds (ml-7qa, R2, KTD2)
 *
 * @description
 * tsup.config.ts's `minifyStoryCss` plugin rewrites `SCROLLYTELLING_CSS`
 * (`src/scrollytelling/styles.ts`) to esbuild-minified CSS as the browser
 * builds load it. The source and `dist/scrollytelling.css` (emitted from
 * source, for Astro) keep the readable rules. Skips when the package is not
 * built, as bundle-size.test.ts does.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SCROLLYTELLING_CSS } from "../../src/scrollytelling/styles";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const DIST = join(PKG_ROOT, "dist");
const read = (f: string) => readFileSync(join(DIST, f), "utf8");

const READABLE_SELECTOR = 'ml-scrollytelling > script[type="application/toml"]';
const MINIFIED_SELECTOR = 'ml-scrollytelling>script[type="application/toml"]';
/** Comment text from styles.ts, which minification drops. */
const COMMENTS = ["Chapter column, pulled up over the map", "Keyboard focus: a dark ring with a white halo"];

const built = ["register.browser.js", "scrollytelling.css"].every((f) => existsSync(join(DIST, f)));
if (process.env.CI && !built) throw new Error("dist/ missing under CI — the build step must run before tests");

describe("the source stays readable", () => {
  it("SCROLLYTELLING_CSS keeps its spacing and comments", () => {
    expect(SCROLLYTELLING_CSS).toContain(READABLE_SELECTOR);
    for (const text of COMMENTS) expect(SCROLLYTELLING_CSS).toContain(text);
  });
});

describe.skipIf(!built)("the builds", () => {
  // index.browser.js (the public API) has no story element, so no stylesheet to check.
  it("register.browser.js carries the minified stylesheet, without its comments", () => {
    const code = read("register.browser.js");
    expect(code.includes(MINIFIED_SELECTOR), MINIFIED_SELECTOR).toBe(true);
    expect(code.includes(READABLE_SELECTOR), READABLE_SELECTOR).toBe(false);
    for (const text of COMMENTS) expect(code.includes(text), text).toBe(false);
  });

  it("dist/scrollytelling.css is the readable source, unchanged", () => {
    expect(read("scrollytelling.css")).toContain(SCROLLYTELLING_CSS.trim());
  });
});
