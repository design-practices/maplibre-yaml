/**
 * @file Cloud-native sources on emit (0.9, ml-cnv)
 * @module @maplibre-yaml/core/emitter/lower-formats
 *
 * @description
 * style.json can carry a URL but not a decoder, so each format exports the
 * way it honestly can (design §7):
 *
 * - **PMTiles** — class `exports`: the URL is written in the canonical
 *   `pmtiles://` form (a `.pmtiles` URL gains the scheme). The emitted style
 *   then needs a renderer that reads `pmtiles://` (maplibre-gl JS with the
 *   protocol registered): a `contract` warning says so.
 * - **FlatGeobuf** — class `exports-with-fallback`: converted to GeoJSON. Core
 *   stays network-free, so the projection writes an empty placeholder and
 *   returns an {@link EmitDataRef}; `mlym emit` reads the file and inlines
 *   the features (`contract`), or reports `lossy` when it can't.
 * - **GeoParquet** — not read by this version: emitted empty (`lossy`).
 * - **COG** — `cog://` URL, `contract` (needs a COG protocol plugin).
 */

import { formatOfSource, stripScheme, typeReadsFormat } from "../formats/detect";
import type { EmitWarning } from "./project";

/** A FlatGeobuf source the caller must read and inline (core describes, the CLI fetches). */
export interface EmitDataRef {
  /** The emitted source id (a hoisted inline source's generated id included). */
  source: string;
  /** The file URL as the document resolved it. */
  url: string;
  format: "flatgeobuf";
}

/** An empty FeatureCollection: the placeholder until the data is resolved. */
export const EMPTY_FEATURES = Object.freeze({ type: "FeatureCollection", features: [] as unknown[] });

export const PMTILES_ON_EMIT =
  "PMTiles sources export with their URL in the canonical pmtiles:// form; renderers " +
  "must read that protocol (maplibre-gl JS: register it with addProtocol from the " +
  "pmtiles package; check other renderers' PMTiles support).";

export const COG_ON_EMIT =
  "COG sources export as cog:// URLs, which only renderers with a COG protocol plugin " +
  "(e.g. @geomatico/maplibre-cog-protocol) can draw.";

export const FLATGEOBUF_ON_EMIT =
  "FlatGeobuf sources are converted to GeoJSON at emit time: `mlym emit` reads the file " +
  "and inlines its features as the source's data (a snapshot; viewport reading does " +
  "not compile). Unreadable at emit time, the source is emitted empty (lossy).";

export const GEOPARQUET_ON_EMIT =
  "GeoParquet isn't read by this version, so the source is emitted empty (lossy).";

type Obj = Record<string, unknown>;

/**
 * Put resolved FlatGeobuf features into an emitted style (the CLI's half of
 * the conversion). Returns a new style; sources not named are untouched.
 */
export function attachSourceData(
  style: Obj,
  resolved: ReadonlyArray<{ source: string; data: unknown }>
): Obj {
  const sources = style["sources"];
  if (resolved.length === 0 || !sources || typeof sources !== "object") return style;
  const next: Obj = { ...(sources as Obj) };
  for (const { source, data } of resolved) {
    const spec = next[source];
    if (spec && typeof spec === "object") next[source] = { ...(spec as Obj), data };
  }
  return { ...style, sources: next };
}

/**
 * Lower one source whose URL names a cloud-native file.
 *
 * @param id - The emitted source id.
 * @param spec - The source's style half (as projected so far).
 * @param runtime - The source's runtime half (`format:` may sit there).
 * @param path - Dotted path for warnings.
 * @returns The spec to emit, its warnings, and a data ref for FlatGeobuf.
 */
export function lowerSourceFormat(
  id: string,
  spec: Obj,
  runtime: Obj | undefined,
  path: string
): { spec: Obj; warnings: EmitWarning[]; data?: EmitDataRef } {
  const format = formatOfSource({ ...spec, ...(runtime ?? {}) });
  const url = spec["url"];
  if (!format || typeof url !== "string" || !typeReadsFormat(spec["type"], format)) {
    return { spec, warnings: [] };
  }
  switch (format) {
    case "pmtiles": {
      const canonical = `pmtiles://${stripScheme(url)}`;
      return {
        spec: { ...spec, url: canonical },
        warnings: [
          {
            path: `${path}.url`,
            kind: "contract",
            construct: "format.pmtiles",
            exportClass: "exports",
            message: `\`${canonical}\` — ${PMTILES_ON_EMIT}`,
          },
        ],
      };
    }
    case "cog": {
      const canonical = `cog://${stripScheme(url)}`;
      return {
        spec: { ...spec, url: canonical },
        warnings: [
          {
            path: `${path}.url`,
            kind: "contract",
            construct: "format.cog",
            exportClass: "exports",
            message: `\`${canonical}\` — ${COG_ON_EMIT}`,
          },
        ],
      };
    }
    case "flatgeobuf": {
      const { url: _url, ...rest } = spec;
      return {
        spec: { ...rest, data: { type: "FeatureCollection", features: [] } },
        warnings: [
          {
            path: `${path}.url`,
            kind: "contract",
            construct: "format.flatgeobuf",
            exportClass: "exports-with-fallback",
            message: `\`${url}\` — ${FLATGEOBUF_ON_EMIT}`,
          },
        ],
        data: { source: id, url, format: "flatgeobuf" },
      };
    }
    case "geoparquet": {
      const { url: _url, ...rest } = spec;
      return {
        spec: { ...rest, data: { type: "FeatureCollection", features: [] } },
        warnings: [
          {
            path: `${path}.url`,
            kind: "lossy",
            construct: "format.geoparquet",
            exportClass: "no-export",
            message: `\`${url}\` — ${GEOPARQUET_ON_EMIT}`,
          },
        ],
      };
    }
  }
}
