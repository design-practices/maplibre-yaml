/**
 * Streaming (`stream: { type: sse }`) on a real map — bundle headroom U3, the
 * characterization the live chunk (U4) must keep passing. The demo is
 * examples/verification/stream-sse.html; the feed is e2e/server.mjs's
 * `/sse/points` (see `streamPoints`): event k adds point p<k> and moves the
 * seed point p0's `seq` to k.
 *
 * @remarks
 * - `#stream`: a named source loads its seed from `url:`, then three SSE
 *   events `merge` in on `id` (1 -> 2 -> 3 -> 4 points).
 * - `#reconnect`: an inline source starting empty, on a custom event type,
 *   whose feed hangs up after its first event. The browser reconnects with
 *   `Last-Event-ID` and the feed resumes; the map ends with all four points.
 * - `#stream-only`: `stream:` with no `refresh:` block never connects and
 *   validation warns (ml-aot.134; a documented rule this pins, not a bug).
 * - ml-7qa.12, the fixes: the `#reconnect` hang-up reaches the page as no
 *   error at all; `#inline-merge` keeps its inline starting point under
 *   `merge`; `#no-reconnect` (`reconnect: false`) stays closed after the
 *   hang-up and says so once; `#unreachable` (a 404 feed) keeps its layer
 *   and data, says so once, and retries `reconnectMaxAttempts` times.
 *
 * The page's status lines carry `data-count` / `data-seq` / `data-conn`, set
 * from `ml-map:layer-data-loaded`, so the spec waits on attributes rather
 * than polling the map.
 */
import { test, expect, type Page, type Request } from "@playwright/test";

const PAGE = "/examples/verification/stream-sse.html";
const STREAM_WARNING = "stream: connects only when the source also has a refresh: block";

/**
 * The data errors the fixtures expect, one each (ml-7qa.12): `#no-reconnect`
 * ending, and `#unreachable` not connecting. `<ml-map>` logs each as it shows
 * it on the notice (the console writes the notice's code spans in quotes). Anything else on the console fails the spec — before the
 * fix the `#reconnect` hang-up logged "The data for layer … didn't load (SSE
 * connection error)" while the browser reconnected.
 */
const EXPECTED_STREAM_ERRORS = /"(no-reconnect|unreachable)-dots" shows the data it has, but isn't getting live updates/;

interface Seen {
  errors: string[];
  warnings: string[];
  streamErrors: string[];
  streams: Request[];
}

/** Record page errors, console output and every request to the SSE feed; refuse off-origin requests. */
async function guard(page: Page): Promise<Seen> {
  const seen: Seen = { errors: [], warnings: [], streamErrors: [], streams: [] };
  page.on("pageerror", (e) => seen.errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") {
      if (EXPECTED_STREAM_ERRORS.test(m.text())) seen.streamErrors.push(m.text());
      // The browser's own line for each request to `#unreachable`'s 404 feed.
      else if (m.text().startsWith("Failed to load resource") && m.location().url.includes("/sse/missing")) return;
      else seen.errors.push(`console: ${m.text()}`);
    }
    if (m.type() === "warning") seen.warnings.push(m.text());
  });
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/sse/")) seen.streams.push(r);
  });
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url) || url.startsWith("data:")) {
      return route.continue();
    }
    seen.errors.push(`external request (suite must stay hermetic): ${url}`);
    return route.abort();
  });
  return seen;
}

async function open(page: Page): Promise<Seen> {
  const seen = await guard(page);
  await page.goto(PAGE, { waitUntil: "domcontentloaded" });
  await page.evaluate(() =>
    Promise.all(Array.from(document.querySelectorAll("ml-map")).map((m: any) => m.mapReady()))
  );
  return seen;
}

/** The features a layer's source holds right now, as `id:seq:conn`, sorted. */
async function sourceFeatures(page: Page, mapId: string, layerId: string): Promise<string[]> {
  return page.evaluate(
    async ({ mapId, layerId }) => {
      const map = (document.getElementById(mapId) as any)?.getMap?.();
      const layer = map?.getStyle()?.layers?.find((l: any) => l.id === layerId);
      const data = layer ? await map.getSource(layer.source)?.getData?.() : null;
      return (data?.features ?? [])
        .map((f: any) => `${f.properties?.id}:${f.properties?.seq}:${f.properties?.conn}`)
        .sort();
    },
    { mapId, layerId }
  );
}

/** The feature counts each `ml-map:layer-data-loaded` reported for one map, repeats collapsed. */
async function loadCounts(page: Page, mapId: string): Promise<number[]> {
  const counts: number[] = await page.evaluate(
    (mapId) => ((window as any).streamDemo.loads[mapId] ?? []).map((l: any) => l.count),
    mapId
  );
  return counts.filter((c, i) => c !== counts[i - 1]);
}

/** The `ml-map:layer-data-error` messages one map fired. */
async function dataErrors(page: Page, mapId: string): Promise<string[]> {
  return page.evaluate(
    (mapId) =>
      ((window as any).streamDemo.dataErrors as string[])
        .filter((e) => e.startsWith(`${mapId}: `))
        .map((e) => e.slice(mapId.length + 2)),
    mapId
  );
}

/** The notice lines on one map. */
const noticeLines = (page: Page, mapId: string) => page.locator(`#${mapId} .ml-map-notice li`);

const status = (page: Page, mapId: string) => page.locator(`output[data-for="${mapId}"]`);

test("an SSE stream beside a refresh block merges each event into the source", async ({ page }) => {
  const seen = await open(page);
  const out = status(page, "stream");

  // The seed from `url:`, then three events: the count steps 1 -> 4 and the
  // seed point is updated in place each time.
  await expect(out).toHaveAttribute("data-count", "4", { timeout: 30_000 });
  await expect(out).toHaveAttribute("data-seq", "3");
  expect(await loadCounts(page, "stream")).toEqual([1, 2, 3, 4]);
  expect(await sourceFeatures(page, "stream", "points-dots")).toEqual([
    "p0:3:first",
    "p1:1:first",
    "p2:2:first",
    "p3:3:first",
  ]);

  // And they draw.
  await page.waitForFunction(
    () => {
      const map = (document.getElementById("stream") as any)?.getMap?.();
      return (map?.queryRenderedFeatures?.(undefined, { layers: ["points-dots"] }) ?? []).length >= 4;
    },
    undefined,
    { timeout: 20_000 }
  );

  // One connection, opened once.
  const mine = seen.streams.filter((r) => new URL(r.url()).search === "?n=3");
  expect(mine).toHaveLength(1);
  expect(seen.errors, seen.errors.join("\n")).toEqual([]);
});

test("the stream reconnects after the server drops it and resumes where it left off", async ({ page }) => {
  const seen = await open(page);
  const out = status(page, "reconnect");

  // Event 1 on the first connection, then the hang-up; events 2 and 3 on the
  // resumed one. All four points arrive, the newest over the resumed feed.
  await expect(out).toHaveAttribute("data-count", "4", { timeout: 30_000 });
  await expect(out).toHaveAttribute("data-seq", "3");
  await expect(out).toHaveAttribute("data-conn", "resumed");
  expect(await sourceFeatures(page, "reconnect", "reconnect-dots")).toEqual([
    "p0:3:resumed",
    "p1:1:first",
    "p2:2:resumed",
    "p3:3:resumed",
  ]);

  expect(await loadCounts(page, "reconnect")).toEqual([2, 3, 4]);

  // Two requests to the feed: the first, and the browser's reconnect. The
  // feed resumed at event 2 (p2 is `resumed`, p1 `first`), so the reconnect
  // carried `Last-Event-ID: 1` (the header itself is added below the layer
  // Playwright can see).
  const mine = seen.streams.filter((r) => r.url().includes("dropAfter=1&event=update"));
  expect(mine).toHaveLength(2);

  // A hang-up the stream reconnects from is not a failure (ml-7qa.12): no
  // data error at any point, so no notice and nothing on the console.
  expect(await dataErrors(page, "reconnect")).toEqual([]);
  await expect(page.locator("#reconnect .ml-map-notice")).toHaveCount(0);
  expect(seen.errors, seen.errors.join("\n")).toEqual([]);
});

test("a stream with no refresh block stays unconnected and validation warns", async ({ page }) => {
  const seen = await open(page);
  const out = status(page, "stream-only");

  // The seed point loads from `url:` as any source's would.
  await expect(out).toHaveAttribute("data-count", "1", { timeout: 30_000 });

  // The warning, in the console and copied onto the page.
  const warned = seen.warnings.filter((w) => w.includes(STREAM_WARNING));
  expect(warned, seen.warnings.join("\n")).toHaveLength(1);
  expect(warned[0]).toContain("sources.ghost.stream");
  await expect(page.locator(".warning[data-capture]")).toContainText(STREAM_WARNING);

  // By the time the connected stream on the same page has had all three
  // events, this one has made no request and still holds only its seed.
  await expect(status(page, "stream")).toHaveAttribute("data-count", "4", { timeout: 30_000 });
  await page.waitForTimeout(1_000);
  expect(seen.streams.filter((r) => r.url().includes("case=stream-only"))).toHaveLength(0);
  await expect(out).toHaveAttribute("data-count", "1");
  expect(await loadCounts(page, "stream-only")).toEqual([1]);
  expect(await sourceFeatures(page, "stream-only", "ghost-dots")).toEqual(["p0:0:seed"]);
  // The other two maps' documents are valid: the warning is this one's only.
  expect(seen.warnings.filter((w) => w.includes("stream:"))).toHaveLength(1);
  expect(seen.errors, seen.errors.join("\n")).toEqual([]);
});

test("merge onto an inline data: block keeps its starting features (ml-7qa.12)", async ({ page }) => {
  const seen = await open(page);
  const out = status(page, "inline-merge");

  // s0 is only in the inline `data:`; the feed's three events merge in
  // beside it (before the fix the first event replaced it: 2, 3, 4).
  await expect(out).toHaveAttribute("data-count", "5", { timeout: 30_000 });
  expect(await loadCounts(page, "inline-merge")).toEqual([3, 4, 5]);
  expect(await sourceFeatures(page, "inline-merge", "inline-dots")).toEqual([
    "p0:3:first",
    "p1:1:first",
    "p2:2:first",
    "p3:3:first",
    "s0:0:seed",
  ]);
  expect(await dataErrors(page, "inline-merge")).toEqual([]);
  expect(seen.errors, seen.errors.join("\n")).toEqual([]);
});

test("reconnect: false keeps a dropped SSE stream closed and says so once (ml-7qa.12)", async ({ page }) => {
  const seen = await open(page);
  const out = status(page, "no-reconnect");

  // Event 1, then the hang-up.
  await expect(out).toHaveAttribute("data-count", "2", { timeout: 30_000 });
  await expect(noticeLines(page, "no-reconnect")).toHaveCount(1, { timeout: 10_000 });
  await expect(noticeLines(page, "no-reconnect")).toContainText("and reconnect: false keeps it closed");

  // The feed's `retry:` is 300 ms: well past it, the browser hasn't
  // reconnected (before the fix it did, and the map reached 4 points).
  await page.waitForTimeout(1_500);
  expect(seen.streams.filter((r) => r.url().includes("case=no-reconnect"))).toHaveLength(1);
  await expect(out).toHaveAttribute("data-count", "2");
  expect(await sourceFeatures(page, "no-reconnect", "no-reconnect-dots")).toEqual(["p0:1:first", "p1:1:first"]);
  expect(await dataErrors(page, "no-reconnect")).toEqual([
    "the stream `/sse/points?n=3&dropAfter=1&case=no-reconnect` closed, and `reconnect: false` keeps it closed",
  ]);
  expect(seen.streamErrors.filter((e) => e.includes('"no-reconnect-dots"'))).toHaveLength(1);
  expect(seen.errors, seen.errors.join("\n")).toEqual([]);
});

test("a stream that can't connect keeps its layer and data, says so once, and retries reconnectMaxAttempts times (ml-7qa.12)", async ({ page }) => {
  const seen = await open(page);
  const unreachable = () => seen.streams.filter((r) => r.url().includes("case=unreachable"));

  // The first request and reconnectMaxAttempts (2) retries, 200 ms then
  // 400 ms apart (±25%); then no more.
  await expect.poll(() => unreachable().length, { timeout: 20_000 }).toBe(3);
  await page.waitForTimeout(2_000);
  expect(unreachable()).toHaveLength(3);

  // The layer is on the map (before the fix it was removed: "Layer
  // `unreachable-dots` didn't draw") and draws its inline point.
  await page.waitForFunction(
    () => {
      const map = (document.getElementById("unreachable") as any)?.getMap?.();
      if (!map?.getLayer?.("unreachable-dots")) return false;
      return (map.queryRenderedFeatures?.(undefined, { layers: ["unreachable-dots"] }) ?? []).length === 1;
    },
    undefined,
    { timeout: 20_000 }
  );
  expect(await sourceFeatures(page, "unreachable", "unreachable-dots")).toEqual(["s0:0:seed"]);

  // One line, for the stream; the retries and giving up add none.
  await expect(noticeLines(page, "unreachable")).toHaveCount(1);
  await expect(noticeLines(page, "unreachable")).toContainText(
    "unreachable-dots shows the data it has, but isn't getting live updates: the stream /sse/missing?case=unreachable couldn't connect."
  );
  expect(await dataErrors(page, "unreachable")).toEqual(["the stream `/sse/missing?case=unreachable` couldn't connect"]);
  expect(seen.streamErrors.filter((e) => e.includes('"unreachable-dots"'))).toHaveLength(1);
  expect(seen.errors, seen.errors.join("\n")).toEqual([]);
});
