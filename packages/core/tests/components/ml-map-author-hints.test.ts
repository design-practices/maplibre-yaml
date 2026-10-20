/**
 * The notice splits failures from author hints (ml-aot.57): a failure
 * (something didn't load) always shows; a hint (did-you-mean, a misplaced
 * key, swapped coordinates, the reserved `=`) shows only while the author is
 * developing — a page served from this computer, a bundler dev build — or
 * with `debug`. `quiet` still hides everything. One function decides
 * (`showAuthorHints`), for `<ml-map>` and `<ml-scrollytelling>` alike.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("maplibre-gl", () => ({ default: {}, Map: vi.fn() }));

/** Whether the page counts as served from this computer (jsdom is localhost). */
let local = true;
vi.mock("../../src/components/map-notice", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/components/map-notice")>();
  return { ...actual, isLocalPage: () => local };
});

interface FakeRenderer {
  options: any;
  handlers: Map<string, Array<(payload: any) => void>>;
  emit(name: string, payload?: any): void;
}
const renderers: FakeRenderer[] = [];

vi.mock("../../src/renderer/map-renderer", () => ({
  MapRenderer: vi.fn().mockImplementation((_container, _config, _layers, options) => {
    const handlers = new Map<string, Array<(payload: any) => void>>();
    const fake: FakeRenderer & Record<string, unknown> = {
      options,
      handlers,
      emit(name: string, payload?: any) {
        for (const fn of handlers.get(name) ?? []) fn(payload);
      },
      getMap: vi.fn(() => ({ on: vi.fn(), off: vi.fn() })),
      destroy: vi.fn(),
      isMapLoaded: vi.fn(() => false),
      on: vi.fn((name: string, fn: (payload: any) => void) => {
        handlers.set(name, [...(handlers.get(name) ?? []), fn]);
      }),
    };
    renderers.push(fake);
    return fake;
  }),
}));

import { MLMap } from "../../src/components/ml-map";
import {
  authorHintsDecision,
  showAuthorHints,
  _setBundlerDevBuildForTesting,
} from "../../src/components/author-hints";
import { MapNotice, NOTICE_HINTS_TITLE, NOTICE_TITLE } from "../../src/components/map-notice";

/** A map whose document has one on-page hint: `markers:` nested under `config:`. */
const MISPLACED = {
  type: "map",
  id: "m",
  config: {
    center: [0, 0],
    zoom: 2,
    mapStyle: "https://example.com/styles.json",
    markers: [{ at: [1, 1] }],
  },
  layers: [],
};
const HINT = '"markers" belongs at the top level';

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
const latest = () => renderers[renderers.length - 1]!;
const noticeText = (el: Element) =>
  el.querySelector(".ml-map-notice")?.textContent?.replace(/\s+/g, " ").trim();

async function mount(attrs: Record<string, string> = {}): Promise<MLMap> {
  const el = document.createElement("ml-map") as MLMap;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.setAttribute("config", JSON.stringify(MISPLACED));
  document.body.appendChild(el);
  await tick();
  return el;
}

const dataFailure = (el: MLMap) =>
  latest().emit("layer:data-error", {
    layerId: "l",
    error: Object.assign(new Error("HTTP 404: Not Found for d.geojson"), { url: "d.geojson" }),
  });

describe("showAuthorHints: when the page shows author hints (ml-aot.57)", () => {
  const fake = (attrs: string[], href: string | null, parentDebug = false) =>
    ({
      hasAttribute: (name: string) => attrs.includes(name),
      closest: (selector: string) => (parentDebug && selector.includes("[debug]") ? {} : null),
      ownerDocument: href ? { location: new URL(href) } : {},
    }) as unknown as Element;

  beforeEach(() => _setBundlerDevBuildForTesting(false));
  afterEach(() => _setBundlerDevBuildForTesting(undefined));

  it("hides them on a published site", () => {
    local = false;
    expect(authorHintsDecision(fake([], "https://someone.github.io/site/"))).toEqual({
      show: false,
      reason: "published",
    });
  });

  it("shows them on a page served from this computer", () => {
    local = true;
    expect(authorHintsDecision(fake([], "http://localhost:4321/"))).toEqual({ show: true, reason: "local" });
  });

  it("shows them in a bundler dev build, wherever it is served", () => {
    local = false;
    _setBundlerDevBuildForTesting(true);
    expect(authorHintsDecision(fake([], "https://abc-4321.app.github.dev/"))).toEqual({
      show: true,
      reason: "dev-build",
    });
  });

  it("debug shows them anywhere, on the element or on its story", () => {
    local = false;
    expect(authorHintsDecision(fake(["debug"], "https://example.com/")).reason).toBe("debug");
    expect(authorHintsDecision(fake([], "https://example.com/", true)).reason).toBe("debug");
  });

  it("quiet wins over everything", () => {
    local = true;
    expect(showAuthorHints(fake(["quiet", "debug"], "http://localhost/"))).toBe(false);
  });

  it("reads the Astro dev flag set by @maplibre-yaml/astro's client script", () => {
    local = false;
    const g = globalThis as Record<string, unknown>;
    try {
      expect(showAuthorHints(fake([], "https://example.com/"))).toBe(false);
      g["__MAPLIBRE_YAML_DEV__"] = true;
      expect(authorHintsDecision(fake([], "https://example.com/")).reason).toBe("dev-build");
    } finally {
      delete g["__MAPLIBRE_YAML_DEV__"];
    }
  });
});

describe("the notice words itself by what it holds", () => {
  it("a notice of hints only leads with notes for the author, then flips once something fails", () => {
    const host = document.createElement("div");
    const notice = new MapNotice(host, { openDetails: true });
    notice.add("A hint.", "hint");
    expect(host.querySelector(".ml-map-notice strong")!.textContent).toBe(NOTICE_HINTS_TITLE);
    notice.add("Layer `a` didn't draw.");
    expect(host.querySelector(".ml-map-notice strong")!.textContent).toBe(NOTICE_TITLE);
    expect(notice.failureCount).toBe(1);
    expect(host.querySelectorAll(".ml-map-notice li")).toHaveLength(2);
  });
});

describe("<ml-map>: failures always, hints while developing (ml-aot.57)", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    document.body.innerHTML = "";
    renderers.length = 0;
    local = true;
    _setBundlerDevBuildForTesting(false);
    if (!customElements.get("ml-map")) customElements.define("ml-map", MLMap);
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    error = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    _setBundlerDevBuildForTesting(undefined);
    warn.mockRestore();
    error.mockRestore();
  });

  it("developing: the hint shows, worded as notes; a failure joins it under the failure title, details open", async () => {
    const el = await mount();
    expect(noticeText(el)).toContain(HINT);
    expect(el.querySelector(".ml-map-notice strong")!.textContent).toBe(NOTICE_HINTS_TITLE);
    dataFailure(el);
    expect(el.querySelector(".ml-map-notice strong")!.textContent).toBe(NOTICE_TITLE);
    expect(el.querySelector<HTMLDetailsElement>(".ml-map-notice details")!.open).toBe(true);
    expect(noticeText(el)).toContain(HINT);
  });

  it("published: no notice for a hint; a failure shows alone, details collapsed; the console keeps the hint", async () => {
    local = false;
    const el = await mount();
    expect(el.querySelector(".ml-map-notice")).toBeNull();
    dataFailure(el);
    expect(noticeText(el)).toContain("Data file d.geojson didn't load");
    expect(noticeText(el)).not.toContain(HINT);
    expect(el.querySelector<HTMLDetailsElement>(".ml-map-notice details")!.open).toBe(false);
    expect(warn.mock.calls.some((c) => String(c[0]).includes(HINT))).toBe(true);
  });

  it("published: renderer hints (fitTo typo, swapped center) stay off the page too", async () => {
    local = false;
    const el = await mount();
    latest().options.onError(new Error("fit"), false, { kind: "fit", sourceId: "place", suggestion: "places" });
    latest().options.onError(new Error("center"), false, {
      kind: "center",
      center: [40.7, -74],
      swapped: [-74, 40.7],
    });
    expect(el.querySelector(".ml-map-notice")).toBeNull();
  });

  it("debug brings the hints back on a published site — set before load or later", async () => {
    local = false;
    const early = await mount({ debug: "" });
    expect(early.debug).toBe(true);
    expect(noticeText(early)).toContain(HINT);

    const late = await mount();
    dataFailure(late);
    expect(noticeText(late)).not.toContain(HINT);
    late.debug = true;
    expect(noticeText(late)).toContain(HINT);
    expect(noticeText(late)).toContain("Data file d.geojson didn't load");
    late.debug = false;
    expect(noticeText(late)).not.toContain(HINT);
    expect(noticeText(late)).toContain("Data file d.geojson didn't load");
  });

  it("quiet hides failures and hints even with debug; removing quiet brings them back", async () => {
    const el = await mount({ quiet: "", debug: "" });
    dataFailure(el);
    expect(el.querySelector(".ml-map-notice")).toBeNull();
    el.quiet = false;
    expect(noticeText(el)).toContain(HINT);
    expect(noticeText(el)).toContain("Data file d.geojson didn't load");
  });

  it("story hints reported on the map follow the same rule", async () => {
    local = false;
    const el = await mount();
    el._reportNotice("Chapter `a`: its setFilter action names layer `wlak` … Did you mean `walk`?");
    expect(el.querySelector(".ml-map-notice")).toBeNull();
    el._reportNotice("Something failed.", "failure");
    expect(noticeText(el)).toContain("Something failed.");
  });
});
