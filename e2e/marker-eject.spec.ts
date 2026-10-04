/**
 * Markers eject — browser verification of AE1's marker half (U5).
 *
 * @remarks
 * A `markers:` document is compiled by the REAL emit pipeline (lowering →
 * projection → sprite attach → rasterize; see the fixture generator in
 * packages/cli) and rendered by a plain `new maplibregl.Map(...)` with zero
 * library code. The symbol layer must exist, put features on screen, resolve
 * its prefixed pin icons, and paint ink — the pin-colored pixels are what a
 * blank sprite can't fake.
 */
import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const OUT_DIR = join(process.cwd(), "e2e/generated/marker-eject");
// Same port the playwright config serves on (VERIFY_PORT for parallel worktrees).
const BASE_URL = `http://localhost:${process.env.VERIFY_PORT ?? 4174}/e2e/generated/marker-eject`;

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

test.beforeAll(() => {
  execFileSync(
    "node",
    ["--import", "tsx", "scripts/generate-marker-eject-fixture.ts", OUT_DIR, BASE_URL],
    { cwd: join(process.cwd(), "packages/cli"), stdio: "pipe" }
  );
});

test.describe("markers eject: the emitted style renders pins in vanilla maplibre (AE1)", () => {
  test("the lowered symbol layer draws its generated pin sprites", async ({ page }) => {
    const errors = await guard(page);
    await page.goto("/e2e/generated/marker-eject/index.html", { waitUntil: "domcontentloaded" });

    await page.waitForFunction(
      () => {
        const s = (window as any).__eject;
        return s?.map?.isStyleLoaded?.() && s.map.getLayer(s.layerId);
      },
      undefined,
      { timeout: 60_000 }
    );

    // The pins are real rendered features…
    await page.waitForFunction(
      () => {
        const s = (window as any).__eject;
        return s.map.queryRenderedFeatures(undefined, { layers: [s.layerId] }).length > 0;
      },
      undefined,
      { timeout: 30_000 }
    );

    // …their prefixed sprite icons resolved…
    const iconsResolved = await page.evaluate(() => {
      const s = (window as any).__eject;
      const features = s.map.queryRenderedFeatures(undefined, { layers: [s.layerId] });
      return features.every((f: any) => s.map.hasImage(`mlym:${f.properties["mlym:icon"]}`));
    });
    expect(iconsResolved, "a pin icon did not resolve through the mlym sprite").toBe(true);

    // …and ink hit the canvas (the red pin over a white background).
    const inked = await page.evaluate(() => {
      const canvas = document.querySelector("#map canvas.maplibregl-canvas") as HTMLCanvasElement;
      const ctx2d = document.createElement("canvas");
      ctx2d.width = canvas.width;
      ctx2d.height = canvas.height;
      const ctx = ctx2d.getContext("2d")!;
      ctx.drawImage(canvas, 0, 0);
      const { data } = ctx.getImageData(0, 0, ctx2d.width, ctx2d.height);
      let red = 0;
      for (let i = 0; i < data.length; i += 4) {
        const [r, g, b] = [data[i]!, data[i + 1]!, data[i + 2]!];
        if (r > 150 && g < 120 && b < 120) red++;
      }
      return red;
    });
    expect(inked, "no pin-colored pixels — blank sprite sheet?").toBeGreaterThan(50);

    expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
  });
});
