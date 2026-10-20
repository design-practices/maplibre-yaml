/**
 * Cloud-native failures in plain words (0.9, ml-cnv): raw library strings
 * are classified, and each class has one catalogued sentence.
 */
import { describe, it, expect } from "vitest";
import { classifyPmtilesError, FormatError, isFormatError } from "../../src/formats/errors";
import {
  describeFormatFailure,
  describeDataProblem,
  describeSourceProblem,
} from "../../src/components/student-messages";

const URL = "/data/x.pmtiles";

describe("classifyPmtilesError", () => {
  it("maps the library's range failure to no-range", () => {
    const e = classifyPmtilesError(
      new Error(
        "Server returned no content-length header or content-length exceeding request. Check that your storage backend supports HTTP Byte Serving."
      ),
      URL
    );
    expect(isFormatError(e) && e.failure.code).toBe("no-range");
  });

  it("maps a wrong file, an HTTP status and a refused fetch", () => {
    const magic = classifyPmtilesError(new Error("Wrong magic number for PMTiles archive"), URL);
    expect(isFormatError(magic) && magic.failure.code).toBe("not-format");
    const http = classifyPmtilesError(new Error("Bad response code: 404"), URL);
    expect(isFormatError(http) && http.failure).toMatchObject({ code: "http", status: 404 });
    const cors = classifyPmtilesError(new TypeError("Failed to fetch"), URL);
    expect(isFormatError(cors) && cors.failure.code).toBe("cors");
  });

  it("passes aborts and unknown errors through unchanged", () => {
    const abort = Object.assign(new Error("The user aborted a request."), { name: "AbortError" });
    expect(classifyPmtilesError(abort, URL)).toBe(abort);
    const other = new Error("Tile zoom level exceeds max safe number limit (26)");
    expect(classifyPmtilesError(other, URL)).toBe(other);
  });
});

describe("describeFormatFailure — the on-page sentences", () => {
  it("no-range names the hosts that work and the one that doesn't", () => {
    expect(describeFormatFailure({ code: "no-range", format: "pmtiles", url: URL })).toBe(
      "`/data/x.pmtiles` was served without range-request support (the server sent the whole file " +
        "instead of the part asked for). PMTiles and FlatGeobuf files need a web server that supports " +
        "HTTP range requests: GitHub Pages, Netlify, Cloudflare, S3 and R2 do; `python -m http.server` " +
        "does not — preview locally with `npx serve` instead."
    );
  });

  it("CORS says what the other site must send", () => {
    expect(describeFormatFailure({ code: "cors", format: "flatgeobuf", url: "https://x.org/a.fgb" })).toBe(
      "The browser couldn't read `https://x.org/a.fgb`: the server didn't allow this page to load it " +
        "(CORS), or it couldn't be reached. A FlatGeobuf file on another site needs that site to send " +
        "`Access-Control-Allow-Origin` and to allow the `Range` header."
    );
  });

  it("a wrong file, a status, a CRS, a size, a missing index", () => {
    expect(describeFormatFailure({ code: "not-format", format: "pmtiles", url: URL })).toBe(
      "`/data/x.pmtiles` isn't a PMTiles file. A wrong path often returns a web page instead — check the " +
        "file name and folder."
    );
    expect(describeFormatFailure({ code: "http", format: "pmtiles", url: URL, status: 404 })).toBe(
      "`/data/x.pmtiles` didn't load (404 Not Found)."
    );
    expect(describeFormatFailure({ code: "crs", format: "flatgeobuf", url: "d/p.fgb", crs: "EPSG:2263" })).toBe(
      "`d/p.fgb` is in EPSG:2263; MapLibre needs longitude/latitude (EPSG:4326). Reproject it: " +
        "`ogr2ogr -t_srs EPSG:4326 out.fgb p.fgb`."
    );
    expect(
      describeFormatFailure({ code: "too-large", format: "flatgeobuf", url: "p.fgb", size: 180 * 1024 * 1024 })
    ).toBe(
      "`p.fgb` is 180 MB, too large to load whole in a browser. Add `load: viewport` to the source (the " +
        "file needs a spatial index), or convert it to PMTiles."
    );
    expect(describeFormatFailure({ code: "no-index", format: "flatgeobuf", url: "p.fgb" })).toContain(
      "has no spatial index"
    );
  });

  it("the reserved formats say 'not yet', with what to do today", () => {
    expect(describeFormatFailure({ code: "unsupported", format: "geoparquet", url: "w.parquet" })).toBe(
      "`w.parquet` is a GeoParquet file, which this version of maplibre-yaml can't read yet (it's " +
        "planned). For now, convert it to FlatGeobuf or GeoJSON: `ogr2ogr out.fgb w.parquet`."
    );
    expect(describeFormatFailure({ code: "unsupported", format: "cog", url: "s.tif" })).toContain(
      "can't read on its own yet (it's planned)"
    );
  });

  it("a FormatError's message IS the sentence", () => {
    const e = new FormatError({ code: "not-format", format: "flatgeobuf", url: "a.fgb" });
    expect(e.message).toBe(describeFormatFailure(e.failure));
    expect(e.url).toBe("a.fgb");
  });
});

describe("the notice wraps them", () => {
  it("a layer's FlatGeobuf failure names the layer left empty", () => {
    const e = new FormatError({ code: "not-format", format: "flatgeobuf", url: "a.fgb" });
    expect(describeDataProblem("parcels", e, { filePage: false })).toBe(
      "Layer `parcels` has no data: `a.fgb` isn't a FlatGeobuf file. A wrong path often returns a web " +
        "page instead — check the file name and folder."
    );
  });

  it("a PMTiles 404 under a project site suggests base", () => {
    const e = new FormatError({
      code: "http",
      format: "pmtiles",
      url: "http://u.github.io/data/x.pmtiles",
      status: 404,
    });
    const text = describeSourceProblem("tiles", e.message, e, { pageUrl: "http://u.github.io/my-repo/" });
    expect(text).toContain("Source `tiles` didn't load:");
    expect(text).toContain('add base="/my-repo/"');
  });

  it("a PMTiles 404 that lost its failure object (MapLibre's worker) still says where and suggests base (ml-aot.102)", () => {
    const original = new FormatError({ code: "http", format: "pmtiles", url: "/data/districts.pmtiles", status: 404 });
    // What reaches the page: a plain error with the same message.
    const plain = new Error(original.message);
    const text = describeSourceProblem("districts", plain.message, plain, {
      pageUrl: "http://localhost:4321/my-repo/",
    });
    expect(text).toContain("didn't load (404");
    expect(text).toContain("The browser looked for http://localhost:4321/data/districts.pmtiles.");
    expect(text).toContain('add base="/my-repo/"');
  });
});
