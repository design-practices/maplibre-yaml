import { describe, it, expect, beforeEach } from "vitest";
import { DataMerger } from "../../../src/data/merge/data-merger";
import type { MergeOptions } from "../../../src/data/merge/data-merger";
import type { FeatureCollection } from "geojson";

describe("DataMerger", () => {
  let merger: DataMerger;

  beforeEach(() => {
    merger = new DataMerger();
  });

  describe("constructor", () => {
    it("creates a new DataMerger", () => {
      expect(merger).toBeInstanceOf(DataMerger);
    });
  });

  describe("merge - replace strategy", () => {
    it("replaces all existing features with incoming features", () => {
      const existing: FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [0, 0] },
            properties: { id: 1, name: "Old 1" },
          },
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [1, 1] },
            properties: { id: 2, name: "Old 2" },
          },
        ],
      };

      const incoming: FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [2, 2] },
            properties: { id: 3, name: "New 1" },
          },
        ],
      };

      const options: MergeOptions = {
        strategy: "replace",
      };

      const result = merger.merge(existing, incoming, options);

      expect(result.data.features).toHaveLength(1);
      expect(result.data.features![0]!.properties?.name).toBe("New 1");
      expect(result.added).toBe(1);
      expect(result.updated).toBe(0);
      expect(result.removed).toBe(2);
      expect(result.total).toBe(1);
    });

    it("handles empty incoming data", () => {
      const existing: FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [0, 0] },
            properties: { id: 1 },
          },
        ],
      };

      const incoming: FeatureCollection = {
        type: "FeatureCollection",
        features: [],
      };

      const result = merger.merge(existing, incoming, { strategy: "replace" });

      expect(result.data.features).toHaveLength(0);
      expect(result.added).toBe(0);
      expect(result.removed).toBe(1);
      expect(result.total).toBe(0);
    });

    it("handles empty existing data", () => {
      const existing: FeatureCollection = {
        type: "FeatureCollection",
        features: [],
      };

      const incoming: FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [0, 0] },
            properties: { id: 1 },
          },
        ],
      };

      const result = merger.merge(existing, incoming, { strategy: "replace" });

      expect(result.data.features).toHaveLength(1);
      expect(result.added).toBe(1);
      expect(result.removed).toBe(0);
      expect(result.total).toBe(1);
    });
  });

  describe("merge - merge strategy", () => {
    it("updates existing features by key", () => {
      const existing: FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [0, 0] },
            properties: { id: 1, name: "Old Name" },
          },
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [1, 1] },
            properties: { id: 2, name: "Unchanged" },
          },
        ],
      };

      const incoming: FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [0, 0] },
            properties: { id: 1, name: "Updated Name" },
          },
        ],
      };

      const options: MergeOptions = {
        strategy: "merge",
        updateKey: "id",
      };

      const result = merger.merge(existing, incoming, options);

      expect(result.data.features).toHaveLength(2);
      expect(result.added).toBe(0);
      expect(result.updated).toBe(1);
      expect(result.removed).toBe(0);
      expect(result.total).toBe(2);

      const updatedFeature = result.data.features.find(
        (f) => f.properties?.id === 1
      );
      expect(updatedFeature?.properties?.name).toBe("Updated Name");
    });

    it("adds new features", () => {
      const existing: FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [0, 0] },
            properties: { id: 1, name: "Existing" },
          },
        ],
      };

      const incoming: FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [1, 1] },
            properties: { id: 2, name: "New" },
          },
        ],
      };

      const options: MergeOptions = {
        strategy: "merge",
        updateKey: "id",
      };

      const result = merger.merge(existing, incoming, options);

      expect(result.data.features).toHaveLength(2);
      expect(result.added).toBe(1);
      expect(result.updated).toBe(0);
      expect(result.removed).toBe(0);
      expect(result.total).toBe(2);
    });

    it("combines updates and additions", () => {
      const existing: FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [0, 0] },
            properties: { id: 1, name: "Old" },
          },
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [1, 1] },
            properties: { id: 2, name: "Unchanged" },
          },
        ],
      };

      const incoming: FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [0, 0] },
            properties: { id: 1, name: "Updated" },
          },
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [2, 2] },
            properties: { id: 3, name: "New" },
          },
        ],
      };

      const options: MergeOptions = {
        strategy: "merge",
        updateKey: "id",
      };

      const result = merger.merge(existing, incoming, options);

      expect(result.data.features).toHaveLength(3);
      expect(result.added).toBe(1);
      expect(result.updated).toBe(1);
      expect(result.removed).toBe(0);
      expect(result.total).toBe(3);
    });

    it("preserves features not in update", () => {
      const existing: FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [0, 0] },
            properties: { id: 1, name: "Keep" },
          },
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [1, 1] },
            properties: { id: 2, name: "Also Keep" },
          },
        ],
      };

      const incoming: FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [2, 2] },
            properties: { id: 3, name: "New" },
          },
        ],
      };

      const options: MergeOptions = {
        strategy: "merge",
        updateKey: "id",
      };

      const result = merger.merge(existing, incoming, options);

      expect(result.data.features).toHaveLength(3);
      expect(result.data.features.map((f) => f.properties?.id).sort()).toEqual([
        1, 2, 3,
      ]);
    });

    it("throws error when updateKey is missing", () => {
      const existing: FeatureCollection = {
        type: "FeatureCollection",
        features: [],
      };

      const incoming: FeatureCollection = {
        type: "FeatureCollection",
        features: [],
      };

      const options: MergeOptions = {
        strategy: "merge",
      };

      expect(() => merger.merge(existing, incoming, options)).toThrow(
        "updateKey is required for merge strategy"
      );
    });

    it("handles features without the update key", () => {
      const existing: FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [0, 0] },
            properties: { id: 1, name: "Has Key" },
          },
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [1, 1] },
            properties: { name: "No Key" },
          },
        ],
      };

      const incoming: FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [0, 0] },
            properties: { id: 1, name: "Updated" },
          },
        ],
      };

      const options: MergeOptions = {
        strategy: "merge",
        updateKey: "id",
      };

      const result = merger.merge(existing, incoming, options);

      // Feature without key is not included in result
      expect(result.data.features).toHaveLength(1);
      expect(result.updated).toBe(1);
    });

    it("handles null and undefined values for update key", () => {
      const existing: FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [0, 0] },
            properties: { id: null, name: "Null Key" },
          },
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [1, 1] },
            properties: { id: undefined, name: "Undefined Key" },
          },
        ],
      };

      const incoming: FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [2, 2] },
            properties: { id: 1, name: "Valid" },
          },
        ],
      };

      const options: MergeOptions = {
        strategy: "merge",
        updateKey: "id",
      };

      const result = merger.merge(existing, incoming, options);

      expect(result.data.features).toHaveLength(1);
      expect(result.data.features![0]!.properties?.name).toBe("Valid");
    });
  });

  describe("merge - append-window strategy", () => {
    it("applies size window", () => {
      const existing: FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [0, 0] },
            properties: { id: 1, timestamp: 1000 },
          },
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [1, 1] },
            properties: { id: 2, timestamp: 2000 },
          },
        ],
      };

      const incoming: FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [2, 2] },
            properties: { id: 3, timestamp: 3000 },
          },
        ],
      };

      const options: MergeOptions = {
        strategy: "append-window",
        windowSize: 2,
        timestampField: "timestamp",
      };

      const result = merger.merge(existing, incoming, options);

      expect(result.data.features).toHaveLength(2);
      expect(result.added).toBe(1);
      expect(result.removed).toBe(1);
      expect(result.total).toBe(2);

      // Should keep most recent 2
      expect(result.data.features![0]!.properties?.id).toBe(3);
      expect(result.data.features![1]!.properties?.id).toBe(2);
    });

    it("applies time window", () => {
      const now = Date.now();
      const oneHourAgo = now - 3600000;
      const twoHoursAgo = now - 7200000;

      const existing: FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [0, 0] },
            properties: { id: 1, timestamp: twoHoursAgo },
          },
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [1, 1] },
            properties: { id: 2, timestamp: oneHourAgo },
          },
        ],
      };

      const incoming: FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [2, 2] },
            properties: { id: 3, timestamp: now },
          },
        ],
      };

      const options: MergeOptions = {
        strategy: "append-window",
        windowDuration: 5400000, // 1.5 hours
        timestampField: "timestamp",
      };

      const result = merger.merge(existing, incoming, options);

      // Should keep features within 1.5 hours
      expect(result.data.features).toHaveLength(2);
      expect(result.data.features.map((f) => f.properties?.id).sort()).toEqual([
        2, 3,
      ]);
    });

    it("applies both size and time windows", () => {
      const now = Date.now();
      const recent1 = now - 1000;
      const recent2 = now - 2000;
      const recent3 = now - 3000;
      const old = now - 10000000;

      const existing: FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [0, 0] },
            properties: { id: 1, timestamp: old },
          },
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [1, 1] },
            properties: { id: 2, timestamp: recent3 },
          },
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [2, 2] },
            properties: { id: 3, timestamp: recent2 },
          },
        ],
      };

      const incoming: FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [3, 3] },
            properties: { id: 4, timestamp: recent1 },
          },
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [4, 4] },
            properties: { id: 5, timestamp: now },
          },
        ],
      };

      const options: MergeOptions = {
        strategy: "append-window",
        windowSize: 3,
        windowDuration: 3600000, // 1 hour
        timestampField: "timestamp",
      };

      const result = merger.merge(existing, incoming, options);

      // Should filter by time first (removes old), then by size (keeps 3 most recent)
      expect(result.data.features).toHaveLength(3);
      expect(result.data.features![0]!.properties?.id).toBe(5); // Most recent
      expect(result.data.features![1]!.properties?.id).toBe(4);
      expect(result.data.features![2]!.properties?.id).toBe(3);
    });

    it("keeps features without timestamp when filtering by time", () => {
      const now = Date.now();
      const old = now - 10000000;

      const existing: FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [0, 0] },
            properties: { id: 1, timestamp: old },
          },
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [1, 1] },
            properties: { id: 2 }, // No timestamp
          },
        ],
      };

      const incoming: FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [2, 2] },
            properties: { id: 3, timestamp: now },
          },
        ],
      };

      const options: MergeOptions = {
        strategy: "append-window",
        windowDuration: 3600000,
        timestampField: "timestamp",
      };

      const result = merger.merge(existing, incoming, options);

      // Should keep feature without timestamp and recent feature
      expect(result.data.features).toHaveLength(2);
      const ids = result.data.features.map((f) => f.properties?.id).sort();
      expect(ids).toContain(2); // No timestamp kept
      expect(ids).toContain(3); // Recent kept
    });

    it("applies size window without timestamp field", () => {
      const existing: FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [0, 0] },
            properties: { id: 1 },
          },
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [1, 1] },
            properties: { id: 2 },
          },
        ],
      };

      const incoming: FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [2, 2] },
            properties: { id: 3 },
          },
        ],
      };

      const options: MergeOptions = {
        strategy: "append-window",
        windowSize: 2,
      };

      const result = merger.merge(existing, incoming, options);

      expect(result.data.features).toHaveLength(2);
      expect(result.added).toBe(1);
      expect(result.removed).toBe(1);
      expect(result.total).toBe(2);
    });

    it("sorts by timestamp when applying size window", () => {
      const existing: FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [0, 0] },
            properties: { id: 1, timestamp: 1000 },
          },
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [1, 1] },
            properties: { id: 2, timestamp: 3000 },
          },
        ],
      };

      const incoming: FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [2, 2] },
            properties: { id: 3, timestamp: 2000 },
          },
        ],
      };

      const options: MergeOptions = {
        strategy: "append-window",
        windowSize: 2,
        timestampField: "timestamp",
      };

      const result = merger.merge(existing, incoming, options);

      expect(result.data.features).toHaveLength(2);
      // Should keep 2 most recent (id 2 and 3)
      expect(result.data.features![0]!.properties?.id).toBe(2); // timestamp 3000
      expect(result.data.features![1]!.properties?.id).toBe(3); // timestamp 2000
    });

    it("handles empty existing data", () => {
      const existing: FeatureCollection = {
        type: "FeatureCollection",
        features: [],
      };

      const incoming: FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [0, 0] },
            properties: { id: 1, timestamp: Date.now() },
          },
        ],
      };

      const options: MergeOptions = {
        strategy: "append-window",
        windowSize: 10,
        timestampField: "timestamp",
      };

      const result = merger.merge(existing, incoming, options);

      expect(result.data.features).toHaveLength(1);
      expect(result.added).toBe(1);
      expect(result.removed).toBe(0);
    });
  });

  describe("error handling", () => {
    it("throws error for unknown strategy", () => {
      const existing: FeatureCollection = {
        type: "FeatureCollection",
        features: [],
      };

      const incoming: FeatureCollection = {
        type: "FeatureCollection",
        features: [],
      };

      const options = {
        strategy: "unknown" as any,
      };

      expect(() => merger.merge(existing, incoming, options)).toThrow(
        "Unknown merge strategy: unknown"
      );
    });
  });
});
