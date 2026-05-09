/**
 * @file GeoJSON file loader with feature-lookup helpers
 * @module @maplibre-yaml/astro/utils/feature-ref-loader
 *
 * @description
 * Provides the `GeoJSONLoadError` class and the pure `findFeature` lookup
 * helper. The async file loader (`loadFeatureFile`) and the cache
 * machinery are added in Unit 3.
 *
 * `findFeature` is intentionally pure: it operates on already-parsed
 * in-memory FeatureCollections and never touches disk. This keeps it
 * testable with synthetic inputs.
 */

import { readFile, realpath, stat } from "fs/promises";
import { isAbsolute, relative, resolve } from "path";
import type { Feature, FeatureCollection } from "geojson";
import type { FeatureRef } from "./feature-ref-schema";

/**
 * Threshold below which the per-property index is not built. Linear scans
 * on small files are fast enough that index allocation is wasted work.
 *
 * @internal
 */
const INDEX_THRESHOLD = 200;

/**
 * File-size budget (bytes). Files exceeding this throw a clear error
 * before `readFile` is called -- prevents OOM on memory-constrained CI.
 *
 * @internal
 */
const HARD_ERROR_BYTES = 100 * 1024 * 1024;

/**
 * File-size at which a build-time warning is emitted. Files between this
 * threshold and the hard error still load, but the warning suggests
 * splitting or switching to a tile-based source.
 *
 * @internal
 */
const SOFT_WARN_BYTES = 50 * 1024 * 1024;

/**
 * Cache entry: parsed FeatureCollection plus metadata for invalidation
 * (mtime) and lazy per-property indexes.
 *
 * @internal
 */
interface CacheEntry {
  mtimeMs: number;
  fc: FeatureCollection;
  /**
   * Map<property, Map<value, Feature[]>>; populated lazily on second access
   * for a given property. Stored as arrays to preserve multi-match info so
   * findFeature can surface "more than one match" errors correctly.
   */
  indexByProperty: Map<string, Map<unknown, Feature[]>>;
  /**
   * Track which properties have been queried at least once. On the second
   * query for the same property, the index is built and used thereafter.
   * Below INDEX_THRESHOLD features, indexing is skipped entirely.
   *
   * @internal
   */
  propertyAccessCount: Map<string, number>;
}

/**
 * Module-level cache, keyed by canonicalized absolute path (realpath).
 * Lifetime = process lifetime.
 *
 * Forward-compatibility constraint #6: this cache is module-private. Only
 * `clearFeatureCache` is exported. V2 may swap this implementation (e.g.,
 * for runtime resolution); the swap stays internal.
 *
 * @internal
 */
const fileCache = new Map<string, CacheEntry>();

/**
 * In-flight load tracking. Concurrent `loadFeatureFile` calls for the same
 * canonical path share a single Promise -- prevents double-parse on cache
 * misses under parallel page builds.
 *
 * @internal
 */
const inFlight = new Map<string, Promise<FeatureCollection>>();

/**
 * Test-only debug accessor for the cache entry at a given absolute path.
 * Marked `@internal` and NOT exported from the package barrel
 * (forward-compat constraint #3).
 *
 * @internal
 */
export function _getCacheEntryDebug(absPath: string): CacheEntry | undefined {
  return fileCache.get(absPath);
}

/**
 * Clear the entire feature-file cache. Intended for test isolation between
 * test files that share absolute paths.
 *
 * @example
 * ```typescript
 * import { afterEach } from 'vitest';
 * import { clearFeatureCache } from '@maplibre-yaml/astro';
 *
 * afterEach(() => clearFeatureCache());
 * ```
 */
export function clearFeatureCache(): void {
  fileCache.clear();
  inFlight.clear();
}

/**
 * Resolve `srcPath` to a canonical absolute path inside the project root.
 *
 * Throws `GeoJSONLoadError` if the resolved path escapes the project root
 * (path traversal protection) or if the file does not exist.
 *
 * Uses `realpath` to canonicalize symlinks so two refs pointing at the
 * same physical file via different paths share a cache entry.
 *
 * @internal
 */
async function resolveSourcePath(srcPath: string): Promise<string> {
  const projectRoot = process.cwd();

  // Path-traversal containment check: reject RELATIVE paths that escape the
  // project root via `..`. Absolute paths require deliberate intent and are
  // allowed (e.g., for tests using tmpdir, or monorepo data in a sibling
  // package). Consumers exposing frontmatter to untrusted user content
  // should validate `source` values themselves -- absolute paths in
  // frontmatter are unusual and worth flagging at the application layer.
  if (!isAbsolute(srcPath)) {
    const resolved = resolve(projectRoot, srcPath);
    const rel = relative(projectRoot, resolved);
    if (rel.startsWith("..")) {
      throw new GeoJSONLoadError(
        `feature_ref.source resolves outside the project root. ` +
          `Got: "${srcPath}" -> "${resolved}". ` +
          `Project root: ${projectRoot}. ` +
          `If this is intentional, use an absolute path.`,
        resolved,
      );
    }
  }

  const resolved = resolve(projectRoot, srcPath);

  // Canonicalize via realpath so symlinks share cache entries.
  // Falls back to the resolved path if realpath fails (e.g., file doesn't
  // exist yet -- the subsequent stat call will produce a clearer error).
  try {
    return await realpath(resolved);
  } catch {
    return resolved;
  }
}

/**
 * Load and parse a GeoJSON file at build time, with an mtime-aware cache.
 *
 * @param srcPath - Path to GeoJSON file (project-root-relative or absolute)
 * @returns Parsed FeatureCollection
 * @throws {GeoJSONLoadError} when the file is missing, malformed, or not a
 *   FeatureCollection
 *
 * @remarks
 * Reads via Node's `fs/promises`, parses via `JSON.parse`, validates that
 * the result is a `FeatureCollection`, and caches by absolute path. The
 * cache invalidates when the file's `mtimeMs` changes -- editing the file
 * during `astro dev` is picked up on the next call without a server restart.
 *
 * Path resolution: relative paths are resolved against `process.cwd()`,
 * matching the convention from `loadGlobalMapConfig`. Absolute paths are
 * used as-is.
 *
 * @example
 * ```typescript
 * const fc = await loadFeatureFile('./src/data/gowanus.geojson');
 * console.log(`Loaded ${fc.features.length} features`);
 * ```
 */
export async function loadFeatureFile(
  srcPath: string,
): Promise<FeatureCollection> {
  const absPath = await resolveSourcePath(srcPath);

  // In-flight dedupe: parallel calls for the same path share a single read.
  // Without this, parallel page builds can both miss the cache and double-parse
  // a 50MB file, OOMing the build worker.
  const pending = inFlight.get(absPath);
  if (pending) return pending;

  const promise = doLoadFeatureFile(absPath).finally(() => {
    inFlight.delete(absPath);
  });
  inFlight.set(absPath, promise);
  return promise;
}

async function doLoadFeatureFile(absPath: string): Promise<FeatureCollection> {
  let mtimeMs: number;
  let sizeBytes: number;
  try {
    const stats = await stat(absPath);
    mtimeMs = stats.mtimeMs;
    sizeBytes = stats.size;
  } catch (cause) {
    const isENOENT = cause instanceof Error && /ENOENT/.test(cause.message);
    const hint = isENOENT
      ? deploymentHint()
      : `Path resolved to: ${absPath}. ` +
        `Project root: ${process.cwd()}.`;
    throw new GeoJSONLoadError(
      `Cannot find GeoJSON file: ${absPath}. ${hint}`,
      absPath,
      [],
      { cause },
    );
  }

  // Enforce documented file-size budget BEFORE readFile to prevent OOM.
  if (sizeBytes > HARD_ERROR_BYTES) {
    throw new GeoJSONLoadError(
      `GeoJSON file ${absPath} is ${formatMB(sizeBytes)}MB, ` +
        `which exceeds the ${formatMB(HARD_ERROR_BYTES)}MB build-time limit. ` +
        `Pre-process to a smaller file or use a runtime tile/vector source ` +
        `(e.g., PMTiles, vector tiles).`,
      absPath,
    );
  }
  if (sizeBytes > SOFT_WARN_BYTES) {
    console.warn(
      `[maplibre-yaml] Large GeoJSON file: ${absPath} ` +
        `(${formatMB(sizeBytes)}MB). May slow build and spike memory; ` +
        `consider splitting or switching to a tile-based source.`,
    );
  }

  const cached = fileCache.get(absPath);
  if (cached && cached.mtimeMs === mtimeMs) {
    return cached.fc;
  }

  let content: string;
  try {
    content = await readFile(absPath, "utf-8");
  } catch (cause) {
    throw new GeoJSONLoadError(
      `Failed to read GeoJSON file at ${absPath}: ` +
        (cause instanceof Error ? cause.message : String(cause)),
      absPath,
      [],
      { cause },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (cause) {
    throw new GeoJSONLoadError(
      `GeoJSON file ${absPath} contains invalid JSON: ` +
        (cause instanceof Error ? cause.message : String(cause)),
      absPath,
      [],
      { cause },
    );
  }

  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    (parsed as { type?: unknown }).type !== "FeatureCollection" ||
    !Array.isArray((parsed as { features?: unknown }).features)
  ) {
    const actualType =
      parsed === null
        ? "null"
        : Array.isArray(parsed)
          ? "array"
          : typeof parsed === "object"
            ? String((parsed as { type?: unknown }).type ?? "(missing type)")
            : typeof parsed;
    throw new GeoJSONLoadError(
      `Expected GeoJSON FeatureCollection at ${absPath}, got ${actualType}. ` +
        `Top-level "type" must be "FeatureCollection" with a "features" array.`,
      absPath,
    );
  }

  const fc = parsed as FeatureCollection;

  fileCache.set(absPath, {
    mtimeMs,
    fc,
    indexByProperty: new Map(),
    propertyAccessCount: new Map(),
  });

  return fc;
}

function formatMB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

/**
 * Detects deployment contexts where build-time file resolution won't work
 * and dresses the ENOENT error with an actionable hint. Covers the
 * Vercel/Netlify/Lambda/Cloudflare cases where `process.cwd()` is defined
 * but doesn't contain the project's source files.
 *
 * @internal
 */
function deploymentHint(): string {
  const cwd = process.cwd();
  const looksServerless =
    cwd === "/var/task" ||
    cwd === "/var/runtime" ||
    cwd === "/tmp" ||
    process.env.VERCEL === "1" ||
    process.env.NETLIFY === "true" ||
    !!process.env.LAMBDA_TASK_ROOT ||
    !!process.env.AWS_LAMBDA_FUNCTION_NAME;

  if (looksServerless) {
    return (
      `This appears to be a deployed serverless context (cwd=${cwd}). ` +
      `buildFeatureMapConfig is build-time only. Resolve the feature ref at ` +
      `build time (e.g., via getStaticPaths or in your Astro frontmatter), ` +
      `then pass the resulting MapBlock to <Map config={...} />.`
    );
  }
  return (
    `Path is resolved from project root (cwd=${cwd}). ` +
    `Check that the file exists and the path is correct.`
  );
}

/**
 * Error thrown when GeoJSON file loading, validation, or feature lookup fails.
 *
 * @remarks
 * Modeled on `YAMLLoadError`. Failure modes covered:
 * - File not found
 * - File contains invalid JSON
 * - File is not a GeoJSON FeatureCollection
 * - No feature matches the lookup criteria
 * - Multiple features match the lookup criteria (V1 requires exactly one)
 * - Feature has an unsupported geometry type
 *
 * Forward-compatibility constraint #4: the constructor accepts an optional
 * ES2022 `cause` field via the `options` parameter. This keeps the future
 * shared-base-class introduction (`MaplibreYamlLoadError`) purely additive.
 *
 * @example Catch and inspect
 * ```typescript
 * try {
 *   const config = await buildFeatureMapConfig({ ref });
 * } catch (error) {
 *   if (error instanceof GeoJSONLoadError) {
 *     console.error('GeoJSON error:', error.message);
 *     console.error('File:', error.filePath);
 *     if (error.cause) console.error('Caused by:', error.cause);
 *   }
 * }
 * ```
 */
export class GeoJSONLoadError extends Error {
  /** Path to the GeoJSON file that failed (absolute when possible) */
  public filePath: string;

  /** Optional structured details about validation failures */
  public errors: { path: string; message: string }[];

  constructor(
    message: string,
    filePath: string,
    errors: { path: string; message: string }[] = [],
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = "GeoJSONLoadError";
    this.filePath = filePath;
    this.errors = errors;
    if (options?.cause !== undefined) {
      // ES2022 Error.cause; setting via property assignment to be compatible
      // with both modern Node and any consumer that polyfills Error.
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

/**
 * Find a single feature in a FeatureCollection matching a FeatureRef.
 *
 * @param fc - Already-parsed GeoJSON FeatureCollection
 * @param ref - Feature reference (must contain `featureId` OR `match`)
 * @param sourceLabel - Path or label describing the source, included in errors
 * @returns The single matching feature
 * @throws {GeoJSONLoadError} when zero features match or more than one matches
 *
 * @remarks
 * Pure function -- no filesystem, no caching, no async. Operates entirely
 * on in-memory data.
 *
 * Match semantics:
 * - `featureId`: exact equality against `feature.id` (top-level GeoJSON id).
 *   No type coercion: `42` does not match `"42"`.
 * - `match: { property, equals }`: exact equality against
 *   `feature.properties[property]`. Features with `properties: null` or
 *   missing properties are skipped without error.
 *
 * V1 requires exactly one match. Multi-match is a deferred V2 feature; for
 * now it produces an actionable error suggesting narrower criteria.
 *
 * @example Match by id
 * ```typescript
 * const feature = findFeature(fc, { source: "x.geojson", featureId: "poa-1.1" });
 * ```
 *
 * @example Match by property
 * ```typescript
 * const feature = findFeature(fc, {
 *   source: "x.geojson",
 *   match: { property: "gotf_id", equals: 1.1 },
 * });
 * ```
 */
export function findFeature(
  fc: FeatureCollection,
  ref: FeatureRef,
  sourceLabel: string = ref.source,
): Feature {
  if (!fc || fc.type !== "FeatureCollection" || !Array.isArray(fc.features)) {
    throw new GeoJSONLoadError(
      `Expected a GeoJSON FeatureCollection in ${sourceLabel}, got ${typeof fc === "object" && fc !== null ? (fc as { type?: unknown }).type ?? "unknown" : typeof fc}`,
      sourceLabel,
    );
  }

  const matches = ref.featureId !== undefined
    ? matchById(fc, ref.featureId)
    : ref.match !== undefined
      ? matchByProperty(fc, ref.match.property, ref.match.equals, sourceLabel)
      : [];

  if (matches.length === 0) {
    throw notFoundError(fc, ref, sourceLabel);
  }

  if (matches.length > 1) {
    throw multiMatchError(matches, ref, sourceLabel);
  }

  return matches[0]!;
}

function matchById(
  fc: FeatureCollection,
  featureId: string | number,
): Feature[] {
  return fc.features.filter((f) => f.id === featureId);
}

/**
 * Match by property equality. Uses the lazy per-property index from the
 * cache entry when available; otherwise builds the index on the second
 * access for that property. Skipped entirely below INDEX_THRESHOLD.
 *
 * The cache lookup uses `sourceLabel` as the absolute path. `findFeature`
 * accepts a sourceLabel that may be a relative path (when called directly
 * with synthetic input), so the cache lookup may be a miss; that's fine --
 * we just fall back to linear scan.
 *
 * @internal
 */
function matchByProperty(
  fc: FeatureCollection,
  property: string,
  equals: string | number | boolean,
  _sourceLabel: string,
): Feature[] {
  // Below threshold: always linear-scan, do not maintain index
  if (fc.features.length < INDEX_THRESHOLD) {
    return linearScanByProperty(fc, property, equals);
  }

  // The cache is keyed by canonicalized realpath, but this sync function
  // can't await `realpath`. Instead, find the cache entry whose `fc` matches
  // by reference. Cache typically holds 1-3 entries so this is cheap, and
  // it's robust against any path-canonicalization differences.
  let entry: CacheEntry | undefined;
  for (const e of fileCache.values()) {
    if (e.fc === fc) {
      entry = e;
      break;
    }
  }
  if (!entry) {
    // Synthetic input that didn't come from `loadFeatureFile`: linear scan
    return linearScanByProperty(fc, property, equals);
  }

  const accessCount = (entry.propertyAccessCount.get(property) ?? 0) + 1;
  entry.propertyAccessCount.set(property, accessCount);

  // First access: linear scan, do not build index yet
  if (accessCount === 1) {
    return linearScanByProperty(fc, property, equals);
  }

  // Second+ access: build the index lazily on the first second-access,
  // then use it on this and all subsequent calls
  if (!entry.indexByProperty.has(property)) {
    entry.indexByProperty.set(property, buildPropertyIndex(fc, property));
  }

  const index = entry.indexByProperty.get(property)!;
  return index.get(equals) ?? [];
}

function linearScanByProperty(
  fc: FeatureCollection,
  property: string,
  equals: string | number | boolean,
): Feature[] {
  return fc.features.filter((f) => {
    if (f.properties === null || f.properties === undefined) return false;
    return (f.properties as Record<string, unknown>)[property] === equals;
  });
}

function buildPropertyIndex(
  fc: FeatureCollection,
  property: string,
): Map<unknown, Feature[]> {
  const index = new Map<unknown, Feature[]>();
  for (const f of fc.features) {
    if (f.properties === null || f.properties === undefined) continue;
    const value = (f.properties as Record<string, unknown>)[property];
    if (value === undefined) continue;
    const existing = index.get(value);
    if (existing) {
      existing.push(f);
    } else {
      index.set(value, [f]);
    }
  }
  return index;
}

function notFoundError(
  fc: FeatureCollection,
  ref: FeatureRef,
  sourceLabel: string,
): GeoJSONLoadError {
  const total = fc.features.length;

  if (ref.featureId !== undefined) {
    const sampleIds = fc.features
      .slice(0, 3)
      .map((f) => (f.id !== undefined ? JSON.stringify(f.id) : "(no id)"))
      .join(", ");
    return new GeoJSONLoadError(
      `No feature with id ${JSON.stringify(ref.featureId)} found in ${sourceLabel}. ` +
        `File contains ${total} feature${total === 1 ? "" : "s"}. ` +
        `Sample ids: ${sampleIds || "(none with ids)"}.`,
      sourceLabel,
    );
  }

  // match-by-property
  const property = ref.match!.property;
  const equals = ref.match!.equals;
  const sampleValues = fc.features
    .slice(0, 3)
    .map((f) => {
      const props = f.properties as Record<string, unknown> | null | undefined;
      const val = props?.[property];
      return val === undefined ? "(missing)" : JSON.stringify(val);
    })
    .join(", ");
  return new GeoJSONLoadError(
    `No feature where ${property} === ${JSON.stringify(equals)} in ${sourceLabel}. ` +
      `${total} feature${total === 1 ? "" : "s"} checked. ` +
      `Sample values for "${property}": ${sampleValues}.`,
    sourceLabel,
  );
}

function multiMatchError(
  matches: Feature[],
  ref: FeatureRef,
  sourceLabel: string,
): GeoJSONLoadError {
  const sample = matches
    .slice(0, 3)
    .map((f) => {
      if (ref.featureId !== undefined) {
        return f.id !== undefined ? JSON.stringify(f.id) : "(no id)";
      }
      const property = ref.match!.property;
      const props = f.properties as Record<string, unknown> | null | undefined;
      const val = props?.[property];
      return val === undefined ? "(missing)" : JSON.stringify(val);
    })
    .join(", ");

  const criterion = ref.featureId !== undefined
    ? `featureId ${JSON.stringify(ref.featureId)}`
    : `${ref.match!.property} === ${JSON.stringify(ref.match!.equals)}`;

  return new GeoJSONLoadError(
    `Match for ${criterion} returned ${matches.length} features in ${sourceLabel}. ` +
      `V1 requires exactly one match. Sample matches: ${sample}. ` +
      `Use a more specific match criterion (e.g., a unique property).`,
    sourceLabel,
  );
}
