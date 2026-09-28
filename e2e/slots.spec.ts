/**
 * <ml-map> slots (U9) — browser verification, which is also the demo.
 *
 * @remarks
 * The unit suites prove slot children are collected, handed to the
 * renderer, and parked across teardown. What only a real browser proves:
 * the author markup actually lands in the same corner as the built-in
 * legend and params panel and stacks with them WITHOUT overlapping (KTD10),
 * the buttons drive the live map (the behavior FullPageMap's hand-rolled
 * chrome never had), and everything survives reload() of an inline-YAML
 * document — whose script the pre-0.7 `innerHTML = ""` wipe destroyed.
 */
import { test, expect, type Page } from "@playwright/test";

const PAGE = "/examples/verification/12-slots.html";

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

async function waitForChrome(page: Page) {
  // Slot children mount on the map's load, after the built-in chrome.
  await page.waitForFunction(
    () =>
      document.querySelector(".ml-map-chrome-top-right #controls") !== null &&
      document.querySelector(".ml-map-chrome-bottom-left #caption") !== null,
    undefined,
    { timeout: 60_000 }
  );
}

const zoom = (page: Page) =>
  page.evaluate(() => (document.getElementById("map") as any).getMap().getZoom());

test("slot children stack with the legend and params panel, and drive the map", async ({ page }) => {
  const errors = await guard(page);
  await page.goto(PAGE, { waitUntil: "domcontentloaded" });
  await waitForChrome(page);

  // One corner, registration order: legend, params panel, author controls.
  const order = await page.evaluate(() =>
    Array.from(document.querySelector(".ml-map-chrome-top-right")!.children).map((c) =>
      c.classList.contains("ml-map-legend")
        ? "legend"
        : c.querySelector(".ml-map-params")
          ? "params"
          : c.id
    )
  );
  expect(order).toEqual(["legend", "params", "controls"]);

  // Stacked, not overlapping: each piece starts below the previous one.
  const boxes = await page.evaluate(() =>
    Array.from(document.querySelector(".ml-map-chrome-top-right")!.children).map((c) => {
      const r = c.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, height: r.height };
    })
  );
  for (const box of boxes) expect(box.height).toBeGreaterThan(0);
  for (let i = 1; i < boxes.length; i++) {
    expect(boxes[i].top).toBeGreaterThanOrEqual(boxes[i - 1].bottom);
  }

  // The buttons work against the live map.
  const start = await zoom(page);
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect.poll(() => zoom(page)).toBeCloseTo(start + 1, 5);
  await page.getByRole("button", { name: "Reset view" }).click();
  await expect.poll(() => zoom(page)).toBeCloseTo(start, 5);

  expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
});

test("reload() of an inline-YAML document keeps its script and its slot children", async ({ page }) => {
  const errors = await guard(page);
  await page.goto(PAGE, { waitUntil: "domcontentloaded" });
  await waitForChrome(page);
  const firstMap = await page.evaluate(() => {
    const map = (document.getElementById("map") as any).getMap();
    (window as any).__firstMap = map;
    return Boolean(map);
  });
  expect(firstMap).toBe(true);

  await page.getByRole("button", { name: "Reload" }).click();

  // A NEW map (the reload really re-rendered from the inline script) ...
  await page.waitForFunction(
    () => {
      const map = (document.getElementById("map") as any).getMap();
      return map && map !== (window as any).__firstMap && map.loaded();
    },
    undefined,
    { timeout: 60_000 }
  );
  // ... with the same author elements re-mounted in their corners.
  await waitForChrome(page);
  expect(await page.locator("ml-map script[type='text/yaml']").count()).toBe(1);
  expect(await page.locator("#controls").count()).toBe(1);

  // The same button elements (listeners intact) drive the new map.
  const start = await zoom(page);
  await page.getByRole("button", { name: "Zoom out" }).click();
  await expect.poll(() => zoom(page)).toBeCloseTo(start - 1, 5);

  expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
});
