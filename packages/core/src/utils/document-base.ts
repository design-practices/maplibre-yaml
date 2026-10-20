/**
 * @file Resolve the site paths inside a map document against a `base`
 * @module @maplibre-yaml/core/utils/document-base
 *
 * @description
 * A site deployed under a subpath — a GitHub Pages *project* site is served
 * from `https://<user>.github.io/<repo>/` — keeps its files at
 * `/<repo>/data/x.geojson`, but a document written for the site says
 * `url: "/data/x.geojson"` (or `data/x.geojson`). The browser resolves the
 * first against the domain root and the second against whatever page the map
 * is on, so both 404 on the deployed site (ml-aot.30). `<ml-map base="/<repo>/">`
 * fixes that in one place: every URL-bearing field of the document runs
 * through {@link resolveDocumentUrl} before the renderer sees it.
 *
 * ## Rules (with a base)
 *
 * - `/data/x.geojson` (root-relative) → `<base>data/x.geojson`, unless it
 *   already starts with the base path (`/<repo>/data/x.geojson` is never
 *   doubled).
 * - `data/x.geojson`, `./data/x.geojson`, `../x.geojson` (relative) → resolved
 *   against the base, not the page, so the same document works on every page
 *   of the site.
 * - Anything with a scheme (`https:`, `blob:`, `data:`, `mailto:`),
 *   protocol-relative `//cdn…`, and `#…` / `?…` references are left as
 *   written.
 * - A tile-protocol URL (`pmtiles://`, `cog://`) keeps its scheme and has
 *   the file URL inside it rebased by the rules above:
 *   `pmtiles://data/x.pmtiles` → `pmtiles://<base>data/x.pmtiles`;
 *   `pmtiles://https://…` is left as written.
 * - Tile placeholders (`{z}/{x}/{y}`, `{fontstack}`) are kept verbatim — no
 *   `new URL()` round trip percent-encodes their braces.
 *
 * Without a base (`null`, `undefined`, `""`) every function here is the
 * identity, so documents behave exactly as before.
 */

import type { MapModel, SourceModel, LayerModel } from "../model/types";

/** A string carrying its own scheme (`https:`, `blob:`, `pmtiles:` …). */
const HAS_SCHEME = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;

/** A tile-protocol URL whose inner part is itself a file URL (`pmtiles://…`, `cog://…`). */
const TILE_PROTOCOL = /^(?:pmtiles|cog):\/\//i;

/**
 * Normalize a `base` value to the form {@link resolveDocumentUrl} joins with:
 * a path that starts and ends with `/` (`"/my-repo/"`), or an absolute URL
 * ending in `/` (`"https://cdn.example.com/site/"`).
 *
 * @param base - `"/my-repo"`, `"/my-repo/"`, `"my-repo"`, `"/"`, an absolute
 *   URL, or nothing.
 * @returns The normalized base, or `null` when there is none (empty or
 *   whitespace-only). Query and fragment are dropped.
 *
 * @example
 * ```ts
 * normalizeDocumentBase("/my-repo");  // "/my-repo/"
 * normalizeDocumentBase("my-repo/");  // "/my-repo/"
 * normalizeDocumentBase("/");         // "/"
 * normalizeDocumentBase("");          // null
 * ```
 */
export function normalizeDocumentBase(base: string | null | undefined): string | null {
  if (typeof base !== "string") return null;
  const trimmed = base.trim().replace(/[?#].*$/, "");
  if (trimmed === "") return null;
  const { origin, path } = splitOrigin(trimmed);
  let normalized = normalizePath(path.startsWith("/") ? path : `/${path}`);
  if (!normalized.endsWith("/")) normalized += "/";
  return origin + normalized;
}

/**
 * Resolve one URL from a map document against the document base.
 *
 * @param url - The URL or path as the author wrote it.
 * @param base - The base (any form {@link normalizeDocumentBase} accepts).
 * @returns The URL to fetch. Unchanged without a base, for absolute and
 *   protocol-relative URLs, for `#`/`?`-only references, for non-strings, and
 *   for a root-relative path that already starts with the base.
 *
 * @example
 * ```ts
 * resolveDocumentUrl("/data/x.geojson", "/my-repo/");          // "/my-repo/data/x.geojson"
 * resolveDocumentUrl("data/x.geojson", "/my-repo");            // "/my-repo/data/x.geojson"
 * resolveDocumentUrl("/my-repo/data/x.geojson", "/my-repo/");  // unchanged
 * resolveDocumentUrl("https://example.com/x.geojson", "/my-repo/"); // unchanged
 * resolveDocumentUrl("data/x.geojson", null);                  // unchanged
 * ```
 */
export function resolveDocumentUrl<T>(url: T, base: string | null | undefined): T {
  if (typeof url !== "string" || url === "") return url;
  const normalized = normalizeDocumentBase(base);
  if (normalized === null) return url;
  return resolveAgainst(url, normalized) as T;
}

/** {@link resolveDocumentUrl} with an already-normalized base. */
function resolveAgainst(url: string, base: string): string {
  // A tile-protocol URL wraps a file URL (`pmtiles://data/x.pmtiles`): the
  // file inside is what the browser fetches, so it is what gets rebased
  // (ml-cnv; in 0.8 these 404'd on a GitHub Pages project site).
  const protocol = TILE_PROTOCOL.exec(url);
  if (protocol) {
    const inner = url.slice(protocol[0].length);
    const resolved = inner === "" ? inner : resolveAgainst(inner, base);
    return resolved === inner ? url : protocol[0] + resolved;
  }
  if (HAS_SCHEME.test(url) || url.startsWith("//")) return url;
  if (url.startsWith("#") || url.startsWith("?")) return url;

  const { origin, path: basePath } = splitOrigin(base);
  if (url.startsWith("/")) {
    // basePath always ends in "/"; "/" itself means "the site root", where a
    // root-relative path is already right.
    const prefix = basePath.slice(0, -1);
    if (prefix === "" || startsWithSegment(url, prefix)) return origin + url;
    return origin + prefix + url;
  }
  return origin + normalizePath(basePath + url);
}

/** Whether `url` is `prefix` followed by a path, query or fragment boundary. */
function startsWithSegment(url: string, prefix: string): boolean {
  if (!url.startsWith(prefix)) return false;
  const next = url.charAt(prefix.length);
  return next === "" || next === "/" || next === "?" || next === "#";
}

/** `"https://h/x/"` → `{ origin: "https://h", path: "/x/" }`; a path has no origin. */
function splitOrigin(value: string): { origin: string; path: string } {
  const match = /^([a-zA-Z][a-zA-Z\d+\-.]*:\/\/[^/?#]*)(.*)$/.exec(value);
  if (!match) return { origin: "", path: value };
  return { origin: match[1]!, path: match[2] || "/" };
}

/**
 * Remove `.` and `..` segments from the path part of a root-relative
 * reference, keeping its query and fragment (and any `{token}`) verbatim.
 */
function normalizePath(reference: string): string {
  const cut = reference.search(/[?#]/);
  const path = cut === -1 ? reference : reference.slice(0, cut);
  const rest = cut === -1 ? "" : reference.slice(cut);
  const out: string[] = [];
  const segments = path.split("/").slice(1);
  segments.forEach((segment, i) => {
    const last = i === segments.length - 1;
    if (segment === ".") {
      if (last) out.push("");
    } else if (segment === "..") {
      out.pop();
      if (last) out.push("");
    } else {
      out.push(segment);
    }
  });
  return `/${out.join("/")}${rest}`;
}

// ---------------------------------------------------------------------------
// Document walk
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Copy-on-write: return `obj` itself when no field changed, otherwise a
 * shallow copy with the changed fields. Only keys already present are ever
 * written, so key presence (significant to MapLibre's option merge) is kept.
 */
function patch<T extends Obj>(obj: T, changes: Obj): T {
  let copy: Obj | null = null;
  for (const [key, value] of Object.entries(changes)) {
    if (!(key in obj) || obj[key] === value) continue;
    copy ??= { ...obj };
    copy[key] = value;
  }
  return (copy ?? obj) as T;
}

/** Map an array, returning the original when no element changed. */
function mapArray<T>(list: T[], fn: (item: T) => T): T[] {
  let changed = false;
  const out = list.map((item) => {
    const next = fn(item);
    if (next !== item) changed = true;
    return next;
  });
  return changed ? out : list;
}

/** Rebase the string entries of a URL list (`tiles`, video `urls`). */
function rebaseUrlList(value: unknown, base: string): unknown {
  if (!Array.isArray(value)) return value;
  return mapArray(value, (u) => (typeof u === "string" ? resolveAgainst(u, base) : u));
}

/** A string field rebased; anything else untouched. */
function rebaseString(value: unknown, base: string): unknown {
  return typeof value === "string" && value !== "" ? resolveAgainst(value, base) : value;
}

/**
 * The URL fields of one source object — a raw document source, or either
 * half of a {@link SourceModel}: `url` (GeoJSON file, TileJSON, image
 * overlay), `tiles`, video `urls`, a GeoJSON `data` *string* (MapLibre
 * fetches it; inline objects are left alone), and `stream.url`.
 */
function rebaseSourceObject(source: unknown, base: string): unknown {
  if (!isObject(source)) return source;
  const changes: Obj = {
    url: rebaseString(source["url"], base),
    tiles: rebaseUrlList(source["tiles"], base),
    urls: rebaseUrlList(source["urls"], base),
    data: rebaseString(source["data"], base),
  };
  const stream = source["stream"];
  if (isObject(stream)) changes["stream"] = patch(stream, { url: rebaseString(stream["url"], base) });
  return patch(source, changes);
}

/** Popup content (`[{ p: [{ str, href }] }]`): each item's `href`. */
function rebasePopupContent(content: unknown, base: string): unknown {
  if (!Array.isArray(content)) return content;
  return mapArray(content, (block) => {
    if (!isObject(block)) return block;
    const changes: Obj = {};
    for (const [tag, items] of Object.entries(block)) {
      if (!Array.isArray(items)) continue;
      changes[tag] = mapArray(items, (item) =>
        isObject(item) ? patch(item, { href: rebaseString(item["href"], base) }) : item
      );
    }
    return patch(block, changes);
  });
}

/** A layer's `interactive:` block: the hover and click popups. */
function rebaseInteractive(interactive: unknown, base: string): unknown {
  if (!isObject(interactive)) return interactive;
  const changes: Obj = {};
  for (const trigger of ["hover", "click"]) {
    const block = interactive[trigger];
    if (isObject(block)) {
      changes[trigger] = patch(block, { popup: rebasePopupContent(block["popup"], base) });
    }
  }
  return patch(interactive, changes);
}

/**
 * One layer — a raw document layer, or either half of a {@link LayerModel}:
 * its inline `source` object and its `interactive` popups.
 */
function rebaseLayerObject(layer: unknown, base: string): unknown {
  if (!isObject(layer)) return layer;
  return patch(layer, {
    source: rebaseSourceObject(layer["source"], base),
    interactive: rebaseInteractive(layer["interactive"], base),
  });
}

/** `images:` — a URL string, or `{ url, sdf, pixelRatio }`. */
function rebaseImages(images: unknown, base: string): unknown {
  if (!isObject(images)) return images;
  const changes: Obj = {};
  for (const [name, image] of Object.entries(images)) {
    changes[name] =
      typeof image === "string"
        ? resolveAgainst(image, base)
        : isObject(image)
          ? patch(image, { url: rebaseString(image["url"], base) })
          : image;
  }
  return patch(images, changes);
}

/**
 * An inline basemap style object: `sprite` (a URL or `[{ id, url }]`),
 * `glyphs` (a template — `{fontstack}/{range}` kept), and its `sources`.
 */
function rebaseInlineStyle(style: unknown, base: string): unknown {
  if (!isObject(style)) return style;
  const sprite = style["sprite"];
  const sources = style["sources"];
  const sourceChanges: Obj = {};
  if (isObject(sources)) {
    for (const [id, source] of Object.entries(sources)) {
      sourceChanges[id] = rebaseSourceObject(source, base);
    }
  }
  return patch(style, {
    sprite: Array.isArray(sprite)
      ? mapArray(sprite, (entry) =>
          isObject(entry) ? patch(entry, { url: rebaseString(entry["url"], base) }) : entry
        )
      : rebaseString(sprite, base),
    glyphs: rebaseString(style["glyphs"], base),
    sources: isObject(sources) ? patch(sources, sourceChanges) : sources,
  });
}

/**
 * Resolve every URL in a normalized map document against `base`.
 *
 * @param model - The document as {@link toModel} returns it (v1 and v2 both
 *   normalize to this shape).
 * @param base - The document base (any form {@link normalizeDocumentBase}
 *   accepts). Without one the model is returned as is.
 * @returns A model whose URL fields are resolved — the input when nothing
 *   changed. Never mutates the input, and never adds a key.
 *
 * @remarks
 * The fields, from the schemas:
 *
 * | Where | Field |
 * | --- | --- |
 * | `config.mapStyle` / `style.basemap` | the style URL; for an inline style object, its `sprite`, `glyphs` and `sources` |
 * | `sources.*` and inline `layers[].source` | `url`, `tiles[]`, `urls[]` (video), `data` when it is a string, `stream.url` |
 * | `images.*` | the URL string, or `url` |
 * | `markers[]` | `icon`, and `href`s in its `popup` |
 * | `layers[].interactive` | `href`s in `hover.popup` / `click.popup` |
 * | `popups[]` | `href`s in `content` |
 *
 * Not URLs, so not touched: legend `icon` (rendered as text), popup image
 * `src` (absolute URLs only), `fitTo.source` / `terrain.source` (source
 * names), and anything inside an external style JSON or GeoJSON file.
 */
export function applyDocumentBase(model: MapModel, base: string | null | undefined): MapModel {
  const normalized = normalizeDocumentBase(base);
  if (normalized === null) return model;
  const b = normalized;

  const style = model.style;
  const basemap = style.basemap;
  const sourceChanges: Obj = {};
  for (const [id, source] of Object.entries(style.sources ?? {})) {
    sourceChanges[id] = patch(source as unknown as Obj, {
      spec: rebaseSourceObject(source.spec, b),
      runtime: rebaseSourceObject(source.runtime, b),
    }) as unknown as SourceModel;
  }
  const nextStyle = patch(style as unknown as Obj, {
    basemap: typeof basemap === "string" ? rebaseString(basemap, b) : rebaseInlineStyle(basemap, b),
    images: rebaseImages(style.images, b),
    sources: style.sources ? patch(style.sources as unknown as Obj, sourceChanges) : style.sources,
    layers: Array.isArray(style.layers)
      ? mapArray(style.layers, (layer: LayerModel) =>
          patch(layer as unknown as Obj, {
            spec: rebaseLayerObject(layer.spec, b),
            runtime: rebaseLayerObject(layer.runtime, b),
          }) as unknown as LayerModel
        )
      : style.layers,
  }) as unknown as MapModel["style"];

  const runtime = model.runtime;
  const nextRuntime = patch(runtime as unknown as Obj, {
    markers: Array.isArray(runtime.markers)
      ? mapArray(runtime.markers, (marker) =>
          patch(marker as unknown as Obj, {
            icon: rebaseString(marker.icon, b),
            popup: rebasePopupContent(marker.popup, b),
          }) as unknown as typeof marker
        )
      : runtime.markers,
    popups: Array.isArray(runtime.popups)
      ? mapArray(runtime.popups, (popup) =>
          patch(popup as unknown as Obj, {
            content: rebasePopupContent(popup.content, b),
          }) as unknown as typeof popup
        )
      : runtime.popups,
  }) as unknown as MapModel["runtime"];

  return nextStyle === style && nextRuntime === runtime
    ? model
    : { ...model, style: nextStyle, runtime: nextRuntime };
}

/**
 * Resolve the URLs of one raw document layer (the `addLayer()` shape): its
 * inline `source` and its popup links.
 */
export function applyDocumentBaseToLayer<T>(layer: T, base: string | null | undefined): T {
  const normalized = normalizeDocumentBase(base);
  if (normalized === null) return layer;
  return rebaseLayerObject(layer, normalized) as T;
}
