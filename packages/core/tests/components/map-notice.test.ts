/**
 * The on-page notice reads well to a site's visitors (0.8.1 review F1):
 * a plain lead line ("Part of this map couldn't load"), with the author's
 * fix (paths, folders, did-you-mean) in a "Details for the site's author"
 * disclosure -- open while the page is served from this computer
 * (localhost, file://), closed on a published site. Every detail stays in
 * the page; the notice stays dismissible and role="status".
 */
import { describe, it, expect } from "vitest";
import { MapNotice, isLocalPage } from "../../src/components/map-notice";

const host = () => {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
};

describe("map notice for visitors and authors", () => {
  it("leads with a plain line and keeps the author's fix in a details disclosure", () => {
    const h = host();
    const notice = new MapNotice(h, { openDetails: false });
    notice.add("Data file `/data/x.geojson` didn't load (404 Not Found), so layer `x` has no data.");
    const root = h.querySelector(".ml-map-notice")!;
    expect(root.getAttribute("role")).toBe("status");
    expect(root.querySelector("strong")!.textContent).toBe("Part of this map couldn't load");
    const details = root.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")!.textContent).toBe("Details for the site's author");
    expect(details.textContent).toContain("Data file /data/x.geojson didn't load");
    expect(root.querySelector("button[aria-label='Dismiss this notice']")).not.toBeNull();
  });

  it("opens the details while the page is served from this computer", () => {
    const h = host();
    new MapNotice(h, { openDetails: true }).add("Layer `a` didn't draw.");
    expect(h.querySelector<HTMLDetailsElement>(".ml-map-notice details")!.open).toBe(true);
  });

  it("knows a local page from a published one", () => {
    const at = (href: string) => ({ location: new URL(href) }) as unknown as Document;
    expect(isLocalPage(at("http://localhost:4321/"))).toBe(true);
    expect(isLocalPage(at("http://127.0.0.1:3000/my-repo/"))).toBe(true);
    expect(isLocalPage(at("http://[::1]:8080/"))).toBe(true);
    expect(isLocalPage(at("file:///home/s/site/index.html"))).toBe(true);
    expect(isLocalPage(at("https://someone.github.io/my-repo/"))).toBe(false);
    expect(isLocalPage(at("https://example.com/"))).toBe(false);
  });
});
