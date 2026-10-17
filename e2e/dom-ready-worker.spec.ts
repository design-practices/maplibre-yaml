/**
 * ml-aot.2 — `<ml-map>` registered before maplibre-gl 6's worker URL is set.
 *
 * @remarks
 * The classroom check found every Astro component map blank ("Worker failed
 * to load") once any other script imported `@maplibre-yaml/core/register`:
 * the bundler moved `register` into a shared chunk, ES-module evaluation ran
 * it before the component's `setWorkerUrl()`, and the elements built their
 * maps in that window. The fixture reproduces exactly that order with real
 * maplibre-gl served from a directory without its worker (as a bundle is),
 * so on maplibre-gl 6 it fails without the DOMContentLoaded deferral and
 * passes with it. On 4/5 (worker inline) it must simply keep working.
 */
import { test, expect, type Page } from "@playwright/test";

const PAGE = "/examples/verification/14-shared-chunk-worker.html";

/** Resolve with the outcome the element reports: loaded or its error. */
function outcome(page: Page) {
  return page.evaluate(async () => {
    await customElements.whenDefined("ml-map");
    const el = document.getElementById("map") as any;
    try {
      // 0.7.0 neither loaded nor errored (the worker failure was non-fatal),
      // so bound the wait and report that instead of timing the test out.
      const map = await Promise.race([
        el.mapReady(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("neither ml-map:load nor a fatal ml-map:error in 30s")), 30_000)
        ),
      ]);
      await new Promise<void>((r) => (map.loaded() ? r() : map.once("idle", () => r())));
      return {
        ok: true,
        poi: map.queryRenderedFeatures({ layers: ["poi"] }).length,
        card: null as string | null,
      };
    } catch (e) {
      return {
        ok: false,
        poi: 0,
        card: (el.querySelector(".ml-map-error")?.textContent ?? "").replace(/\s+/g, " ").trim(),
        message: String((e as Error)?.message ?? e),
      };
    }
  });
}

test("a map upgraded before the worker URL is set still renders (shared-chunk order)", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  await page.goto(PAGE);

  const result = await outcome(page);
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
  // The fixture really does set the worker URL from a module script, which
  // runs with readyState already "interactive" — why the element keys its
  // wait on DOMContentLoaded, not on readyState === "loading".
  expect(await page.evaluate(() => (window as any).__workerOrder.readyStateAtSetup)).toBe("interactive");
  expect(result.poi).toBeGreaterThan(0);
  expect(await page.locator(".ml-map-error").count()).toBe(0);
  expect(errors.filter((e) => /worker/i.test(e))).toEqual([]);
});

test("with no worker URL at all, maplibre-gl 6 shows an on-page error card naming setWorkerUrl()", async ({ page }) => {
  page.on("console", () => {});
  await page.goto(`${PAGE}?noworker`);
  const major = await page.evaluate(async () => {
    const gl = await import("maplibre-gl" as string);
    return Number(gl.getVersion().split(".")[0]);
  });
  test.skip(major < 6, "maplibre-gl 4/5 carry their worker inline");

  const result = await outcome(page);
  expect(result.ok).toBe(false);
  expect(result.card).toContain("Map Error");
  expect(result.card).toMatch(/Worker failed to load/i);
  expect(result.card).toContain("setWorkerUrl()");
});
