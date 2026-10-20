/**
 * 0.9 accessibility + languages — browser verification, which is also the
 * demo (examples/verification/i18n/).
 *
 * @remarks
 * The unit suites prove the attributes and strings we set; only a browser
 * proves what assistive tech gets: the accessibility tree (Playwright's
 * `getByRole` + accessible name/description, computed the way a screen
 * reader is given them), MapLibre's own control labels and ours changing
 * together from one `locale:` table, the plain-map legend header, and Intl
 * number formats in a real popup. Runs on whichever maplibre-gl the e2e
 * server vendors (the CI matrix covers 4, 5 and 6).
 *
 * `I18N_SHOTS=<dir>` also saves a screenshot per page (for review).
 */
import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = "/examples/verification/i18n";
const SHOTS = process.env["I18N_SHOTS"];

/** Hermetic: only this server. Page errors fail the test. */
async function guard(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url) || /^(data|blob):/.test(url)) {
      return route.continue();
    }
    errors.push(`external request (suite must stay hermetic): ${url}`);
    return route.abort();
  });
  return errors;
}

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(400); // let panel transitions settle
  await page.screenshot({ path: join(SHOTS, `i18n_${name}.png`) });
}

/** Open a map page and wait for the map to load. */
async function openMap(page: Page, query: string): Promise<void> {
  await page.goto(`${BASE}/index.html?${query}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => {
      const el = document.querySelector("ml-map") as unknown as { isLoaded?: () => boolean };
      return el?.isLoaded?.() === true;
    },
    undefined,
    { timeout: 60_000 }
  );
}

test.describe("map name and description in the accessibility tree", () => {
  test("a titled map is a region with the document's name and description", async ({ page }) => {
    const errors = await guard(page);
    await openMap(page, "doc=titled&lang=es");
    const region = page.getByRole("region", { name: "Vulnerabilidad al calor en el Bronx" });
    await expect(region).toHaveCount(1);
    await expect(region).toHaveAccessibleDescription(
      "Distritos sombreados de amarillo pálido (bajo) a rojo oscuro (alto); los valores más altos se concentran junto a la autopista Cross Bronx."
    );
    // It is MapLibre's canvas, still focusable (keyboard pan/zoom).
    await expect(region).toHaveClass(/maplibregl-canvas/);
    await expect(region).toHaveAttribute("tabindex", "0");
    // The description is in the page (browse mode reads it), not shown.
    const description = page.locator(".ml-map-description");
    await expect(description).toHaveCount(1);
    expect(await description.evaluate((el) => el.getBoundingClientRect().width)).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });

  test("an untitled map keeps MapLibre's generic name", async ({ page }) => {
    const errors = await guard(page);
    await openMap(page, "doc=plain");
    await expect(page.getByRole("region", { name: "Map", exact: true })).toHaveCount(1);
    await expect(page.locator(".ml-map-description")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("format v2: the same keys at the top level", async ({ page }) => {
    const errors = await guard(page);
    await openMap(page, "doc=v2&lang=de");
    const region = page.getByRole("region", { name: "Hitzerisiko in der Bronx" });
    await expect(region).toHaveAccessibleDescription("Bezirke von hellgelb (niedrig) bis dunkelrot (hoch).");
    // runtime.map.locale: MapLibre's buttons and our legend header together.
    await expect(page.getByRole("button", { name: "Vergrößern" })).toBeVisible();
    await expect(page.locator("summary.legend-title")).toHaveText("Legende");
    await shot(page, "v2-de");
    expect(errors).toEqual([]);
  });
});

test.describe("one locale: table for MapLibre's strings and ours", () => {
  test("MapLibre's zoom buttons, the legend header and the notice are all Spanish", async ({ page }) => {
    const errors = await guard(page);
    await openMap(page, "doc=titled&lang=es");
    // MapLibre's own control strings, from the document's locale:.
    await expect(page.getByRole("button", { name: "Acercar" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Alejar" })).toBeVisible();
    // Ours, from the same table.
    await expect(page.locator("summary.legend-title")).toHaveText("Leyenda");
    const notice = page.locator(".ml-map-notice");
    await expect(notice).toBeVisible({ timeout: 30_000 });
    await expect(notice.locator("strong")).toHaveText("Parte de este mapa no se pudo cargar");
    await expect(notice.locator("summary")).toHaveText("Detalles para quien hizo el sitio");
    await expect(page.getByRole("button", { name: "Cerrar este aviso" })).toBeVisible();
    await shot(page, "titled-es");
    // The 404 itself is logged, never thrown.
    expect(errors).toEqual([]);
  });
});

test.describe("legend header (0.9)", () => {
  test("a plain map's legend header reads Legend; its title is a heading inside", async ({ page }) => {
    const errors = await guard(page);
    await openMap(page, "doc=plain");
    const legend = page.locator("details.maplibre-legend");
    await expect(legend).toBeVisible();
    // 0.8 put "Places" in the header. Now the header says what it is…
    await expect(legend.locator("summary")).toHaveText("Legend");
    // …and the author's title heads the panel, above the entries.
    await expect(legend.locator(".legend-heading")).toHaveText("Places");
    await expect(legend.locator(".legend-item")).toHaveCount(2);
    // Closing the panel hides the heading with the entries.
    await legend.locator("summary").click();
    await expect(legend.locator(".legend-heading")).toBeHidden();
    await legend.locator("summary").click();
    await shot(page, "plain-legend");
    expect(errors).toEqual([]);
  });
});

test.describe("Intl number formats in popups", () => {
  async function openPopup(page: Page, lang: string) {
    await openMap(page, `doc=titled&lang=${lang}`);
    const point = await page.waitForFunction(
      () => {
        const el = document.querySelector("ml-map") as any;
        const map = el?.getMap?.();
        if (!map || !map.getLayer?.("tract")) return null;
        const p = map.project([-73.88, 40.84]);
        if (map.queryRenderedFeatures(p, { layers: ["tract"] }).length === 0) return null;
        const r = map.getCanvas().getBoundingClientRect();
        return { x: r.left + p.x, y: r.top + p.y };
      },
      undefined,
      { timeout: 60_000 }
    );
    const { x, y } = (await point.jsonValue())!;
    await page.mouse.click(x, y);
    const popup = page.locator(".maplibregl-popup-content");
    await expect(popup).toBeVisible();
    return popup;
  }

  const norm = (s: string | null) => (s ?? "").replace(/[  ]/g, " ");

  test("de: decimal comma, euro after the amount, a fixed en-US format stays en-US", async ({ page }) => {
    const errors = await guard(page);
    const popup = await openPopup(page, "de");
    const text = norm(await popup.textContent());
    expect(text).toContain("Residents: 1.234.567,9");
    expect(text).toContain("Rent: 12,50 €");
    expect(text).toContain("Share: 3.14");
    // MapLibre's close button, from the same locale: table.
    await expect(page.getByRole("button", { name: "Cerrar", exact: true })).toBeVisible();
    await shot(page, "popup-de");
    expect(errors).toEqual([]);
  });

  test("en: the same document formats for an English page", async ({ page }) => {
    const errors = await guard(page);
    const popup = await openPopup(page, "en");
    const text = norm(await popup.textContent());
    expect(text).toContain("Residents: 1,234,567.9");
    expect(text).toContain("Rent: €12.50");
    expect(text).toContain("Share: 3.14");
    expect(errors).toEqual([]);
  });
});

test.describe("stories", () => {
  test("the story map has the story's name; rail and legend speak its locale", async ({ page }) => {
    const errors = await guard(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${BASE}/story.html`, { waitUntil: "domcontentloaded" });
    const region = page.getByRole("region", { name: "Cruzando el puente de Brooklyn" });
    await expect(region).toHaveCount(1, { timeout: 60_000 });
    await expect(region).toHaveAccessibleDescription("Un paseo de Manhattan a Brooklyn en dos capítulos.");
    // The chapter rail.
    const rail = page.getByRole("navigation", { name: "Capítulos" });
    await expect(rail).toBeVisible();
    await expect(rail.getByRole("button", { name: "Ir al capítulo 2: El puente" })).toHaveCount(1);
    // The legend button (same behaviour as 0.8.1), translated; title inside.
    const toggle = page.getByRole("button", { name: "Leyenda" });
    await expect(toggle).toBeVisible();
    await toggle.click();
    const panel = page.getByRole("region", { name: "Lugares" });
    await expect(panel).toBeVisible();
    await expect(panel.locator(".scrolly-legend-heading")).toHaveText("Lugares");
    // MapLibre's controls on the story map, from the same table.
    await expect(page.getByRole("button", { name: "Acercar" })).toBeVisible();
    await shot(page, "story-es");
    expect(errors).toEqual([]);
  });
});
