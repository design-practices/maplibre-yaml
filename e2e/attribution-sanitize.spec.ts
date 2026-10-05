/**
 * Attribution from an untrusted document — browser verification, which is
 * also the demo (`examples/verification/12-attribution-sanitize.html`).
 *
 * @remarks
 * MapLibre renders attribution with `innerHTML` behind a sanitizer that is
 * bypassable on every maplibre-gl in our peer range (GHSA-jrc7-96c5-q579).
 * `<ml-map>` defaults to the untrusted policy, and the unit suites prove each
 * string is sanitized where we hand it over; only a live map proves the
 * user-visible claim: whatever the document wrote or pointed at, the rendered
 * attribution control contains nothing but text and plain `<a href>` links.
 *
 * The fixtures carry markup of the vulnerability's *class* (elements other
 * than a link, extra attributes, a non-http link), not an exploit: the
 * assertion is structural, so it holds against any bypass of the same shape.
 * Three routes are covered — a source's own `attribution:`, a TileJSON behind
 * a source `url:`, a basemap behind `mapStyle:` — plus `customAttribution`.
 */
import { test, expect, type Page } from "@playwright/test";

const PAGE = "/examples/verification/12-attribution-sanitize.html";

/** Fail on page errors or off-origin requests; record every request made. */
async function guard(page: Page): Promise<{ errors: string[]; requests: string[] }> {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  await page.route("**/*", (route) => {
    const url = route.request().url();
    requests.push(url);
    if (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url) || url.startsWith("data:")) {
      return route.continue();
    }
    errors.push(`external request (suite must stay hermetic): ${url}`);
    return route.abort();
  });
  return { errors, requests };
}

/** Wait until a map's attribution text contains every marker, then return its structure. */
async function attributionOf(page: Page, mapId: string, markers: string[]) {
  await page.waitForFunction(
    ({ mapId, markers }) => {
      const inner = document
        .getElementById(mapId)
        ?.querySelector(".maplibregl-ctrl-attrib-inner");
      const text = inner?.textContent ?? "";
      return markers.every((m) => text.includes(m));
    },
    { mapId, markers },
    { timeout: 60_000 }
  );
  return page.evaluate((mapId) => {
    const inner = document
      .getElementById(mapId)!
      .querySelector(".maplibregl-ctrl-attrib-inner")!;
    return {
      text: inner.textContent ?? "",
      elements: Array.from(inner.querySelectorAll("*")).map((el) => ({
        tag: el.tagName,
        attributes: Array.from(el.attributes).map((a) => a.name),
        href: el.getAttribute("href"),
      })),
    };
  }, mapId);
}

function expectOnlySafeLinks(
  elements: { tag: string; attributes: string[]; href: string | null }[]
) {
  for (const el of elements) {
    expect(el.tag, "only <a> elements may render in attribution").toBe("A");
    for (const name of el.attributes) {
      expect(["href", "target", "rel"], `attribute ${name} on a link`).toContain(name);
    }
    expect(el.href ?? "").toMatch(/^(https?|mailto):/);
  }
}

test("document, TileJSON and basemap attribution render as text and plain links", async ({
  page,
}) => {
  const { errors, requests } = await guard(page);
  await page.goto(PAGE, { waitUntil: "domcontentloaded" });

  const { text, elements } = await attributionOf(page, "map", [
    "DOC ATTRIB",
    "TILEJSON ATTRIB",
    "BASEMAP ATTRIB",
  ]);

  // The markup is still there for a reader — as literal text.
  expect(text).toContain('<span data-probe="doc">');
  expectOnlySafeLinks(elements);
  // The two well-formed https links survive, minus their extra attributes;
  // the javascript: one is unwrapped to its text. MapLibre's own default
  // credit is untouched (the renderer's stand-in control keeps its defaults).
  expect(elements.map((e) => e.href).sort()).toEqual([
    "https://basemap.test/",
    "https://doc.test/",
    "https://maplibre.org/",
  ]);
  expect(text).toContain("tilejson link");

  // Nothing in any attribution was ever parsed into a loading element.
  expect(requests.filter((u) => u.includes("__attribution_probe"))).toEqual([]);
  expect(await page.locator("[data-probe]").count()).toBe(0);
  expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
});

test("controls.attribution customAttribution renders as text and plain links", async ({
  page,
}) => {
  const { errors, requests } = await guard(page);
  await page.goto(PAGE, { waitUntil: "domcontentloaded" });

  const { text, elements } = await attributionOf(page, "map-control", [
    "CUSTOM ATTRIB",
    "custom link",
  ]);

  expect(text).toContain('<img src="/__attribution_probe.png">');
  expectOnlySafeLinks(elements);
  expect(elements.map((e) => e.href)).toEqual(["mailto:data@example.test"]);
  expect(requests.filter((u) => u.includes("__attribution_probe"))).toEqual([]);
  expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
});
