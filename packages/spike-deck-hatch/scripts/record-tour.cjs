/**
 * Record the view-change tour for every crosshatch route (U12 spike).
 *   node scripts/record-tour.cjs <origin> <outDir> [gpu]
 * Per route: a webm of the whole tour, a screenshot at each leg's end, fps
 * per leg, errors, and route-integrity checks after each leg.
 */
const { chromium } = require(require.resolve("@playwright/test", { paths: [process.cwd()] }));
const { mkdirSync, writeFileSync, renameSync } = require("node:fs");
const { join } = require("node:path");

const [origin, outDir, gpu] = process.argv.slice(2);
const ROUTES = (process.env.ROUTES ?? "static,deck,custom,post").split(",");
const SIZE = { width: 1000, height: 700 };
mkdirSync(outDir, { recursive: true });

(async () => {
  const args = gpu
    ? ["--use-angle=vulkan", "--enable-features=Vulkan", "--ignore-gpu-blocklist", "--enable-gpu"]
    : ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"];
  const browser = await chromium.launch({ args });
  const report = {};
  for (const route of ROUTES) {
    const ctx = await browser.newContext({ viewport: SIZE, recordVideo: { dir: outDir, size: SIZE } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
    let shot = 0;
    const checks = [];
    await page.exposeFunction("__onLeg", async (leg) => {
      await page.screenshot({ path: join(outDir, `${route}-${++shot}.png`) });
      checks.push(await page.evaluate(() => {
        const s = window.__spike, m = s.map;
        const out = { leg: null, contextLosses: s.contextLosses };
        // a WebGL context loss nulls the style until it is restored: record, don't throw
        if (!m.style) { out.styleMissing = true; return out; }
        const order = m.getLayersOrder();
        if (s.route === "deck") {
          const lyr = s.handle.overlay._deck.layerManager.getLayers().find((l) => l.id.startsWith("buildings__fx"));
          out.placement = order.includes("deck-maplibre-layer-group-before:place-labels");
          out.elevationScale = +lyr.props.elevationScale.toFixed(3);
          out.expected = +s.spike.heightExaggeration(m.getZoom()).toFixed(3);
          out.tilesSelected = lyr.state.tileset?.selectedTiles?.length;
        } else if (s.route === "custom") {
          out.placement = order[order.indexOf("buildings__custom") + 1] === "place-labels";
          out.staticHidden = m.getLayoutProperty("buildings", "visibility") === "none";
          out.tilesDrawn = s.handle.stats.tilesDrawn;
          out.meshes = s.handle.stats.meshes;
          out.builds = s.handle.stats.builds;
          out.buildMs = Math.round(s.handle.stats.buildMs);
        } else if (s.route === "post") {
          out.placement = order[order.indexOf("buildings__post") + 1] === "place-labels";
        }
        out.staticBuildingsRendered = s.route === "deck" || s.route === "custom" ? "hidden" : m.queryRenderedFeatures(undefined, { layers: ["buildings"] }).length;
        return out;
      }));
      checks[checks.length - 1].leg = leg.leg;
    });
    await page.goto(`${origin}/packages/spike-deck-hatch/page/crosshatch.html?route=${route}`);
    await page.waitForFunction(() => window.__spike?.ready, null, { timeout: 90000 });
    await page.evaluate(async () => {
      const s = window.__spike;
      if (s.handle?.loaded) await Promise.race([s.handle.loaded(), new Promise((r) => setTimeout(r, 20000))]);
      await new Promise((r) => (s.map.loaded() ? r() : s.map.once("idle", r)));
    });
    const legs = await page.evaluate(() => window.__spike.tour((l) => window.__onLeg(l)));
    const video = await page.video().path();
    await ctx.close();
    renameSync(video, join(outDir, `${route}-tour.webm`));
    report[route] = { legs, checks, errors };
    console.log(route, JSON.stringify(legs.map((l) => `${l.leg}: ${l.fps}fps`)), errors.length ? `ERRORS ${errors.length}` : "no errors");
  }
  writeFileSync(join(outDir, "tour-report.json"), JSON.stringify(report, null, 2));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
