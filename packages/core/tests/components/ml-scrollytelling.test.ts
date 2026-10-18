/**
 * @file `<ml-scrollytelling>` (ml-aot.1) in jsdom
 *
 * @description
 * The element's loading model and DOM contract: the three ways to give it a
 * story (inline YAML, `src`, the `story`/`config` property and attribute),
 * what it renders (a sticky `<ml-map>` carrying the story's map document,
 * the chapter column, the rail, the footer), hydration of server-rendered
 * markup (Astro), the single error card (ml-aot.7, ml-4al), slots, and the
 * rail's click and keyboard handling. The camera/scroll behaviour itself is
 * proven in a real browser (e2e/scrollytelling.spec.ts).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";

vi.mock("maplibre-gl", () => {
  const Map = vi.fn(() => ({ on: vi.fn(), off: vi.fn(), remove: vi.fn() }));
  return { default: { Map }, Map };
});

const fakeMaps: any[] = [];
vi.mock("../../src/renderer/map-renderer", () => ({
  MapRenderer: vi.fn().mockImplementation(() => {
    const calls: unknown[][] = [];
    const map = {
      calls,
      flyTo: (o: unknown) => calls.push(["flyTo", o]),
      easeTo: (o: unknown) => calls.push(["easeTo", o]),
      jumpTo: (o: unknown) => calls.push(["jumpTo", o]),
      fitBounds: (...a: unknown[]) => calls.push(["fitBounds", ...a]),
      rotateTo: vi.fn(),
      getBearing: () => 0,
      getCenter: () => ({ lng: 0, lat: 0 }),
      getLayer: () => undefined,
      setFilter: vi.fn(),
      setPaintProperty: vi.fn(),
      setLayoutProperty: vi.fn(),
      once: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    };
    fakeMaps.push(map);
    const handlers = new Map<string, (payload?: unknown) => void>();
    return {
      handlers,
      getMap: () => map,
      destroy: vi.fn(),
      on: (name: string, fn: () => void) => handlers.set(name, fn),
    };
  }),
}));

import { registerMLScrollytelling, MLScrollytelling } from "../../src/components/ml-scrollytelling";
import { MapRenderer } from "../../src/renderer/map-renderer";

const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));

const STORY_YAML = `type: scrollytelling
id: tour
theme: dark
showMarkers: true
markerColor: "#ff5500"
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "https://demotiles.maplibre.org/style.json"
layers:
  - id: pts
    type: circle
    source:
      type: geojson
      data: { type: FeatureCollection, features: [] }
chapters:
  - id: one
    title: First
    description: "<p>Read <a href='https://example.com'>more</a></p>"
    center: [1, 1]
    zoom: 3
  - id: two
    title: Second
    center: [2, 2]
    zoom: 4
    alignment: left
footer: "<p>The end</p>"
`;

const storyObject = () => ({
  type: "scrollytelling",
  id: "obj",
  config: { center: [0, 0], zoom: 2, mapStyle: "https://demotiles.maplibre.org/style.json" },
  chapters: [
    { id: "a", title: "A", center: [0, 0], zoom: 3 },
    { id: "b", title: "B", center: [5, 5], zoom: 4 },
  ],
});

function inline(yaml: string): MLScrollytelling {
  const el = document.createElement("ml-scrollytelling");
  const script = document.createElement("script");
  script.type = "text/yaml";
  script.textContent = yaml;
  el.appendChild(script);
  return el;
}

beforeAll(() => {
  registerMLScrollytelling();
  // jsdom has no layout: give elements a scrollIntoView to call.
  Element.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  document.body.innerHTML = "";
  fakeMaps.length = 0;
  vi.mocked(MapRenderer).mockClear();
});

/** Console spies to restore (vi.restoreAllMocks would also wipe the module mocks). */
const spies: Array<{ mockRestore(): void }> = [];
const mute = (method: "warn" | "error") => {
  const spy = vi.spyOn(console, method).mockImplementation(() => {});
  spies.push(spy);
  return spy;
};

afterEach(() => {
  while (spies.length) spies.pop()!.mockRestore();
  vi.unstubAllGlobals();
});

describe("rendering a story", () => {
  it("inline YAML: a sticky <ml-map> with the story's map document, chapters, rail and footer", async () => {
    const el = inline(STORY_YAML);
    document.body.appendChild(el);

    expect(el.classList.contains("scrollytelling-container")).toBe(true);
    expect(el.classList.contains("theme-dark")).toBe(true);
    expect(el.classList.contains("has-markers")).toBe(true);

    const map = el.querySelector(":scope > .scrolly-map-container > ml-map")!;
    expect(map).not.toBeNull();
    const doc = JSON.parse(map.getAttribute("config")!);
    expect(doc).toMatchObject({ type: "map", id: "tour-map", layers: [{ id: "pts" }] });
    // The story map's own gestures are off, so the wheel scrolls the story.
    expect(doc.config).toMatchObject({ scrollZoom: false, dragPan: false, center: [0, 0] });

    const sections = el.querySelectorAll(".scrolly-chapters > .scrolly-chapter");
    expect([...sections].map((s) => (s as HTMLElement).dataset.chapterId)).toEqual(["one", "two"]);
    expect(sections[0]!.classList.contains("is-active")).toBe(true);
    expect(sections[0]!.classList.contains("theme-dark")).toBe(true);
    expect(sections[1]!.classList.contains("align-left")).toBe(true);
    expect(el.querySelector(".chapter-description a")!.getAttribute("href")).toBe("https://example.com");
    expect(el.querySelector(".scrolly-footer")!.innerHTML).toBe("<p>The end</p>");

    const dots = el.querySelectorAll<HTMLButtonElement>(".chapter-markers .chapter-marker");
    expect(dots).toHaveLength(2);
    expect(dots[0]!.getAttribute("aria-label")).toBe("Go to chapter 1: First");
    expect(dots[0]!.style.getPropertyValue("--ml-marker-color")).toBe("#ff5500");

    // The stylesheet is in the page once, ahead of the page's own CSS.
    expect(document.querySelectorAll("#ml-scrollytelling-styles")).toHaveLength(1);
    expect(document.head.firstElementChild!.id).toBe("ml-scrollytelling-styles");
    await settle();
    expect(el.querySelector(".scrolly-error, .ml-map-error")).toBeNull();
  });

  it("the story property, assigned before the element connects", async () => {
    const el = document.createElement("ml-scrollytelling");
    el.story = storyObject() as never;
    document.body.appendChild(el);
    expect(el.story?.id).toBe("obj");
    expect(el.querySelectorAll(".scrolly-chapter")).toHaveLength(2);
    await settle();
    expect(el.querySelector(".scrolly-error")).toBeNull();
  });

  it("the config attribute (JSON), as Astro renders it", () => {
    const el = document.createElement("ml-scrollytelling");
    el.setAttribute("config", JSON.stringify(storyObject()));
    document.body.appendChild(el);
    expect(el.querySelectorAll(".scrolly-chapter")).toHaveLength(2);
  });

  it("a JSON-equal story assigned again does not re-render", () => {
    const el = document.createElement("ml-scrollytelling");
    document.body.appendChild(el);
    el.story = storyObject() as never;
    const first = el.querySelector(".scrolly-chapter");
    el.story = storyObject() as never;
    expect(el.querySelector(".scrolly-chapter")).toBe(first);
  });

  it("geo sugar on a story layer's source is expanded (ml-ddg)", () => {
    const el = inline(`type: scrollytelling
id: sugar
config: { center: [138.7, 35.3], zoom: 5, mapStyle: "https://demotiles.maplibre.org/style.json" }
layers:
  - id: fuji
    type: circle
    source:
      type: geojson
      location: { coordinates: [138.7274, 35.3606], name: Fuji }
chapters:
  - { id: a, title: A, center: [138.7, 35.3], zoom: 6 }
`);
    document.body.appendChild(el);
    expect(el.querySelector(".scrolly-error")).toBeNull();
    const doc = JSON.parse(el.querySelector("ml-map")!.getAttribute("config")!);
    expect(doc.layers[0].source.data).toMatchObject({ type: "Feature", geometry: { type: "Point" } });
  });

  it("map-level keys reach the story's map (ml-t2x)", () => {
    const el = inline(`type: scrollytelling
id: full
config: { center: [0, 0], zoom: 2, mapStyle: "https://demotiles.maplibre.org/style.json" }
sources:
  pts:
    type: geojson
    data: { type: FeatureCollection, features: [] }
layers:
  - { id: dots, type: circle, source: pts }
markers:
  - at: [0, 0]
    popup:
      - p:
          - str: Origin
legend:
  title: Key
  items:
    - { color: "#f00", label: Dots }
chapters:
  - { id: a, title: A, center: [0, 0], zoom: 3 }
`);
    const warn = mute("warn");
    document.body.appendChild(el);
    expect(el.querySelector(".scrolly-error")).toBeNull();
    expect(warn.mock.calls.map((c) => String(c[0])).filter((m) => /Unknown key/.test(m))).toEqual([]);
    const doc = JSON.parse(el.querySelector("ml-map")!.getAttribute("config")!);
    expect(Object.keys(doc)).toEqual(expect.arrayContaining(["sources", "markers", "legend"]));
  });

  it("slot children are handed to the story's map", () => {
    const el = inline(STORY_YAML);
    const caption = document.createElement("p");
    caption.slot = "bottom-left";
    caption.textContent = "Caption";
    el.appendChild(caption);
    document.body.appendChild(el);
    expect(caption.parentElement!.tagName).toBe("ML-MAP");
  });
});

describe("one error card (ml-aot.7, ml-4al)", () => {
  it("an invalid story: the errors with line numbers and the did-you-mean hint, and no map", async () => {
    const errors: CustomEvent[] = [];
    document.addEventListener("ml-scrollytelling:error", (e) => errors.push(e as CustomEvent), { once: true });
    mute("error");
    mute("warn");
    const el = inline(`type: scrollytelling
id: broken
config: { center: [0, 0], zoom: 2, mapStyle: "https://demotiles.maplibre.org/style.json" }
chapters:
  - id: a
    title: A
    centre: [0, 0]
    zoom: 3
`);
    document.body.appendChild(el);
    await settle();

    const cards = document.querySelectorAll(".scrolly-error, .ml-map-error");
    expect(cards).toHaveLength(1);
    const card = cards[0] as HTMLElement;
    expect(card.getAttribute("role")).toBe("alert");
    expect(card.textContent).toMatch(/Chapter 1 \("a"\).*centre/);
    expect(card.textContent).not.toContain("chapters.0.centre");
    expect(card.textContent).toMatch(/line \d+/);
    expect(card.textContent).toMatch(/centre[\s\S]*center/); // the did-you-mean hint
    expect(card.textContent).not.toContain("No configuration provided");
    expect(el.querySelector("ml-map")).toBeNull();
    expect(errors).toHaveLength(1);
    await expect(el.mapReady()).rejects.toThrow(/Chapter 1 \("a"\).*centre/);
  });

  it("src: no <ml-map> exists (so none can complain) until the story has arrived", async () => {
    let release!: (text: string) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          text: () => new Promise<string>((r) => (release = r)),
        })
      )
    );
    const mapErrors: Event[] = [];
    document.addEventListener("ml-map:error", (e) => mapErrors.push(e));
    const el = document.createElement("ml-scrollytelling");
    el.setAttribute("src", "/stories/tour.yaml");
    document.body.appendChild(el);

    await settle(700); // past <ml-map>'s 500 ms empty-config fallback
    expect(el.querySelector(".chapters-loading")).not.toBeNull();
    expect(el.querySelector("ml-map")).toBeNull();

    release(STORY_YAML);
    await settle();
    expect(el.querySelector(".chapters-loading")).toBeNull();
    expect(el.querySelectorAll(".scrolly-chapter")).toHaveLength(2);
    expect(el.querySelector("ml-map")!.getAttribute("config")).toContain("tour-map");
    await settle(700);
    expect(mapErrors).toEqual([]);
    expect(document.querySelector(".ml-map-error")).toBeNull();
  });

  it("src that 404s: one 'Story file not found' card naming the URL, with <ml-map>'s advice", async () => {
    mute("error");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: false, status: 404, statusText: "Not Found", text: () => Promise.resolve("") }))
    );
    const el = document.createElement("ml-scrollytelling");
    el.setAttribute("src", "/missing.yaml");
    document.body.appendChild(el);
    await settle();
    const cards = document.querySelectorAll(".scrolly-error, .ml-map-error");
    expect(cards).toHaveLength(1);
    expect(cards[0]!.textContent).toContain("Story file not found");
    expect(cards[0]!.textContent).toContain("How to fix it");
    expect(cards[0]!.textContent).toContain("/missing.yaml");
    expect(cards[0]!.textContent).toContain("404");
  });

  it("src that 404s under base while the page is outside it: the card names base and the local-preview fix (ml-aot.36)", async () => {
    mute("error");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: false, status: 404, statusText: "Not Found", text: () => Promise.resolve("") }))
    );
    const el = document.createElement("ml-scrollytelling");
    el.setAttribute("base", "/my-repo/");
    el.setAttribute("src", "story.yaml");
    document.body.appendChild(el);
    await settle();
    const text = document.querySelector(".scrolly-error, .ml-map-error")!.textContent!;
    expect(text).toContain("Story file not found");
    expect(text).toContain('base="/my-repo/"');
    expect(text).toContain("previewing locally");
    expect(text).not.toContain("relative to this page's folder");
  });

  it("no story at all: one card that says how to give it one", async () => {
    mute("error");
    const el = document.createElement("ml-scrollytelling");
    document.body.appendChild(el);
    await settle(700);
    const cards = document.querySelectorAll(".scrolly-error, .ml-map-error");
    expect(cards).toHaveLength(1);
    expect(cards[0]!.textContent).toContain("No story provided");
    expect(cards[0]!.textContent).toContain('src="story.yaml"');
  });

  it("a story assigned later replaces the error card", async () => {
    mute("error");
    const el = document.createElement("ml-scrollytelling");
    document.body.appendChild(el);
    await settle(700);
    el.story = storyObject() as never;
    expect(el.querySelector(".scrolly-error")).toBeNull();
    expect(el.querySelectorAll(".scrolly-chapter")).toHaveLength(2);
  });
});

describe("base: a story on a site under a subpath (GitHub Pages)", () => {
  const BASE_STORY = `type: scrollytelling
id: based
config: { center: [0, 0], zoom: 2, mapStyle: "/styles/basemap.json" }
layers:
  - id: pts
    type: circle
    source: { type: geojson, url: "/data/cities.geojson" }
chapters:
  - id: a
    title: A
    image: "/images/a.png"
    video: "./clips/a.mp4"
    center: [0, 0]
    zoom: 3
  - { id: b, title: B, image: "https://example.com/b.png", center: [1, 1], zoom: 4 }
`;

  it("src, chapter media and the inner <ml-map> all use the base", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: () => "text/yaml" },
        text: () => Promise.resolve(BASE_STORY),
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const el = document.createElement("ml-scrollytelling");
    el.setAttribute("base", "/my-repo/");
    el.setAttribute("src", "/stories/story.yaml");
    document.body.appendChild(el);
    await settle();

    expect(fetchMock).toHaveBeenCalledWith("/my-repo/stories/story.yaml");
    const imgs = [...el.querySelectorAll<HTMLImageElement>(".chapter-media img")].map((i) => i.getAttribute("src"));
    expect(imgs).toEqual(["/my-repo/images/a.png", "https://example.com/b.png"]);
    expect(el.querySelector("video")!.getAttribute("src")).toBe("/my-repo/clips/a.mp4");
    // The map document's own paths are <ml-map base>'s job: it gets the base.
    expect(el.querySelector("ml-map")!.getAttribute("base")).toBe("/my-repo/");
  });

  it("the base property, and changing it re-resolves the media", () => {
    const el = inline(BASE_STORY);
    document.body.appendChild(el);
    expect(el.querySelector(".chapter-media img")!.getAttribute("src")).toBe("/images/a.png");
    expect(el.querySelector("ml-map")!.hasAttribute("base")).toBe(false);
    el.base = "/my-repo";
    expect(el.getAttribute("base")).toBe("/my-repo");
    expect(el.querySelector(".chapter-media img")!.getAttribute("src")).toBe("/my-repo/images/a.png");
    expect(el.querySelector("ml-map")!.getAttribute("base")).toBe("/my-repo");
  });

  it("a path already under the base is not doubled", () => {
    const el = inline(BASE_STORY.replace('"/images/a.png"', '"/my-repo/images/a.png"'));
    el.setAttribute("base", "/my-repo/");
    document.body.appendChild(el);
    expect(el.querySelector(".chapter-media img")!.getAttribute("src")).toBe("/my-repo/images/a.png");
  });
});

describe("hydrating server-rendered markup (Astro <Scrollytelling config>)", () => {
  it("keeps the rendered chapters and leaves the already-loading <ml-map> alone", () => {
    const story = storyObject();
    document.body.innerHTML = `<ml-scrollytelling class="scrollytelling-container" config='${JSON.stringify(story)}'>
      <div class="scrolly-map-container"><ml-map id="ssr-map" config='{"type":"map","id":"ssr","config":{"center":[0,0],"zoom":2,"mapStyle":"https://demotiles.maplibre.org/style.json"},"layers":[]}'></ml-map></div>
      <div class="scrolly-chapters"><section class="scrolly-chapter is-active" data-chapter-id="a"><div class="chapter-content">A</div></section><section class="scrolly-chapter" data-chapter-id="b"><div class="chapter-content">B</div></section></div>
    </ml-scrollytelling>`;
    const el = document.querySelector("ml-scrollytelling")!;
    // Upgraded synchronously (already defined) with the markup in place.
    const first = el.querySelector(".scrolly-chapter");
    expect(el.story?.id).toBe("obj");
    expect(el.querySelector(".scrolly-chapter")).toBe(first);
    expect(el.querySelector(".chapter-content")!.textContent).toBe("A");
    expect(el.querySelector("ml-map")!.getAttribute("config")).toContain('"id":"ssr"');
    expect(el.querySelectorAll("ml-map")).toHaveLength(1);
  });
});

describe("chapter media that settled before the element listened (review N5)", () => {
  /** A server-rendered chapter image that has already finished, as given. */
  function settledImage(decodes: boolean): HTMLImageElement {
    const img = document.createElement("img");
    img.setAttribute("src", decodes ? "icon.svg" : "Missing.JPG");
    Object.defineProperty(img, "complete", { value: true });
    // An SVG with no width/height reports 0 on some browsers although it
    // drew fine; only decode() tells a failure apart.
    Object.defineProperty(img, "naturalWidth", { value: 0 });
    img.decode = decodes ? () => Promise.resolve() : () => Promise.reject(new Error("broken"));
    return img;
  }

  it("a good image without an intrinsic size gets no 'didn't load' note; a broken one does", async () => {
    mute("warn");
    const story = storyObject();
    document.body.innerHTML = `<ml-scrollytelling config='${JSON.stringify(story)}'></ml-scrollytelling>`;
    const el = document.querySelector("ml-scrollytelling")! as any;
    await settle();
    const media = (img: HTMLImageElement) => {
      const holder = document.createElement("div");
      holder.className = "chapter-media";
      holder.appendChild(img);
      el.querySelector(".chapter-content")!.prepend(holder);
      return holder;
    };
    const good = media(settledImage(true));
    const bad = media(settledImage(false));
    el.checkMediaLoaded();
    await settle();
    expect(good.querySelector(".chapter-media-missing")).toBeNull();
    expect(bad.querySelector(".chapter-media-missing")?.textContent).toContain("Missing.JPG");
  });
});

describe("map hand-off", () => {
  it("mapReady() resolves with the story's map once it loads, and the active chapter lands", async () => {
    const el = inline(STORY_YAML);
    document.body.appendChild(el);
    const ready = el.mapReady();
    await settle();
    const renderer = vi.mocked(MapRenderer).mock.results[0]!.value as any;
    renderer.handlers.get("load")();
    const map = await ready;
    expect(map).toBe(fakeMaps[0]);
    expect(el.getMap()).toBe(fakeMaps[0]);
  });
});

describe("the rail", () => {
  it("a click goes to the chapter: it becomes active and is scrolled into view", async () => {
    const el = inline(STORY_YAML);
    document.body.appendChild(el);
    const events: string[] = [];
    el.addEventListener("ml-scrollytelling:chapter", (e) => events.push(e.detail.chapterId));
    const dot = el.querySelector<HTMLButtonElement>('.chapter-marker[data-chapter-id="two"]')!;
    dot.click();
    expect(el.dataset.activeChapter).toBe("two");
    expect(el.activeChapterId).toBe("two");
    expect(dot.classList.contains("active")).toBe(true);
    expect(dot.getAttribute("aria-current")).toBe("step");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("arrow keys move along the rail and go to the chapter", () => {
    const el = inline(STORY_YAML);
    document.body.appendChild(el);
    const [first, second] = el.querySelectorAll<HTMLButtonElement>(".chapter-marker");
    first!.focus();
    first!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(second);
    expect(el.dataset.activeChapter).toBe("two");
    second!.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(document.activeElement).toBe(first);
    expect(el.dataset.activeChapter).toBe("one");
  });
});
