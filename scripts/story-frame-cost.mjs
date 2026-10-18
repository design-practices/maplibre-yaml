#!/usr/bin/env node
/**
 * Per-scroll-frame cost of <ml-scrollytelling>'s layout work (review N1):
 * which chapter is being read, and where the map chrome goes. Generates a
 * story with N chapters (10, 60, 200), scrolls through it, and times the
 * element's own per-frame work at each stop.
 *
 * Usage: node scripts/story-frame-cost.mjs   (needs `pnpm verify:serve` on
 * VERIFY_PORT, default 4174, and a core build)
 */
import { chromium } from "@playwright/test";

const PORT = Number(process.env.VERIFY_PORT ?? 4174);
const BASE = `http://localhost:${PORT}`;

function story(n) {
  const chapters = Array.from({ length: n }, (_, i) => {
    const lng = -170 + ((i * 7) % 340);
    const lat = -60 + ((i * 11) % 120);
    return [
      `  - id: c${i}`,
      `    title: Chapter ${i + 1}`,
      `    description: "<p>Chapter ${i + 1} of ${n}.</p>"`,
      `    center: [${lng}, ${lat}]`,
      `    zoom: 3`,
      `    alignment: ${["left", "right", "center"][i % 3]}`,
    ].join("\n");
  });
  return [
    "type: scrollytelling",
    `id: perf-${n}`,
    "showMarkers: true",
    "config:",
    '  mapStyle: "/examples/verification/configs/local-style.json"',
    "  center: [0, 20]",
    "  zoom: 2",
    "controls:",
    "  scale: true",
    "legend:",
    "  position: bottom-left",
    "  title: Places",
    "  items:",
    '    - { label: Place, color: "#d62828" }',
    "layers: []",
    "chapters:",
    ...chapters,
  ].join("\n");
}

const browser = await chromium.launch({
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const results = {};
for (const n of [10, 60, 200]) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.route(`**/story-layout/perf${n}.yaml`, (route) =>
    route.fulfill({ body: story(n), contentType: "text/yaml" })
  );
  await page.goto(`${BASE}/examples/verification/story-layout/index.html?doc=perf${n}`);
  await page.waitForFunction(() => document.querySelectorAll(".scrolly-chapter").length > 0);
  await page.evaluate(() => document.querySelector("ml-scrollytelling").mapReady());
  const samples = [];
  const stops = 40;
  const height = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  for (let s = 1; s <= stops; s++) {
    await page.evaluate((y) => scrollTo(0, y), Math.round((height * s) / (stops + 1)));
    await page.waitForTimeout(30);
    const t = await page.evaluate(() => {
      const el = document.querySelector("ml-scrollytelling");
      const times = [];
      for (let i = 0; i < 25; i++) {
        const t0 = performance.now();
        // The element's per-frame work: what its scroll handler runs.
        if (typeof el.frameWork === "function") el.frameWork();
        else {
          el.chapterInView();
          el.placeChrome();
        }
        times.push(performance.now() - t0);
      }
      return times;
    });
    samples.push(...t);
  }
  samples.sort((a, b) => a - b);
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  results[n] = {
    meanMs: +mean.toFixed(3),
    p95Ms: +samples[Math.floor(samples.length * 0.95)].toFixed(3),
  };
  await page.close();
}
await browser.close();
console.log(JSON.stringify(results));
