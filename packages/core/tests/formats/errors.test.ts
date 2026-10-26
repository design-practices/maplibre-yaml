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
  raiseCost,
  wholeFileCause,
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

  it("a 416 on a tiny archive with Content-Range hidden is not called a missing or wrong file", () => {
    const e = classifyPmtilesError(new Error("Missing content-length on 416 response"), URL);
    expect(isFormatError(e) && e.failure.code).toBe("read");
    expect((e as Error).message).toContain("Access-Control-Expose-Headers: Content-Range");
    expect((e as Error).message).not.toMatch(/range-request support|isn't a PMTiles file|didn't load/);
  });

  it("passes aborts and unknown errors through unchanged", () => {
    const abort = Object.assign(new Error("The user aborted a request."), { name: "AbortError" });
    expect(classifyPmtilesError(abort, URL)).toBe(abort);
    const other = new Error("Tile zoom level exceeds max safe number limit (26)");
    expect(classifyPmtilesError(other, URL)).toBe(other);
  });
});

describe("describeFormatFailure — the on-page sentences", () => {
  it("a 416 on a tile archive says the file was found (ml-aot.114)", () => {
    const text = describeFormatFailure({ code: "http", status: 416, format: "pmtiles", url: URL });
    expect(text).toContain("didn't load (416 Range Not Satisfiable). The file was found");
  });

  it("no-range names the hosts that work and the one that doesn't", () => {
    expect(describeFormatFailure({ code: "no-range", format: "pmtiles", url: URL })).toBe(
      "`/data/x.pmtiles` was served without range-request support (the server sent the whole file " +
        "instead of the part asked for). PMTiles, FlatGeobuf, GeoParquet and COG files need a web server that supports " +
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
    const big = describeFormatFailure({ code: "too-large", format: "flatgeobuf", url: "p.fgb", size: 180 * 1024 * 1024 });
    expect(big).toContain("`p.fgb` is 180 MB, too large to load whole in a browser. Reading it by view needs a spatial index: ");
    expect(big).toContain("`ogr2ogr -f FlatGeobuf -lco SPATIAL_INDEX=YES p-indexed.fgb p.fgb`; it is then read by view.");
    // tylertoo reads GeoParquet: a FlatGeobuf file is converted first.
    expect(big).toContain("convert it to PMTiles: `ogr2ogr -f Parquet p.parquet p.fgb`, then `uv run --with tylertoo==0.8.0");
    expect(big).toContain("https://docs.maplibre-yaml.org/guides/flatgeobuf/#large-files");
    expect(describeFormatFailure({ code: "no-index", format: "flatgeobuf", url: "p.fgb" })).toContain(
      "has no spatial index"
    );
  });

  it("a recognized format this version can't read says so, with what to do", () => {
    expect(describeFormatFailure({ code: "unsupported", format: "geoparquet", url: "w.parquet" })).toBe(
      "`w.parquet` is a GeoParquet file, which this version of maplibre-yaml can't read. " +
        "Update maplibre-yaml, or convert the file to a format this version reads."
    );
  });

  it("a COG in the wrong projection gets the gdalwarp command (ml-cnv.2)", () => {
    expect(describeFormatFailure({ code: "crs", format: "cog", url: "/d/scene.tif", crs: "EPSG:4326" })).toBe(
      "`/d/scene.tif` is in EPSG:4326; a COG must be in Web Mercator (EPSG:3857) to be drawn. " +
        "Reproject it: `gdalwarp -t_srs EPSG:3857 -of COG -co COMPRESS=DEFLATE scene.tif out.tif` " +
        "(GDAL 3.1 or later)."
    );
    expect(describeFormatFailure({ code: "crs", format: "cog", url: "photo.tif" })).toContain(
      "has no map coordinates (a plain TIFF image, not a GeoTIFF)"
    );
  });

  it("a GeoTIFF that isn't cloud-optimized gets the gdal_translate command", () => {
    expect(describeFormatFailure({ code: "not-cloud-optimized", format: "cog", url: "/d/big.tif" })).toBe(
      "`/d/big.tif` is a GeoTIFF but not a Cloud Optimized one (it has no internal tiles or no " +
        "overviews), so the browser may download most of the file to draw it. Convert it: " +
        "`gdal_translate -of COG -co COMPRESS=DEFLATE big.tif out.tif`."
    );
  });

  it("GeoParquet: plain Parquet, GeoArrow geometry, a CRS, a size, no covering column", () => {
    expect(describeFormatFailure({ code: "not-geoparquet", format: "geoparquet", url: "d/t.parquet" })).toBe(
      "`d/t.parquet` is a Parquet file but not GeoParquet (it has no geometry metadata). Write it with " +
        "GeoPandas `to_parquet`, `ogr2ogr -f Parquet`, or DuckDB's spatial extension."
    );
    expect(
      describeFormatFailure({ code: "encoding", format: "geoparquet", url: "d/p.parquet", encoding: "point" })
    ).toBe(
      "`d/p.parquet` stores its geometry as GeoArrow (`point`), which maplibre-yaml doesn't read yet: it " +
        "reads GeoParquet with WKB geometry. Rewrite it with WKB: `ogr2ogr -f Parquet -lco " +
        'GEOMETRY_ENCODING=WKB out.parquet p.parquet`, or GeoPandas `to_parquet(..., geometry_encoding="WKB")`.'
    );
    expect(describeFormatFailure({ code: "crs", format: "geoparquet", url: "d/p.parquet", crs: "EPSG:3857" })).toBe(
      "`d/p.parquet` is in EPSG:3857; MapLibre needs longitude/latitude (EPSG:4326). Reproject it: " +
        "`ogr2ogr -t_srs EPSG:4326 out.parquet p.parquet`."
    );
    expect(
      describeFormatFailure({ code: "too-large", format: "geoparquet", url: "p.parquet", size: 80 * 1024 * 1024 })
    ).toContain("`p.parquet` is 80 MB (the columns this map reads), too large to load whole in a browser.");
    expect(describeFormatFailure({ code: "no-index", format: "geoparquet", url: "p.parquet" })).toContain(
      "has no `bbox` covering column, so it can't be read one part at a time (`load: viewport`)"
    );
    expect(describeFormatFailure({ code: "not-format", format: "geoparquet", url: "p.parquet" })).toBe(
      "`p.parquet` isn't a GeoParquet file. A wrong path often returns a web page instead — check the " +
        "file name and folder."
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

describe("too-large: the cause, why it can't be read by view, and every way to make it draw (0.9.2 review)", () => {
  const MB = 1024 * 1024;
  const limits = { features: 400_000, bytes: 50 * MB, decoded: 100 * MB };

  it("an unsorted GeoParquet file over the feature limit: sort it (never 'add load: viewport'), raise maxFeatures, or PMTiles", () => {
    expect(
      describeFormatFailure({
        code: "too-large",
        format: "geoparquet",
        url: "/data/lots.parquet",
        size: 30 * MB,
        features: 475_628,
        decoded: 80 * MB,
        limits,
        blocker: "unsorted",
      })
    ).toBe(
      "`/data/lots.parquet` has 475,628 features, more than a page loads whole (400,000 features), and it can't be " +
        "read by view: its rows aren't in spatially sorted row groups (each row group spans most of the file, " +
        "so every view would read most of it). Sort it: `ogr2ogr -f Parquet -lco WRITE_COVERING_BBOX=YES -lco SORT_BY_BBOX=YES -lco " +
        "ROW_GROUP_SIZE=10000 lots-sorted.parquet lots.parquet`; it is then read by view. Or load it whole anyway " +
        "with `load: { maxFeatures: 500000 }` (about 3.5 GB of browser memory for parcel-like polygons, less for points). To draw it at every zoom (a citywide view too), " +
        "convert it to PMTiles: `uv run --with tylertoo==0.8.0 python -c \"import tylertoo as t; " +
        "t.overview('lots.parquet', 'lots-ov.parquet', min_zoom=10, max_zoom=14, collapse_square=True); " +
        "t.export_pmtiles('lots-ov.parquet', 'lots.pmtiles', layer_name='lots', tile_size_limit=None)\"` (the parcel " +
        "recipe: set min_zoom and max_zoom for your map). More: " +
        "https://docs.maplibre-yaml.org/guides/geoparquet/#large-files and " +
        "https://docs.maplibre-yaml.org/guides/pmtiles/#from-a-large-file"
    );
  });

  it("a host without range requests: the hosting is what to change", () => {
    const text = describeFormatFailure({
      code: "too-large",
      format: "geoparquet",
      url: "bk.parquet",
      size: 45 * MB,
      features: 475_628,
      decoded: 100 * MB,
      limits,
      blocker: "no-range",
    });
    expect(text).toContain("it can't be read by view: this server doesn't support HTTP range requests. Host it where they work");
    expect(text).not.toContain("Add `load: viewport`");
  });

  it("over the decoded size: no maxFeatures (it wouldn't help), list fewer columns", () => {
    const text = describeFormatFailure({
      code: "too-large",
      format: "geoparquet",
      url: "pluto.parquet",
      size: 47 * MB,
      features: 856_687,
      decoded: 142 * MB,
      limits,
      blocker: "no-bbox",
    });
    expect(text).toContain("has 856,687 features and reads columns that decode to 142 MB, more than a page loads whole (400,000 features, 100 MB decoded)");
    expect(text).toContain("it has no `bbox` covering column. Rewrite it with one, sorted:");
    expect(text).toContain("Or list fewer `columns:`.");
    expect(text).not.toContain("maxFeatures");
  });

  it("a whole file the host hid the size of: the file's size, and the header to send", () => {
    const text = describeFormatFailure({
      code: "too-large",
      format: "geoparquet",
      url: "big.parquet",
      size: 139 * MB,
      sizeIsFile: true,
      limits: { bytes: 50 * MB },
      blocker: "no-size",
    });
    expect(text).toContain("`big.parquet` is 139 MB, more than a page loads whole (50 MB transferred)");
    expect(text).not.toContain("the columns this map reads");
    expect(text).toContain("Access-Control-Expose-Headers: Content-Range");
  });
});

describe("a maxFeatures raise is offered only while it stays usable, with its cost (PR #206 verification)", () => {
  const MB = 1024 * 1024;
  const limits = { features: 400_000, bytes: 50 * MB, decoded: 100 * MB };
  const refuse = (features: number) =>
    describeFormatFailure({ code: "too-large", format: "flatgeobuf", url: "c.fgb", features, size: 40 * MB, limits, blocker: "no-index" });

  it("citywide (856,687): no raise — loading it whole froze the page for 10–37 s", () => {
    expect(wholeFileCause({ format: "flatgeobuf", features: 856_687, limits }).raise).toBeUndefined();
    const text = refuse(856_687);
    expect(text).not.toContain("maxFeatures");
    expect(text).toContain("convert it to PMTiles");
  });

  it("up to 600,000: the raise, with what it costs", () => {
    expect(wholeFileCause({ format: "flatgeobuf", features: 571_000, limits }).raise).toBe(600_000);
    expect(wholeFileCause({ format: "flatgeobuf", features: 572_000, limits }).raise).toBeUndefined();
    expect(refuse(475_628)).toContain(
      "Or load it whole anyway with `load: { maxFeatures: 500000 }` (about 3.5 GB of browser memory for parcel-like polygons, less for points)."
    );
    expect(raiseCost(250_000, true)).toBe("about 3.5 GB of browser memory for parcel-like polygons, less for points");
  });
});
