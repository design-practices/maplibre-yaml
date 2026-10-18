/**
 * @file Whole-document checks the schemas cannot express
 * @module @maplibre-yaml/core/parser/document-checks
 *
 * @description
 * Mistakes a student makes in the first hour that validated silently and then
 * misbehaved (0.8.1 pass-2 check, ml-aot.46/.48/.51): a copied chapter that
 * kept its `id`, keys nested one level too deep under `config:`, a chapter
 * that shows a layer by a misspelled name, a `fitTo.source` typo, a CSV file
 * where GeoJSON is expected. Each needs the document as a whole (ids across
 * chapters, names across `layers:` and `sources:`), so they run after the
 * schema, on the materialized value, with the YAML document for positions.
 *
 * Duplicate ids are errors (the second chapter/layer is unusable). The rest
 * are warnings: the document still renders, and some names (a basemap layer
 * in `layers.show`) can only be checked at runtime, so a reference warns only
 * when it is a near miss of a name the document declares.
 */

import type { Document, LineCounter } from "yaml";
import { positionForKey, positionForPath, type ValidationWarning } from "./validation-utils";
import { suggest, spellingVariantOf } from "../utils/suggest";
import { MapBlockSchema, MapConfigSchema } from "../schemas/map.schema";
import { ScrollytellingBlockSchema } from "../schemas/scrollytelling.schema";

/** An error a check found (same shape as the parser's ParseError). */
export interface DocumentCheckError {
  path: string;
  message: string;
  line?: number;
  column?: number;
}

export interface DocumentCheckResult {
  errors: DocumentCheckError[];
  warnings: ValidationWarning[];
}

/** Positions, when the value came from YAML text (absent for value entry points). */
interface Positions {
  doc: Document;
  lineCounter: LineCounter;
}

/**
 * MapLibre `MapOptions` across the supported majors (4, 5, 6), read from each
 * release's type declarations. The map `config:` passes these through to the
 * `Map` constructor, so they are never "unknown". Plus `customAttribution`
 * (maplibre-gl 3's spelling, still honoured by the renderer).
 */
export const MAPLIBRE_MAP_OPTIONS: ReadonlySet<string> = new Set([
  "anisotropicFilterPitch", "antialias", "aroundCenter", "attributionControl", "bearing",
  "bearingSnap", "bounds", "boxZoom", "cancelPendingTileRequestsWhileZooming",
  "canvasContextAttributes", "center", "centerClampedToGround", "clickTolerance",
  "collectResourceTiming", "container", "cooperativeGestures", "crossSourceCollisions",
  "doubleClickZoom", "dragPan", "dragRotate", "elevation", "experimentalZoomLevelsToOverscale",
  "fadeDuration", "failIfMajorPerformanceCaveat", "fitBoundsOptions", "hash", "interactive",
  "keyboard", "locale", "localIdeographFontFamily", "logoPosition", "maplibreLogo", "maxBounds",
  "maxCanvasSize", "maxPitch", "maxTileCacheSize", "maxTileCacheZoomLevels", "maxZoom",
  "minPitch", "minZoom", "pitch", "pitchSpeed", "pitchWithRotate", "pixelRatio",
  "preserveDrawingBuffer", "reduceMotion", "refreshExpiredTiles", "renderWorldCopies", "roll",
  "rollEnabled", "rotateSpeed", "scrollZoom", "style", "terrainSkirtLength", "touchPitch",
  "touchZoomRotate", "trackResize", "transformCameraUpdate", "transformConstrain",
  "transformRequest", "validateStyle", "zoom", "zoomLevelsToOverscale", "zoomSnap",
  "customAttribution",
]);

/** Keys the map `config:` schema itself lists. */
function configKeys(): string[] {
  return Object.keys((MapConfigSchema as any)._def.shape());
}

/** Keys of a block schema's root, i.e. siblings of `config:`. */
function rootKeysOf(schema: unknown): string[] {
  return Object.keys((schema as any)._def.shape());
}

/**
 * Document-root keys that do nothing when nested under `config:`. Built from
 * the block schemas (so a new root key is covered automatically), minus keys
 * that are also map options (`style`, `bounds` …) and the block's identity.
 */
function misplacedRootKeys(kind: "map" | "scrollytelling"): Set<string> {
  const config = new Set([...configKeys(), ...MAPLIBRE_MAP_OPTIONS]);
  const keys = new Set<string>();
  for (const key of [...rootKeysOf(MapBlockSchema), ...rootKeysOf(ScrollytellingBlockSchema)]) {
    if (key === "type" || key === "id" || key === "config" || key === "className") continue;
    if (config.has(key)) continue;
    keys.add(key);
  }
  // Story-only keys belong at a story's root; in a map they are just unknown.
  if (kind === "map") {
    for (const key of rootKeysOf(ScrollytellingBlockSchema)) {
      if (!rootKeysOf(MapBlockSchema).includes(key)) keys.delete(key);
    }
  }
  return keys;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

function at(pos: Positions | undefined, path: (string | number)[]) {
  const p = pos ? positionForPath(pos.doc, pos.lineCounter, path) : undefined;
  return p ? { line: p.line, column: p.column } : {};
}

function atKey(pos: Positions | undefined, objectPath: (string | number)[], key: string) {
  const p = pos ? positionForKey(pos.doc, pos.lineCounter, objectPath, key) : undefined;
  return p ? { line: p.line, column: p.column } : {};
}

/** `Chapter 3 ("bridge")` — chapters counted from 1, named by id. */
export function chapterLabel(chapters: unknown, index: number): string {
  const chapter = Array.isArray(chapters) ? chapters[index] : undefined;
  const id = isObject(chapter) && typeof chapter["id"] === "string" ? chapter["id"] : undefined;
  return `Chapter ${index + 1}${id ? ` ("${id}")` : ""}`;
}

/** A near miss of one of `names`: edit distance, or one name inside the other. */
function nearMiss(input: string, names: string[]): string | undefined {
  const close = suggest(input, names);
  if (close) return close;
  const lower = input.toLowerCase();
  const contained = names.filter((n) => {
    const m = n.toLowerCase();
    return n !== input && Math.min(m.length, lower.length) >= 3 && (lower.includes(m) || m.includes(lower));
  });
  return contained.length === 1 ? contained[0] : undefined;
}

/** Duplicate `id`s in an array of objects: an error on every repeat. */
function duplicateIds(
  items: unknown,
  arrayPath: (string | number)[],
  noun: "chapter" | "layer",
  pos: Positions | undefined,
  errors: DocumentCheckError[]
): void {
  if (!Array.isArray(items)) return;
  const first = new Map<string, number>();
  items.forEach((item, index) => {
    if (!isObject(item) || typeof item["id"] !== "string") return;
    const id = item["id"];
    const earlier = first.get(id);
    if (earlier === undefined) {
      first.set(id, index);
      return;
    }
    const here = at(pos, [...arrayPath, index, "id"]);
    const there = at(pos, [...arrayPath, earlier, "id"]);
    const where =
      here.line !== undefined && there.line !== undefined
        ? `lines ${there.line} and ${here.line}`
        : `${noun}s ${earlier + 1} and ${index + 1}`;
    errors.push({
      path: [...arrayPath, index, "id"].join("."),
      message: `Two ${noun}s have id "${id}" (${where}). Each ${noun} needs its own id: rename this one.`,
      ...here,
    });
  });
}

/** Whether a URL/path names a CSV file (a file name or a sheet's CSV export). */
export function looksLikeCsv(url: string): boolean {
  return (
    /\.csv(?:[?#]|$)/i.test(url) ||
    /[?&](?:output|format)=csv\b/i.test(url) ||
    /[?&]tqx=out:csv\b/i.test(url)
  );
}

/** Warn on CSV `url:`/`data:` in one source object. */
function csvSource(
  source: unknown,
  path: (string | number)[],
  pos: Positions | undefined,
  warnings: ValidationWarning[]
): void {
  if (!isObject(source)) return;
  for (const key of ["url", "data"] as const) {
    const value = source[key];
    if (typeof value !== "string" || !looksLikeCsv(value)) continue;
    warnings.push({
      path: [...path, key].join("."),
      message:
        `"${value}" is a CSV file. maplibre-yaml reads GeoJSON, not CSV, so layers using it ` +
        `get no data. Convert the table to GeoJSON (geojson.io, QGIS, or a ` +
        `spreadsheet's GeoJSON export) and point ${key}: at the .geojson file.`,
      ...at(pos, [...path, key]),
    });
  }
}

/**
 * Run every whole-document check on a v1 map block or a scrollytelling block.
 *
 * @param value - The materialized document (after sugar expansion).
 * @param kind - Which block it is.
 * @param positions - The YAML document and line counter, when the value came
 *   from YAML text; omitted, messages count items instead of quoting lines.
 * @param existing - Warnings already collected, so a key is not reported twice.
 */
export function checkDocument(
  value: unknown,
  kind: "map" | "scrollytelling",
  positions?: Positions,
  existing: ValidationWarning[] = []
): DocumentCheckResult {
  const errors: DocumentCheckError[] = [];
  const warnings: ValidationWarning[] = [];
  if (!isObject(value)) return { errors, warnings };

  const already = new Set(existing.map((w) => w.path));
  const layers = Array.isArray(value["layers"]) ? value["layers"] : [];
  const layerIds = layers
    .map((l) => (isObject(l) && typeof l["id"] === "string" ? l["id"] : undefined))
    .filter((id): id is string => id !== undefined);
  const sources = isObject(value["sources"]) ? value["sources"] : {};
  const sourceNames = Object.keys(sources);

  // ml-aot.46 — duplicate ids.
  duplicateIds(value["layers"], ["layers"], "layer", positions, errors);
  if (kind === "scrollytelling") {
    duplicateIds(value["chapters"], ["chapters"], "chapter", positions, errors);
  }

  // ml-aot.48 — keys under config: that belong at the root, and keys no one reads.
  const config = value["config"];
  if (isObject(config)) {
    const misplaced = misplacedRootKeys(kind);
    const known = [...configKeys(), ...MAPLIBRE_MAP_OPTIONS];
    for (const key of Object.keys(config)) {
      const path = `config.${key}`;
      if (already.has(path) || key.startsWith("x-")) continue;
      if (misplaced.has(key)) {
        warnings.push({
          path,
          message:
            `"${key}" belongs at the top level, next to config:, not inside it. Move it ` +
            `out of config: (indent it like config:); inside config: it does nothing.`,
          ...atKey(positions, ["config"], key),
          onPage: true,
        });
        continue;
      }
      if (known.includes(key)) continue;
      const hint = spellingVariantOf(key, known) ?? suggest(key, known);
      warnings.push({
        path,
        message:
          `Unknown key "${key}" in config: it is not a map option maplibre-yaml or ` +
          `MapLibre knows, so it does nothing.` +
          (hint ? ` Did you mean "${hint}"?` : ""),
        ...atKey(positions, ["config"], key),
        ...(hint ? { suggestion: hint } : {}),
      });
    }

    // ml-aot.51 — fitTo names a source the document does not declare.
    const fitTo = config["fitTo"];
    if (isObject(fitTo) && typeof fitTo["source"] === "string" && !sourceNames.includes(fitTo["source"])) {
      const name = fitTo["source"];
      const hint = nearMiss(name, sourceNames);
      warnings.push({
        path: "config.fitTo.source",
        message:
          `fitTo.source "${name}" is not a source declared under sources:` +
          (sourceNames.length > 0 ? ` (${sourceNames.join(", ")})` : " (there are none)") +
          `, so the map keeps its center and zoom.` +
          (hint ? ` Did you mean "${hint}"?` : ""),
        ...at(positions, ["config", "fitTo", "source"]),
        ...(hint ? { suggestion: hint } : {}),
      });
    }
  }

  // ml-aot.51 — CSV where GeoJSON is expected.
  for (const name of sourceNames) csvSource(sources[name], ["sources", name], positions, warnings);
  layers.forEach((layer, index) => {
    if (isObject(layer)) csvSource(layer["source"], ["layers", index, "source"], positions, warnings);
  });

  // ml-aot.51 — chapter layer references that miss a document layer by a little.
  if (kind === "scrollytelling" && Array.isArray(value["chapters"]) && layerIds.length > 0) {
    const chapters = value["chapters"];
    chapters.forEach((chapter, ci) => {
      if (!isObject(chapter)) return;
      const label = chapterLabel(chapters, ci);
      const toggles = chapter["layers"];
      if (isObject(toggles)) {
        for (const verb of ["show", "hide"] as const) {
          const names = toggles[verb];
          if (!Array.isArray(names)) continue;
          names.forEach((name, ni) => {
            if (typeof name !== "string" || layerIds.includes(name)) return;
            const hint = nearMiss(name, layerIds);
            if (!hint) return;
            const path = ["chapters", ci, "layers", verb, ni];
            warnings.push({
              path: path.join("."),
              message:
                `${label} ${verb}s layer "${name}", which is not a layer in this document. ` +
                `Did you mean "${hint}"? (If it is a basemap layer, ignore this.)`,
              ...at(positions, path),
              suggestion: hint,
            });
          });
        }
      }
      for (const phase of ["onChapterEnter", "onChapterExit"] as const) {
        const actions = chapter[phase];
        if (!Array.isArray(actions)) continue;
        actions.forEach((action, ai) => {
          if (!isObject(action) || typeof action["layer"] !== "string") return;
          const name = action["layer"];
          if (layerIds.includes(name)) return;
          const hint = nearMiss(name, layerIds);
          if (!hint) return;
          const path = ["chapters", ci, phase, ai, "layer"];
          const verb = typeof action["action"] === "string" ? action["action"] : "This action";
          warnings.push({
            path: path.join("."),
            message:
              `${label} ${verb} names layer "${name}", which is not a layer in this document. ` +
              `Did you mean "${hint}"? (If it is a basemap layer, ignore this.)`,
            ...at(positions, path),
            suggestion: hint,
          });
        });
      }
    });
  }

  return { errors, warnings };
}
