/**
 * What a Protomaps basemap needs besides its tiles (0.9, ml-cnv.16): a notice
 * when its fonts or icons don't load, and MapLibre's right-to-left text
 * plugin on a maplibre-gl that still needs it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const gl = vi.hoisted(() => ({
  version: "5.24.0",
  status: "unavailable",
  setRTLTextPlugin: vi.fn(async (_url: string, _lazy: boolean) => undefined),
}));
vi.mock("../../src/renderer/maplibre-interop", () => ({
  maplibregl: {
    setRTLTextPlugin: (url: string, lazy: boolean) => gl.setRTLTextPlugin(url, lazy),
    getRTLTextPluginStatus: () => gl.status,
  },
  runtimeVersion: () => gl.version,
}));

import {
  basemapAssetMessage,
  basemapAssetProblem,
  ensureRightToLeftLabels,
  probeBasemapAssets,
  rightToLeftPluginUrl,
} from "../../src/renderer/basemap-assets";
import { PROTOMAPS_GLYPHS, protomapsSprite } from "../../src/formats/protomaps-style";

beforeEach(() => {
  gl.version = "5.24.0";
  gl.status = "unavailable";
  gl.setRTLTextPlugin.mockReset().mockResolvedValue(undefined);
});

describe("right-to-left labels", () => {
  it("maplibre-gl 6.9 and later draw them itself; older ones get the plugin MapLibre documents", () => {
    expect(rightToLeftPluginUrl("6.12.0")).toBeUndefined();
    expect(rightToLeftPluginUrl("6.9.0")).toBeUndefined();
    expect(rightToLeftPluginUrl("6.8.1")).toBe("https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.3.0/dist/mapbox-gl-rtl-text.js");
    expect(rightToLeftPluginUrl("5.24.0")).toBe("https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.3.0/dist/mapbox-gl-rtl-text.js");
    expect(rightToLeftPluginUrl("4.7.1")).toBe("https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.2.3/mapbox-gl-rtl-text.js");
    expect(rightToLeftPluginUrl(undefined)).toBeUndefined();
  });

  it("sets the plugin lazily for ar, he, fa and ur on an older maplibre-gl — and only then", () => {
    for (const lang of ["ar", "he", "fa", "ur"]) {
      gl.setRTLTextPlugin.mockClear();
      expect(ensureRightToLeftLabels(lang, vi.fn())).toMatch(/mapbox-gl-rtl-text@0\.3\.0/);
      // Lazy: downloaded only when a right-to-left label is about to be drawn.
      expect(gl.setRTLTextPlugin).toHaveBeenCalledWith(expect.stringContaining("mapbox-gl-rtl-text"), true);
    }
    gl.setRTLTextPlugin.mockClear();
    expect(ensureRightToLeftLabels("en", vi.fn())).toBeUndefined();
    gl.version = "6.12.0";
    expect(ensureRightToLeftLabels("ar", vi.fn())).toBeUndefined();
    expect(gl.setRTLTextPlugin).not.toHaveBeenCalled();
  });

  it("leaves a plugin the page (or an earlier map) set alone", () => {
    gl.status = "deferred";
    expect(ensureRightToLeftLabels("ar", vi.fn())).toBeUndefined();
    expect(gl.setRTLTextPlugin).not.toHaveBeenCalled();
  });

  it("reports a plugin that couldn't be set", async () => {
    const failure = new Error("network");
    gl.setRTLTextPlugin.mockRejectedValueOnce(failure);
    const onFailure = vi.fn();
    ensureRightToLeftLabels("he", onFailure);
    await vi.waitFor(() => expect(onFailure).toHaveBeenCalledWith(expect.stringContaining("unpkg.com"), failure));
  });
});

describe("the fonts-and-icons notice", () => {
  const hosted = { glyphs: PROTOMAPS_GLYPHS, sprite: protomapsSprite("light"), hostedGlyphs: true, hostedSprite: true };

  it("Protomaps' host unreachable: names the host and the glyphs:/sprite: fix", () => {
    const text = basemapAssetMessage(["glyphs", "sprite"], hosted);
    expect(text).toContain(
      "The basemap's labels and icons couldn't load: its fonts and icons come from protomaps.github.io, which this page couldn't reach."
    );
    expect(text).toContain("set `glyphs:` and `sprite:` in the basemap");
  });

  it("fonts alone (ml-aot.125): says labels, not icons", () => {
    const text = basemapAssetMessage("glyphs", hosted);
    expect(text).toContain("The basemap's labels couldn't load: its fonts come from protomaps.github.io");
    expect(text).toContain("Labels may show in a fallback font or not at all.");
    expect(text).not.toContain("road shields");
  });

  it("maplibre-gl 4: says the labels were left out so the basemap could draw", () => {
    expect(basemapAssetMessage("glyphs", hosted, { labelsHidden: true })).toContain(
      "The basemap's labels are left out so the rest of it can draw (maplibre-gl 4 draws no basemap without its fonts)."
    );
  });

  it("a self-hosted glyphs: path that 404s names the path", () => {
    const own = {
      glyphs: "https://me.github.io/site/fonts/{fontstack}/{range}.pbf",
      sprite: "https://me.github.io/site/sprites/light",
      hostedGlyphs: false,
      hostedSprite: false,
    };
    expect(basemapAssetMessage("glyphs", own)).toContain(
      "The basemap's fonts (`glyphs: https://me.github.io/site/fonts/{fontstack}/{range}.pbf`) couldn't load."
    );
    expect(
      basemapAssetProblem("AJAXError: Not Found (404): https://me.github.io/site/sprites/light.json", own)
    ).toContain("icons (`sprite: https://me.github.io/site/sprites/light`)");
    expect(basemapAssetProblem("Failed to fetch (0): https://tiles.example.org/x.json", own)).toBeUndefined();
  });

  it("probeBasemapAssets asks for a glyph range and the sprite, and reports each that fails", async () => {
    const fetched: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        fetched.push(url);
        if (url.includes("/fonts/")) throw new TypeError("Failed to fetch");
        return new Response("{}", { status: 200 });
      })
    );
    expect(await probeBasemapAssets(hosted)).toEqual(["glyphs"]);
    expect(fetched).toContain("https://protomaps.github.io/basemaps-assets/fonts/Noto%20Sans%20Regular/0-255.pbf");
    expect(fetched).toContain("https://protomaps.github.io/basemaps-assets/sprites/v4/light.json");
    vi.unstubAllGlobals();
  });
});
