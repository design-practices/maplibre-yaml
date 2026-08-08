/**
 * @file Compile-time basemap merge
 * @module @maplibre-yaml/core/emitter
 *
 * @description
 * A document names its base style; the emitted artifact has to *contain* it.
 * That is the difference between a style.json that opens in Maputnik on a
 * machine that has never seen this library and one that is still a reference to
 * somewhere else.
 *
 * The merge exists because MapLibre has no style `imports` mechanism. If one
 * ships, this is the unit that changes — the approach, not the goal.
 *
 * Resolution and merging are separate on purpose. {@link mergeBasemap} is pure:
 * two style objects in, one out, no IO, so every ordering and collision rule is
 * testable without a network. {@link resolveBasemap} is the only part that
 * touches the outside world, and it takes its fetcher as an argument so a build
 * can supply a cache, an offline mirror, or a vendored file.
 */

import type { EmitResult, EmitWarning } from "./project";
import { EmitError } from "./project";

/**
 * Root properties inherited from the base style.
 *
 * @remarks
 * These describe the base's own rendering resources and have no document-level
 * equivalent — a document that names a basemap wants its sprite and glyphs, or
 * every symbol layer in it renders blank. `center`/`zoom`/`pitch`/`bearing` are
 * deliberately absent: the author's camera wins over the basemap's default, and
 * that is the whole point of declaring one.
 */
const INHERITED_ROOT_KEYS = [
  "sprite",
  "glyphs",
  "light",
  "sky",
  "terrain",
  "projection",
  "transition",
  "name",
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asLayerArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

/**
 * Merge a projected document over a base style.
 *
 * @remarks
 * The document wins on every conflict. It is the thing being authored; the
 * basemap is the substrate. But a silent win is a debugging problem — an author
 * who unknowingly shadows a basemap source gets a map that renders wrong with
 * no explanation — so every collision warns.
 *
 * Layer order across the seam is the substantive decision here. Document layers
 * append after the base's by default, which is what "draw my data on top of the
 * map" means. A `before` naming a base layer inserts at that position instead,
 * which is how a layer gets slotted underneath labels — the common reason to
 * reach for it at all.
 */
export function mergeBasemap(base: unknown, projected: EmitResult): EmitResult {
  if (!isPlainObject(base)) {
    throw new EmitError(
      "The basemap did not resolve to a style object. A base style must be a " +
        "JSON object with `version`, `sources`, and `layers`."
    );
  }

  const warnings: EmitWarning[] = [...projected.warnings];
  const documentStyle = projected.style;

  // Sources: base first, document over the top.
  const baseSources = isPlainObject(base["sources"]) ? base["sources"] : {};
  const documentSources = isPlainObject(documentStyle["sources"])
    ? documentStyle["sources"]
    : {};
  const sources: Record<string, unknown> = { ...baseSources };
  for (const [name, source] of Object.entries(documentSources)) {
    if (name in sources) {
      warnings.push({
        path: `sources.${name}`,
        message:
          `Source "${name}" shadows one of the same name in the basemap. ` +
          "The document's definition is used.",
      });
    }
    sources[name] = source;
  }

  // Layers: start from the base, then place the document's.
  const baseLayers = asLayerArray(base["layers"]);
  const documentLayers = asLayerArray(documentStyle["layers"]);
  const byId = new Map(documentLayers.map((l) => [String(l["id"]), l]));

  const merged: Record<string, unknown>[] = [];
  for (const layer of baseLayers) {
    const id = String(layer["id"]);
    if (byId.has(id)) {
      warnings.push({
        path: `layers.${id}`,
        message:
          `Layer "${id}" shadows one of the same name in the basemap. ` +
          "The document's definition replaces it in place.",
      });
      merged.push(byId.get(id)!);
      byId.delete(id);
      continue;
    }
    merged.push(layer);
  }

  // Placement order follows the document's own order, so a chain of `before`
  // references between document layers resolves the way the author wrote it.
  const placements = new Map(projected.placements.map((p) => [p.id, p]));
  for (const layer of documentLayers) {
    const id = String(layer["id"]);
    if (!byId.has(id)) continue; // already placed as a shadow of a base layer
    byId.delete(id);

    const before = placements.get(id)?.before;
    if (before === undefined) {
      merged.push(layer);
      continue;
    }

    const index = merged.findIndex((l) => String(l["id"]) === before);
    if (index === -1) {
      warnings.push({
        path: `layers.${id}`,
        message:
          `\`before: ${before}\` names a layer that is in neither the document ` +
          "nor the basemap; this layer is appended instead.",
      });
      merged.push(layer);
      continue;
    }
    merged.splice(index, 0, layer);
  }

  const style: Record<string, unknown> = { version: 8 };
  for (const key of INHERITED_ROOT_KEYS) {
    if (key in base) style[key] = base[key];
  }
  for (const [key, value] of Object.entries(documentStyle)) {
    if (key === "sources" || key === "layers") continue;
    style[key] = value;
  }
  style["sources"] = sources;
  style["layers"] = merged;

  return { style, warnings, placements: projected.placements };
}

/** Injectable so a build can supply a cache, an offline mirror, or a file. */
export type BasemapFetcher = (url: string) => Promise<unknown>;

const defaultFetcher: BasemapFetcher = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
};

/**
 * Resolve a `basemap` declaration to a style object.
 *
 * @remarks
 * A basemap may be given inline as an object, in which case there is nothing to
 * resolve. A URL is fetched.
 *
 * Failure is an error rather than a degradation, in both modes. Every other
 * unrepresentable thing has a sane fallback — live data becomes a snapshot,
 * chrome becomes absence — but a map with no basemap is not a degraded map, it
 * is a blank screen. Emitting one silently would hand someone an artifact that
 * looks like it worked.
 */
export async function resolveBasemap(
  basemap: unknown,
  fetcher: BasemapFetcher = defaultFetcher
): Promise<unknown> {
  if (isPlainObject(basemap)) return basemap;

  if (typeof basemap !== "string") {
    throw new EmitError(
      "`basemap` must be a URL or an inline style object; got " + typeof basemap + "."
    );
  }

  try {
    return await fetcher(basemap);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new EmitError(
      `Could not fetch the basemap at ${basemap}: ${reason}. ` +
        "Emit needs the base style to inline it; a style that only references " +
        "it is not self-contained."
    );
  }
}
