/**
 * v0.6.0 format-v2 parser — browser verification, which is also the demo.
 *
 * @remarks
 * The unit suites prove a `version: 2` document validates against
 * {@link MapBlockV2Schema}, reads into the model via `readV2Block`, and emits a
 * spec-valid style. What only a real browser proves is the claim of the
 * release: a full v2 document renders through the flagship `<ml-map>` element
 * (parse -> `toModel` -> render), and — because the renderer reads *only* the
 * internal model, and AE2 makes the v1 and v2 models deep-equal — a v2 document
 * and its v1 twin render indistinguishably. If the renderer ever read the raw
 * document instead of the model, this is exactly where they diverge.
 *
 * The same page a user opens to see the v2 story is the page this test drives.
 */
import { test, expect, type Page } from "@playwright/test";

const PAGE = "/examples/verification/v2/v2-document.html";

/** Fail the test on any page error or off-origin request (hermeticity). */
async function guard(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url) || url.startsWith("data:")) {
      return route.continue();
    }
    errors.push(`external request (suite must stay hermetic): ${url}`);
    return route.abort();
  });
  return errors;
}

test.describe("format v2: renders via <ml-map> and compiles with the emitter", () => {
  test("v2 renders, emits a spec-valid style, and matches its v1 twin", async ({
    page,
  }) => {
    const errors = await guard(page);
    await page.goto(PAGE, { waitUntil: "domcontentloaded" });

    // Both the v2 document and its v1 twin render through the flagship <ml-map>
    // element: each element's MapLibre map has loaded its style and `dot` layer.
    await page.waitForFunction(
      () => {
        const ready = (id: string) => {
          const map = (document.getElementById(id) as any)?.getMap?.();
          return Boolean(map && map.isStyleLoaded?.() && map.getLayer?.("dot"));
        };
        return ready("v2") && ready("v1");
      },
      undefined,
      { timeout: 60_000 }
    );

    // (1) The v2 map actually painted — a real canvas with non-zero extent.
    const painted = await page.evaluate(() => {
      const c = document
        .getElementById("v2")!
        .querySelector("canvas.maplibregl-canvas") as HTMLCanvasElement | null;
      return Boolean(c && c.width > 0 && c.height > 0);
    });
    expect(painted, "v2 map canvas did not paint").toBe(true);

    // (2) The emitted style.json is present, well-formed, and spec-shaped: the
    // style half survived, the runtime half did not.
    const style = await page.evaluate(() => (window as any).__emittedStyle);
    expect(style, "emitted style missing").toBeTruthy();
    expect(style.version).toBe(8);
    const layerIds = style.layers.map((l: { id: string }) => l.id);
    // The basemap's `bg` merged under the document's `area` and `dot`.
    expect(layerIds).toEqual(["bg", "area", "dot"]);
    const serialized = JSON.stringify(style);
    expect(serialized).not.toContain("interactive");
    expect(serialized).not.toContain("refresh");
    expect(serialized).not.toContain("toggleable");

    // (3) The model-purity guard: the v2 and v1 models are deep-equal (AE2), so
    // the two renders are the same render. Diverging models here would be the
    // renderer reading the raw document instead of the model.
    const [v2model, v1model] = await page.evaluate(() => [
      (window as any).__v2model,
      (window as any).__v1model,
    ]);
    expect(v2model).toEqual(v1model);

    // And the visible consequence: both maps carry the same layers, and both
    // paint the same feature at the shared centre.
    const sameRender = await page.evaluate(() => {
      const feat = (id: string) => {
        const map = (document.getElementById(id) as any).getMap();
        const pt = map.project(map.getCenter());
        return {
          layers: map.getStyle().layers.map((l: { id: string }) => l.id),
          dots: map.queryRenderedFeatures(pt, { layers: ["dot"] }).length,
        };
      };
      return { v2: feat("v2"), v1: feat("v1") };
    });
    expect(sameRender.v2).toEqual(sameRender.v1);
    expect(sameRender.v2.dots, "the point feature did not render").toBeGreaterThan(0);

    // (4) No parse warnings on the well-formed v2 document, and no console
    // errors or off-origin requests (the hermetic guard).
    const parseWarnings = await page.evaluate(() => ({
      v2: (window as any).__v2warnings,
      v1: (window as any).__v1warnings,
    }));
    expect(parseWarnings.v2, JSON.stringify(parseWarnings.v2)).toEqual([]);
    expect(parseWarnings.v1, JSON.stringify(parseWarnings.v1)).toEqual([]);
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
