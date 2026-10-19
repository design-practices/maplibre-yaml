/**
 * The astro-dev viewport hint (ml-aot.33): a page with no viewport meta gets
 * one console warning; a page with one, or a second call, gets none.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { warnIfNoViewport, MISSING_VIEWPORT_HINT } from "../../src/client/dev-hints";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The slice of Document the hint reads. */
function fakeDoc(hasViewport: boolean): Document {
  const win: Record<string, unknown> = {};
  return {
    defaultView: win,
    querySelector: (sel: string) => (sel === 'meta[name="viewport"]' && hasViewport ? {} : null),
  } as unknown as Document;
}

afterEach(() => vi.restoreAllMocks());

describe("missing viewport meta hint", () => {
  it("warns once when the page has no viewport meta", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const doc = fakeDoc(false);
    expect(warnIfNoViewport(doc)).toBe(true);
    expect(warnIfNoViewport(doc)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(MISSING_VIEWPORT_HINT);
    expect(MISSING_VIEWPORT_HINT).toContain('content="width=device-width, initial-scale=1"');
  });

  it("stays quiet when the page has one", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(warnIfNoViewport(fakeDoc(true))).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it("is wired into Map, FullPageMap and Scrollytelling, behind import.meta.env.DEV", () => {
    for (const name of ["Map", "FullPageMap", "Scrollytelling"]) {
      const src = readFileSync(join(HERE, "../../src/components", `${name}.astro`), "utf8");
      expect(src, name).toContain('import "../client/dev-hints";');
    }
    const module = readFileSync(join(HERE, "../../src/client/dev-hints.ts"), "utf8");
    expect(module).toMatch(/if \(import\.meta\.env\.DEV\b/);
  });
});
