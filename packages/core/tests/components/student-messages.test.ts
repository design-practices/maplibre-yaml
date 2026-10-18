/**
 * The words behind <ml-map>'s error card and notice (ml-aot.13/14/15, ml-zft).
 * Pure builders, so every branch is checked here; the browser suite checks
 * the same text appears on a real page.
 */
import { describe, it, expect } from "vitest";
import {
  describeDataProblem,
  describeLayerProblem,
  looksLikeHtml,
  srcFetchFailedCard,
  srcHtmlCard,
  srcHttpErrorCard,
  styleFailureCard,
  filePageWorkerCard,
} from "../../src/components/student-messages";

const ajax = (status: number, statusText: string, url: string) =>
  Object.assign(new Error(`AJAXError: ${statusText} (${status}): ${url}`), { status, statusText, url });

describe("src fetch failures (ml-aot.13)", () => {
  it("file:// says to start a local server, with a command", () => {
    const card = srcFetchFailedCard("map.yaml", "file:///home/s/map.yaml", new TypeError("Failed to fetch"), true);
    expect(card.title).toBe("Open this page through a local web server");
    expect(card.errors[0]!.message).toBe(
      'This page was opened from a file (file://), and browsers block it from loading "map.yaml" that way.'
    );
    expect(card.hint).toContain('"npx serve ."');
    expect(card.hint).toContain("Live Server");
    expect(JSON.stringify(card)).not.toContain("Failed to fetch");
  });

  it("a network failure over http names the resolved URL", () => {
    const card = srcFetchFailedCard("map.yaml", "https://x.test/map.yaml", new TypeError("Failed to fetch"), false);
    expect(card.errors[0]!.message).toBe('Couldn\'t load src="map.yaml" (https://x.test/map.yaml): Failed to fetch.');
  });

  it("an HTTP error shows the status and where the browser looked", () => {
    const card = srcHttpErrorCard("/my-map.yaml", "https://u.github.io/my-map.yaml", 404, "");
    expect(card.title).toBe("Map file not found");
    expect(card.errors.map((e) => e.message)).toEqual([
      'Couldn\'t load src="/my-map.yaml": 404 Not Found.',
      "The browser looked for it at https://u.github.io/my-map.yaml",
    ]);
    expect(card.hint).toContain('one starting with "/" starts at the site root');
  });

  it("an HTML response is a wrong path, not a YAML syntax error", () => {
    expect(looksLikeHtml("<!doctype html><html>", "text/html")).toBe(true);
    expect(looksLikeHtml("\n  <!DOCTYPE html>", null)).toBe(true);
    expect(looksLikeHtml("<div>", "text/html; charset=utf-8")).toBe(true);
    expect(looksLikeHtml("type: map\n", "text/html")).toBe(false);
    expect(looksLikeHtml("<div>", "text/yaml")).toBe(false);
    const card = srcHtmlCard("maps/x.yaml", "http://localhost:5173/maps/x.yaml");
    expect(card.errors[0]!.message).toBe(
      'src="maps/x.yaml" points at an HTML page, not a YAML file — the path is probably wrong.'
    );
    expect(card.errors[1]!.message).toBe("The browser looked for it at http://localhost:5173/maps/x.yaml");
  });

  it("a worker that cannot start on a file:// page gets the server advice, not bundler advice", () => {
    const card = filePageWorkerCard();
    expect(card.title).toBe("Open this page through a local web server");
    expect(JSON.stringify(card)).not.toContain("setWorkerUrl");
  });
});

describe("basemap style failures (ml-aot.14)", () => {
  const url = "https://demotiles.maplibre.org/styles.json";
  it("404 (HTTP/2 sends no reason phrase)", () => {
    const card = styleFailureCard([ajax(404, "", url)], { url, isV2: false, filePage: false });
    expect(card.title).toBe("The basemap style didn't load");
    expect(card.errors).toEqual([
      {
        path: "config.mapStyle",
        message: `Could not load the basemap style "${url}": 404 Not Found. Nothing exists at that address.`,
      },
    ]);
    expect(card.hint).toContain("Check config.mapStyle");
  });

  it("403 explains keyed styles", () => {
    const card = styleFailureCard([ajax(403, "Forbidden", url)], { url, isV2: false, filePage: false });
    expect(card.errors[0]!.message).toContain("403 Forbidden");
    expect(card.errors[0]!.message).toContain("need your API key in the URL");
  });

  it("a network/CORS failure", () => {
    const card = styleFailureCard([ajax(0, "Failed to fetch", url)], { url, isV2: false, filePage: false });
    expect(card.errors[0]!.message).toContain("the request failed");
    expect(card.errors[0]!.message).toContain("CORS");
  });

  it("not JSON (a web page)", () => {
    const card = styleFailureCard([new SyntaxError("Unexpected token '<', \"<!doctype \"... is not valid JSON")], {
      url,
      isV2: false,
      filePage: false,
    });
    expect(card.errors[0]!.message).toContain("isn't JSON");
  });

  it("valid JSON that is not a style, counting the other problems; v2 names style.basemap", () => {
    const card = styleFailureCard(
      [new Error("version: missing required property"), new Error("sources: missing required property")],
      { url, isV2: true, filePage: false }
    );
    expect(card.errors[0]).toEqual({
      path: "style.basemap",
      message: `The basemap style "${url}" isn't a valid MapLibre style: version: missing required property (and 1 more problem).`,
    });
  });
});

describe("runtime layer and data problems (ml-aot.15)", () => {
  it("drops MapLibre's layers.<id>. prefix and adds a colour did-you-mean", () => {
    expect(describeLayerProblem("cities", 'layers.cities.paint.circle-color: color expected, "bleu" found')).toBe(
      'Layer `cities` didn\'t draw: paint.circle-color: color expected, "bleu" found. Did you mean "blue"?'
    );
    expect(describeLayerProblem("p", "layers.p.paint.circle-color[2]: Could not parse color from value 'bleu'")).toContain(
      'Did you mean "blue"?'
    );
  });

  it("an unknown paint property gets the spec key", () => {
    expect(describeLayerProblem("cities", 'layers.cities.paint.circleColor: unknown property "circleColor"')).toBe(
      'Layer `cities` didn\'t draw: paint.circleColor: unknown property "circleColor". Did you mean "circle-color"?'
    );
  });

  it("a data 404 names the file, the status and the resolved URL", () => {
    const error = Object.assign(new Error("HTTP 404:  for data/x.geojson"), { url: "data/x.geojson" });
    expect(
      describeDataProblem("quakes", error, { pageUrl: "http://localhost:4380/class/index.html", filePage: false })
    ).toBe(
      "Data file `data/x.geojson` didn't load (404 Not Found), so layer `quakes` has no data. The browser looked for http://localhost:4380/class/data/x.geojson."
    );
  });

  it("a path written relative to the YAML file gets the page-relative fix (ml-zft)", () => {
    const error = Object.assign(new Error("HTTP 404: Not Found for cities.geojson"), { url: "cities.geojson" });
    const text = describeDataProblem("cities", error, {
      pageUrl: "http://localhost:4380/class/index.html",
      documentUrl: "http://localhost:4380/class/maps/city.yaml",
      filePage: false,
    });
    expect(text).toContain("The browser looked for http://localhost:4380/class/cities.geojson");
    expect(text).toContain(
      "relative paths start from the page, not from the YAML file. If the file is next to your YAML, write `maps/cities.geojson`."
    );
  });

  it("no relative-path hint when the YAML sits next to the page, or the path is absolute", () => {
    const error = Object.assign(new Error("HTTP 404: Not Found for x.geojson"), { url: "x.geojson" });
    const ctx = { pageUrl: "http://h/a/index.html", documentUrl: "http://h/a/map.yaml", filePage: false };
    expect(describeDataProblem("l", error, ctx)).not.toContain("relative paths");
    const abs = Object.assign(new Error("HTTP 404: Not Found for /x.geojson"), { url: "/x.geojson" });
    expect(describeDataProblem("l", abs, { ...ctx, documentUrl: "http://h/a/maps/m.yaml" })).not.toContain(
      "relative paths"
    );
  });

  it("an HTML response and a file:// page are explained", () => {
    const html = Object.assign(new Error("Invalid JSON response from d.geojson"), { url: "d.geojson" });
    expect(describeDataProblem("l", html, { pageUrl: "http://h/", filePage: false })).toContain(
      "it isn't JSON — a wrong path often returns a web page instead"
    );
    const file = Object.assign(new TypeError("Failed to fetch"), { url: "d.geojson" });
    const text = describeDataProblem("l", file, { pageUrl: "file:///s/index.html", filePage: true });
    expect(text).toContain("pages opened from a file (file://) can't load data files");
    expect(text).toContain("npx serve .");
  });
});
