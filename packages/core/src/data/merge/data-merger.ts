import type { FeatureCollection, Feature } from "geojson";

/**
 * Strategy for merging data.
 */
export type MergeStrategy = "replace" | "merge" | "append-window";

/**
 * Options for merging data.
 *
 * @example
 * ```typescript
 * // Replace strategy
 * const replaceOptions: MergeOptions = {
 *   strategy: 'replace'
 * };
 *
 * // Merge strategy with update key
 * const mergeOptions: MergeOptions = {
 *   strategy: 'merge',
 *   updateKey: 'id'
 * };
 *
 * // Append-window with size and time limits
 * const windowOptions: MergeOptions = {
 *   strategy: 'append-window',
 *   windowSize: 100,
 *   windowDuration: 3600000,  // 1 hour
 *   timestampField: 'timestamp'
 * };
 * ```
 */
export interface MergeOptions {
  /** Merge strategy to use */
  strategy: MergeStrategy;

  /** Property key used to identify features for merge strategy */
  updateKey?: string;

  /** Maximum number of features to keep (append-window) */
  windowSize?: number;

  /** Maximum age of features in milliseconds (append-window) */
  windowDuration?: number;

  /** Property field containing timestamp (append-window) */
  timestampField?: string;
}

/**
 * Result of a merge operation.
 */
export interface MergeResult {
  /** Merged feature collection */
  data: FeatureCollection;

  /** Number of features added */
  added: number;

  /** Number of features updated */
  updated: number;

  /** Number of features removed */
  removed: number;

  /** Total number of features in result */
  total: number;
}

/**
 * Merges GeoJSON FeatureCollections using configurable strategies.
 *
 * @remarks
 * Supports three merge strategies:
 *
 * **replace**: Complete replacement of existing data
 * - Replaces all existing features with incoming features
 * - Simple and efficient for full updates
 *
 * **merge**: Update by key, keep unmatched
 * - Updates existing features by matching on a key property
 * - Adds new features that don't match existing keys
 * - Preserves existing features not in the update
 * - Requires `updateKey` option
 *
 * **append-window**: Add with time/size limits
 * - Appends incoming features to existing features
 * - Applies size limit (keeps most recent N features)
 * - Applies time limit (removes features older than duration)
 * - Requires `timestampField` for time-based filtering
 *
 * @example
 * ```typescript
 * const merger = new DataMerger();
 *
 * // Replace all data
 * const result = merger.merge(existing, incoming, {
 *   strategy: 'replace'
 * });
 *
 * // Merge by vehicle ID
 * const result = merger.merge(existing, incoming, {
 *   strategy: 'merge',
 *   updateKey: 'vehicleId'
 * });
 *
 * // Append with 100 feature limit and 1 hour window
 * const result = merger.merge(existing, incoming, {
 *   strategy: 'append-window',
 *   windowSize: 100,
 *   windowDuration: 3600000,
 *   timestampField: 'timestamp'
 * });
 * ```
 */
export class DataMerger {
  /**
   * Merge two FeatureCollections using the specified strategy.
   *
   * @param existing - Existing feature collection
   * @param incoming - Incoming feature collection to merge
   * @param options - Merge options including strategy
   * @returns Merge result with statistics
   * @throws {Error} If merge strategy requires missing options
   *
   * @example
   * ```typescript
   * const merger = new DataMerger();
   *
   * const result = merger.merge(existingData, newData, {
   *   strategy: 'merge',
   *   updateKey: 'id'
   * });
   *
   * console.log(`Added: ${result.added}, Updated: ${result.updated}`);
   * console.log(`Total features: ${result.total}`);
   * ```
   */
  merge(
    existing: FeatureCollection,
    incoming: FeatureCollection,
    options: MergeOptions
  ): MergeResult {
    switch (options.strategy) {
      case "replace":
        return this.mergeReplace(existing, incoming);
      case "merge":
        return this.mergeMerge(existing, incoming, options);
      case "append-window":
        return this.mergeAppendWindow(existing, incoming, options);
      default:
        throw new Error(
          `Unknown merge strategy: ${options.strategy as string}`
        );
    }
  }

  /**
   * Replace strategy: Complete replacement of existing data.
   */
  private mergeReplace(
    existing: FeatureCollection,
    incoming: FeatureCollection
  ): MergeResult {
    return {
      data: incoming,
      added: incoming.features.length,
      updated: 0,
      removed: existing.features.length,
      total: incoming.features.length,
    };
  }

  /**
   * Merge strategy: Update by key, keep unmatched features.
   */
  private mergeMerge(
    existing: FeatureCollection,
    incoming: FeatureCollection,
    options: MergeOptions
  ): MergeResult {
    if (!options.updateKey) {
      throw new Error("updateKey is required for merge strategy");
    }

    const updateKey = options.updateKey;
    let added = 0;
    let updated = 0;

    // Create a map of existing features by their key
    const existingMap = new Map<unknown, Feature>();
    for (const feature of existing.features) {
      const key = feature.properties?.[updateKey];
      if (key !== undefined && key !== null) {
        existingMap.set(key, feature);
      }
    }

    // Process incoming features
    for (const feature of incoming.features) {
      const key = feature.properties?.[updateKey];
      if (key !== undefined && key !== null) {
        if (existingMap.has(key)) {
          updated++;
        } else {
          added++;
        }
        existingMap.set(key, feature);
      }
    }

    // Convert map back to features array
    const features = Array.from(existingMap.values());

    return {
      data: {
        type: "FeatureCollection",
        features,
      },
      added,
      updated,
      removed: 0,
      total: features.length,
    };
  }

  /**
   * Append-window strategy: Add with time/size limits.
   */
  private mergeAppendWindow(
    existing: FeatureCollection,
    incoming: FeatureCollection,
    options: MergeOptions
  ): MergeResult {
    const initialCount = existing.features.length;

    // Combine existing and incoming features
    let features = [...existing.features, ...incoming.features];

    // Apply time window if configured
    if (options.windowDuration && options.timestampField) {
      const cutoffTime = Date.now() - options.windowDuration;

      features = features.filter((feature) => {
        const timestamp = feature.properties?.[options.timestampField!];
        if (typeof timestamp === "number") {
          return timestamp >= cutoffTime;
        }
        // Keep features without timestamp (safer than removing)
        return true;
      });

      // Sort by timestamp descending (most recent first)
      features.sort((a, b) => {
        const timeA = a.properties?.[options.timestampField!] ?? 0;
        const timeB = b.properties?.[options.timestampField!] ?? 0;
        return (timeB as number) - (timeA as number);
      });

      // Apply size window if configured
      if (options.windowSize && features.length > options.windowSize) {
        features = features.slice(0, options.windowSize);
      }

      const removed = initialCount + incoming.features.length - features.length;

      return {
        data: {
          type: "FeatureCollection",
          features,
        },
        added: incoming.features.length,
        updated: 0,
        removed,
        total: features.length,
      };
    }

    // Apply size window only if no time window
    if (options.windowSize) {
      // For size-only window, keep most recent features
      // If timestampField is provided, sort by it; otherwise keep insertion order
      if (options.timestampField) {
        features.sort((a, b) => {
          const timeA = a.properties?.[options.timestampField!] ?? 0;
          const timeB = b.properties?.[options.timestampField!] ?? 0;
          return (timeB as number) - (timeA as number);
        });
      }

      if (features.length > options.windowSize) {
        features = features.slice(0, options.windowSize);
      }
    }

    const removed = initialCount + incoming.features.length - features.length;

    return {
      data: {
        type: "FeatureCollection",
        features,
      },
      added: incoming.features.length,
      updated: 0,
      removed,
      total: features.length,
    };
  }
}
