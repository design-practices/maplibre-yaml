/**
 * Documents in YAML, JSON and TOML (ml-4cn, U4) — browser verification,
 * which is also the demo (examples/verification/document-formats.html).
 *
 * @remarks
 * Every way a page hands `<ml-map>` or `<ml-scrollytelling>` a document
 * reads all three formats through the one front door, and the newest
 * document wins. Asserted here, against the CDN build:
 *
 *  - `src` (.toml), an inline `application/toml` script, the `config`
 *    attribute with TOML and with JSON text, and `update(tomlText)` all
 *    draw (AE1), and a story from a `.toml` src renders its chapters;
 *  - the TOML reader (`dist/chunks/toml.js`) is requested once for the
 *    whole page, and never by a page with only YAML and JSON (AE6);
 *  - the race from the plan's sequence diagram: a `src` TOML document in
 *    flight is dropped when `update(yaml)` overtakes it, and an overtaken
 *    `update(tomlText)` resolves `superseded`;
 *  - an inline script of an unsupported type is named in the card (R5);
 *  - a blocked TOML reader shows the TOML-reader card for each TOML
 *    document while the YAML and JSON maps draw, refuses `update(tomlText)`
 *    on a running map with kind "chunk" (no card), and `reload()` asks for
 *    the file again under a `?retry=` URL and renders (R19).
 *
 * Outcomes are read from the elements' promises and DOM events, never from
 * polled flags. Requires `pnpm build` (core's dist/).
 */
import { test, expect, type Page } from "@playwright/test";

const PAGE = "/examples/verification/document-formats.html";

/** Page errors (an unhandled rejection is one) and off-origin requests. */
async function guard(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url) || /^(data|blob):/.test(url)) return route.fallback();
    errors.push(`external request (suite must stay hermetic): ${url}`);
    return route.abort();
  });
  return errors;
}

/** Every request for the TOML reader, by its query (`?retry=1`), as the page made them. */
function tomlAsks(page: Page): string[] {
  const asks: string[] = [];
  page.on("request", (r) => {
    const url = new URL(r.url());
    if (url.pathname.endsWith("/chunks/toml.js")) asks.push(url.search || "(no query)");
  });
  return asks;
}

/** Wait until a layer has rendered features. */
async function waitForLayer(page: Page, mapId: string, layer: string) {
  await page.waitForFunction(
    ({ mapId, layer }) => {
      const map = (document.getElementById(mapId) as any)?.getMap?.();
      return Boolean(map?.getLayer(layer)) && map.queryRenderedFeatures(undefined, { layers: [layer] }).length > 0;
    },
    { mapId, layer },
    { timeout: 45_000 }
  );
}

const ready = (page: Page, id: string) => page.evaluate((id) => (document.getElementById(id) as any).mapReady().then(() => true), id);

test.describe("documents in YAML, JSON and TOML (U4)", () => {
  test("AE1: src, inline script, config attribute (TOML and JSON) and a TOML story all draw; the TOML reader loads once", async ({
    page,
  }) => {
    const errors = await guard(page);
    const asks = tomlAsks(page);
    await page.goto(PAGE, { waitUntil: "domcontentloaded" });
    for (const [id, layer] of [
      ["toml-src", "toml-src-dots"],
      ["toml-inline", "toml-inline-dot"],
      ["toml-attr", "toml-attr-dot"],
      ["json-attr", "json-attr-dot"],
      ["update", "update-dot"],
    ] as const) {
      await ready(page, id);
      await waitForLayer(page, id, layer);
    }
    // The documents arrived as documents: what each map shows came from its own text.
    expect(await page.evaluate(() => (document.getElementById("toml-attr") as any).getDocument().id)).toBe("toml-attr");
    expect(await page.evaluate(() => (document.getElementById("json-attr") as any).getDocument().id)).toBe("json-attr");

    // The story from story.toml: its chapters, and its map with the story's layer.
    await ready(page, "story");
    await expect(page.locator("#story .scrolly-chapter")).toHaveCount(2);
    await expect(page.locator("#story .scrolly-chapter").first()).toContainText("A story written in TOML");
    expect(await page.evaluate(() => Boolean((document.getElementById("story") as any).getMap().getLayer("toml-story-dot")))).toBe(true);

    // R5: the unsupported type is named; nothing else on the page failed.
    const unsupported = page.locator("#unsupported .ml-map-error");
    await expect(unsupported).toContainText('<script type="text/x-yaml5"> isn\'t a type maplibre-yaml reads');
    await expect(unsupported).not.toContainText("No configuration provided");
    await expect(page.locator(".ml-map-error")).toHaveCount(1);
    await expect(page.locator(".scrolly-error")).toHaveCount(0);

    // The inline TOML document stays hidden.
    await expect(page.locator('script[type="application/toml"]')).toBeHidden();
    // AE6: four TOML documents, one download of the reader.
    expect(asks).toEqual(["(no query)"]);
    // The viewport, not fullPage: a full-page capture blanks WebGL canvases under SwiftShader.
    await page.screenshot({ path: "e2e/results/document_formats.png" });
    expect(errors).toEqual([]);
  });

  test("update(tomlText) applies in place; the race: the newest document wins and the overtaken ones are dropped", async ({ page }) => {
    const errors = await guard(page);
    await page.goto(PAGE, { waitUntil: "domcontentloaded" });
    await ready(page, "update");
    await ready(page, "race");
    // The reader is on the page already (the TOML maps above loaded it).
    await ready(page, "toml-attr");

    // update(tomlText) resolves with the real outcome, and the map changed in place.
    const result = await page.evaluate(() => (window as any).updateWithToml());
    expect(result.outcome).toBe("applied");
    expect(result.summary.rebuild).toBe(false);
    expect(
      await page.evaluate(() => (document.getElementById("update") as any).getMap().getPaintProperty("update-dot", "circle-color"))
    ).toBe("#e9c46a");
    await expect(page.locator("#update-outcome")).toHaveText("applied");

    // The race (sequence diagram): src=race.toml in flight, then update(yaml).
    const raceFile = page.waitForEvent("requestfinished", (r) => r.url().endsWith("/document-formats/race.toml"));
    const outcomes = await page.evaluate(() => (window as any).runRace());
    expect(outcomes).toEqual({ src: "dropped", update: "applied", slow: "superseded", fast: "applied" });
    await raceFile;
    // The file's read lands after it finished downloading: give it two frames, then look.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    expect(await page.evaluate(() => (document.getElementById("race") as any).getDocument().id)).toBe("race-yaml-2");
    await waitForLayer(page, "race", "race-yaml-2-dot");
    expect(await page.evaluate(() => Boolean((document.getElementById("race") as any).getMap().getLayer("race-toml-dot")))).toBe(false);
    const raceEvents = await page.evaluate(() =>
      (window as any).__events.filter((e: any) => e.id === "race" && e.type !== "ml-map:load").map((e: any) => e.type)
    );
    // Two applied documents (race-yaml, race-yaml-2); the TOML ones never reached the map.
    expect(raceEvents).toEqual(["ml-map:update-applied", "ml-map:update-applied"]);
    expect(errors).toEqual([]);
  });

  test("AE6: a page with only YAML and JSON documents never requests the TOML reader", async ({ page }) => {
    const errors = await guard(page);
    const asks = tomlAsks(page);
    await page.goto("/examples/verification/inline-json-yaml-scripts.html", { waitUntil: "domcontentloaded" });
    await ready(page, "map");
    await ready(page, "story");
    await waitForLayer(page, "map", "json-point");
    expect(asks).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("a blocked TOML reader: the TOML-reader card for each TOML document, kind 'chunk' on a running map, and reload() retries under ?retry=", async ({
    page,
  }) => {
    const errors = await guard(page);
    const asked: string[] = [];
    let offline = true;
    await page.route("**/chunks/toml.js*", (route) => {
      asked.push(new URL(route.request().url()).search || "(no query)");
      return offline ? route.abort("blockedbyclient") : route.fallback();
    });
    await page.goto(PAGE, { waitUntil: "domcontentloaded" });

    for (const id of ["toml-src", "toml-inline", "toml-attr"]) {
      const card = page.locator(`#${id} .ml-map-error`);
      await expect(card).toContainText("Couldn't read the TOML document", { timeout: 30_000 });
      await expect(card).toContainText("couldn't be downloaded");
      await expect(card).toContainText("reload()");
      await expect(card).not.toContainText("Other layers are unaffected");
    }
    await expect(page.locator("#story .scrolly-error")).toContainText("Couldn't read the TOML document");
    // The YAML and JSON documents need no reader and draw.
    await waitForLayer(page, "json-attr", "json-attr-dot");
    await waitForLayer(page, "update", "update-dot");

    // On a running map, a TOML update is refused (kind "chunk"): no card, the map stays.
    const refused = await page.evaluate(() =>
      new Promise<{ result: any; event: any }>((resolve) => {
        const el = document.getElementById("update") as any;
        let event: any;
        el.addEventListener("ml-map:update-rejected", (e: CustomEvent) => (event = e.detail), { once: true });
        void (window as any).updateWithToml().then((result: any) => resolve({ result, event }));
      })
    );
    expect(refused.result.outcome).toBe("rejected");
    expect(refused.event.kind).toBe("chunk");
    expect(refused.event.errors[0].message).toContain("TOML reader");
    await expect(page.locator("#update .ml-map-error")).toHaveCount(0);
    expect(
      await page.evaluate(() => (document.getElementById("update") as any).getMap().getPaintProperty("update-dot", "circle-color"))
    ).toBe("#8d99ae");

    // Back online: reload() asks for the file again, under a URL of its own
    // (the browser would repeat the failed import without a request), and
    // the config-attribute and src documents render.
    const failedAsks = asked.length;
    expect(failedAsks).toBeGreaterThan(0);
    offline = false;
    await page.evaluate(() => (document.getElementById("toml-attr") as any).reload());
    await ready(page, "toml-attr");
    await waitForLayer(page, "toml-attr", "toml-attr-dot");
    expect(asked.length).toBe(failedAsks + 1);
    expect(asked.at(-1)).toBe(`?retry=${failedAsks}`);
    await page.evaluate(() => (document.getElementById("toml-src") as any).reload());
    await ready(page, "toml-src");
    await waitForLayer(page, "toml-src", "toml-src-dots");
    // The reader is loaded now: no further request.
    expect(asked.length).toBe(failedAsks + 1);
    await expect(page.locator("#toml-attr .ml-map-error, #toml-src .ml-map-error")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
