/**
 * Sprite/asset pipeline — browser verification (U4, R7, AE1's mechanism).
 *
 * @remarks
 * The whole pipeline in one hermetic pass: core describes a hatch tile
 * (deterministic SVG + KTD6 name), the CLI's rasterizer composites the
 * standard four-file sprite set, and a PLAIN `new maplibregl.Map(...)` —
 * zero library code in the page — renders a fill-pattern layer whose icon
 * resolves through the `mlym` sprite id. If any stage lies (blank sheet,
 * wrong index geometry, prefix mismatch), the pattern probe fails.
 *
 * The fixture is generated at test time by a real-Node script inside
 * packages/cli (so the bare `@maplibre-yaml/core` import resolves the way a
 * consumer's does) into e2e/generated/ (gitignored), served by
 * e2e/server.mjs like any other repo path.
 */
import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const OUT_DIR = join(process.cwd(), "e2e/generated/sprite-u4");
// Same port the config serves on (VERIFY_PORT), or the emitted URLs miss the server.
const BASE_URL = `http://localhost:${process.env.VERIFY_PORT ?? 4174}/e2e/generated/sprite-u4`;

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
    ["--import", "tsx", "scripts/generate-sprite-fixture.ts", OUT_DIR, BASE_URL],
    { cwd: join(process.cwd(), "packages/cli"), stdio: "pipe" }
  );
});

test.describe("sprite pipeline: emitted assets render as a fill pattern in vanilla maplibre", () => {
  test("the hatch pattern draws (icon resolved through the mlym sprite id)", async ({
    page,
  }) => {
    const errors = await guard(page);
    await page.goto("/e2e/generated/sprite-u4/index.html", { waitUntil: "domcontentloaded" });

    await page.waitForFunction(
      () => {
        const map = (window as any).__sprite?.map;
        return map?.isStyleLoaded?.() && map.getLayer?.("hatched");
      },
      undefined,
      { timeout: 60_000 }
    );

    // The polygon is on screen…
    await page.waitForFunction(
      () =>
        (window as any).__sprite.map.queryRenderedFeatures(undefined, { layers: ["hatched"] })
          .length > 0,
      undefined,
      { timeout: 30_000 }
    );

    // …and the sprite image actually resolved onto the map under its
    // prefixed name (registration-level check; a missing icon only warns,
    // which the guard does not catch)…
    const hasImage = await page.evaluate(() => {
      const s = (window as any).__sprite;
      return s.map.hasImage(s.pattern);
    });
    expect(hasImage, "sprite image did not resolve onto the map").toBe(true);

    // …and the pattern PAINTED INK. hasImage + queryRenderedFeatures both
    // pass with a fully transparent sheet; only pixels prove the composite.
    // The stroke color is #7b2cbf over a white background — count canvas
    // pixels that are decidedly purple-ish.
    const inked = await page.evaluate(() => {
      const canvas = document.querySelector("#map canvas.maplibregl-canvas") as HTMLCanvasElement;
      const gl2d = document.createElement("canvas");
      gl2d.width = canvas.width;
      gl2d.height = canvas.height;
      const ctx = gl2d.getContext("2d")!;
      ctx.drawImage(canvas, 0, 0);
      const { data } = ctx.getImageData(0, 0, gl2d.width, gl2d.height);
      let purple = 0;
      for (let i = 0; i < data.length; i += 4) {
        const [r, g, b] = [data[i]!, data[i + 1]!, data[i + 2]!];
        if (b > 120 && r < 200 && g < 120 && b > r) purple++;
      }
      return purple;
    });
    expect(inked, "no stroke-colored pixels on the canvas — blank sprite sheet?").toBeGreaterThan(
      100
    );

    expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
  });
});
