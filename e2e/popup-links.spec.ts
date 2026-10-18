/**
 * Popup link items (ml-aot.29) — browser verification, which is also the demo.
 *
 * @remarks
 * The unit tests prove the builder's HTML string. Only a browser proves what a
 * student sees: a real click on the feature opens the popup, the `str` +
 * `href` item is a live link (it used to render as plain text, the URL
 * silently dropped), a `_blank` link opens a new tab without handing over the
 * opener, a `target: _self` link navigates the same tab, and parsing the
 * document no longer warns `Unknown key "target"`.
 */
import { test, expect, type Page } from "@playwright/test";

const PAGE = "/examples/verification/15-popup-links.html";
const WIKI = "https://en.wikipedia.org/wiki/Chicago";

async function guard(page: Page): Promise<{ errors: string[]; warnings: string[] }> {
  const errors: string[] = [];
  const warnings: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
    if (m.type() === "warning") warnings.push(m.text());
  });
  // Context-level, so the new tab a `_blank` link opens is covered too. The
  // Wikipedia link is answered with a stub page: the suite stays hermetic.
  await page.context().route("**/*", (route) => {
    const url = route.request().url();
    if (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url) || /^(data|blob):/.test(url)) {
      return route.continue();
    }
    if (url === WIKI) {
      return route.fulfill({ contentType: "text/html", body: "<title>stub</title>stub" });
    }
    errors.push(`external request (suite must stay hermetic): ${url}`);
    return route.abort();
  });
  return { errors, warnings };
}

/** Click the city dot with the real mouse and wait for its popup. */
async function openPopup(page: Page) {
  await page.goto(PAGE, { waitUntil: "domcontentloaded" });
  const point = await page.waitForFunction(
    () => {
      const el = document.querySelector("ml-map") as any;
      const map = el?.getMap?.();
      if (!map || !map.isStyleLoaded?.() || !map.getLayer?.("city")) return null;
      const p = map.project([-87.623, 41.881]);
      if (map.queryRenderedFeatures(p, { layers: ["city"] }).length === 0) return null;
      const r = map.getCanvas().getBoundingClientRect();
      return { x: r.left + p.x, y: r.top + p.y };
    },
    undefined,
    { timeout: 60_000 }
  );
  const { x, y } = (await point.jsonValue())!;
  await page.mouse.click(x, y);
  await expect(page.locator(".maplibregl-popup-content")).toBeVisible();
}

test("a str + href popup item is a clickable link that opens a new tab", async ({ page }) => {
  const { errors, warnings } = await guard(page);
  await openPopup(page);

  const link = page.locator(".maplibregl-popup-content a", { hasText: "Wikipedia" });
  await expect(link, "the str + href item rendered as plain text").toHaveCount(1);
  await expect(link).toHaveAttribute("href", WIKI);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");

  // Clickable: the link is the topmost element at its own centre (nothing,
  // e.g. map chrome, intercepts it), and a real click opens the URL.
  const hit = await link.evaluate((a) => {
    const r = a.getBoundingClientRect();
    return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === a;
  });
  expect(hit, "something covers the popup link").toBe(true);
  const [tab] = await Promise.all([page.context().waitForEvent("page"), link.click()]);
  await tab.waitForLoadState("domcontentloaded");
  expect(tab.url()).toBe(WIKI);
  // noopener: the new tab cannot reach back into the map page.
  expect(await tab.evaluate(() => window.opener)).toBeNull();
  await tab.close();

  expect(
    warnings.filter((w) => w.includes("Unknown key")),
    "target/str+href must validate without unknown-key warnings"
  ).toEqual([]);
  expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
});

test("target: _self keeps the link in the same tab", async ({ page }) => {
  const { errors } = await guard(page);
  await openPopup(page);

  const link = page.locator(".maplibregl-popup-content a", { hasText: "Same tab" });
  await expect(link).toHaveAttribute("target", "_self");
  expect(await link.getAttribute("rel")).toBeNull();
  await Promise.all([page.waitForURL(/local-style\.json$/), link.click()]);
  expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
});
