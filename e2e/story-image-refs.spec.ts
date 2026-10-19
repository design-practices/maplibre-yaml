/**
 * A story chapter action that sets an image name the document owns (A5,
 * ml-aot.37 follow-up) — browser verification and demo
 * (examples/verification/story-image-action.html).
 *
 * The missing-image warning blames the document only for names it uses. A
 * name a chapter's setLayoutProperty action sets is the document's too: its
 * miss must be reported once, not dismissed as a basemap sprite gap.
 */
import { test, expect } from "@playwright/test";

test("a chapter action's missing icon is reported against the document, once", async ({ page }) => {
  const errors: string[] = [];
  const warnings: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "warning") warnings.push(m.text());
  });
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url) || /^(data|blob):/.test(url)) return route.continue();
    errors.push(`external request: ${url}`);
    return route.abort();
  });
  await page.goto("/examples/verification/story-image-action.html", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => (document.getElementById("story") as any).mapReady());
  await page.evaluate(() => (document.getElementById("story") as any).goToChapter("two"));
  await expect
    .poll(() => page.evaluate(() => (document.getElementById("story") as HTMLElement).dataset.activeChapter))
    .toBe("two");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (document.getElementById("story") as any).getMap().getLayoutProperty("pins", "icon-image")
      )
    )
    .toBe("chapter-only-icon");
  await page.waitForTimeout(1500);
  const ours = warnings.filter((w) => w.includes('[maplibre-yaml] layer references image "chapter-only-icon"'));
  expect(ours, warnings.join("\n")).toHaveLength(1);
  expect(errors).toEqual([]);
});
