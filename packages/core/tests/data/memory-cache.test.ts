import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryCache, type CacheEntry } from "../../src/data/memory-cache";

describe("MemoryCache", () => {
  let cache: MemoryCache<string>;

  beforeEach(() => {
    cache = new MemoryCache<string>({
      maxSize: 3,
      defaultTTL: 1000,
    });
  });

  describe("set() and get()", () => {
    it("stores and retrieves entries", () => {
      const entry: CacheEntry<string> = {
        data: "test data",
        timestamp: Date.now(),
      };

      cache.set("key1", entry);
      const retrieved = cache.get("key1");

      expect(retrieved).toBeTruthy();
      expect(retrieved?.data).toBe("test data");
    });

    it("returns null for missing entries", () => {
      const result = cache.get("nonexistent");
      expect(result).toBeNull();
    });

    it("returns null for expired entries", () => {
      const entry: CacheEntry<string> = {
        data: "test data",
        timestamp: Date.now() - 2000, // 2 seconds ago
        ttl: 1000, // 1 second TTL
      };

      cache.set("key1", entry);
      const result = cache.get("key1");

      expect(result).toBeNull();
    });

    it("respects per-entry TTL", () => {
      const shortTTL: CacheEntry<string> = {
        data: "short",
        timestamp: Date.now() - 600, // 600ms ago
        ttl: 500, // 500ms TTL - expired
      };

      const longTTL: CacheEntry<string> = {
        data: "long",
        timestamp: Date.now() - 600, // 600ms ago
        ttl: 1000, // 1000ms TTL - still valid
      };

      cache.set("short", shortTTL);
      cache.set("long", longTTL);

      expect(cache.get("short")).toBeNull();
      expect(cache.get("long")).toBeTruthy();
    });

    it("uses default TTL when not specified", () => {
      const entry: CacheEntry<string> = {
        data: "test",
        timestamp: Date.now() - 500, // 500ms ago
        // No TTL specified, should use default 1000ms
      };

      cache.set("key1", entry);
      expect(cache.get("key1")).toBeTruthy();
    });

    it("removes expired entry on get", () => {
      const entry: CacheEntry<string> = {
        data: "test",
        timestamp: Date.now() - 2000,
      };

      cache.set("key1", entry);
      cache.get("key1"); // Should remove expired entry

      expect(cache.has("key1")).toBe(false);
    });
  });

  describe("LRU eviction", () => {
    it("evicts oldest entry when at capacity", () => {
      const now = Date.now();

      cache.set("key1", { data: "data1", timestamp: now });
      cache.set("key2", { data: "data2", timestamp: now });
      cache.set("key3", { data: "data3", timestamp: now });

      // Cache is now full (maxSize: 3)
      // Adding key4 should evict key1
      cache.set("key4", { data: "data4", timestamp: now });

      expect(cache.has("key1")).toBe(false);
      expect(cache.has("key2")).toBe(true);
      expect(cache.has("key3")).toBe(true);
      expect(cache.has("key4")).toBe(true);
    });

    it("updates access order on get", () => {
      const now = Date.now();

      cache.set("key1", { data: "data1", timestamp: now });
      cache.set("key2", { data: "data2", timestamp: now });
      cache.set("key3", { data: "data3", timestamp: now });

      // Access key1, making it most recently used
      cache.get("key1");

      // Add key4, should evict key2 (oldest)
      cache.set("key4", { data: "data4", timestamp: now });

      expect(cache.has("key1")).toBe(true);
      expect(cache.has("key2")).toBe(false);
      expect(cache.has("key3")).toBe(true);
      expect(cache.has("key4")).toBe(true);
    });

    it("does not evict when updating existing key", () => {
      const now = Date.now();

      cache.set("key1", { data: "data1", timestamp: now });
      cache.set("key2", { data: "data2", timestamp: now });
      cache.set("key3", { data: "data3", timestamp: now });

      // Update key2 - should not evict anything
      cache.set("key2", { data: "updated", timestamp: now });

      expect(cache.has("key1")).toBe(true);
      expect(cache.has("key2")).toBe(true);
      expect(cache.has("key3")).toBe(true);
      expect(cache.get("key2")?.data).toBe("updated");
    });
  });

  describe("has()", () => {
    it("returns true for existing keys", () => {
      cache.set("key1", { data: "test", timestamp: Date.now() });
      expect(cache.has("key1")).toBe(true);
    });

    it("returns false for missing keys", () => {
      expect(cache.has("nonexistent")).toBe(false);
    });

    it("returns true even for expired keys", () => {
      cache.set("key1", { data: "test", timestamp: Date.now() - 2000 });
      expect(cache.has("key1")).toBe(true);
      // Note: has() doesn't check expiration, only get() does
    });
  });

  describe("delete()", () => {
    it("removes entry", () => {
      cache.set("key1", { data: "test", timestamp: Date.now() });
      expect(cache.has("key1")).toBe(true);

      const deleted = cache.delete("key1");
      expect(deleted).toBe(true);
      expect(cache.has("key1")).toBe(false);
    });

    it("returns false when deleting nonexistent key", () => {
      const deleted = cache.delete("nonexistent");
      expect(deleted).toBe(false);
    });
  });

  describe("clear()", () => {
    it("removes all entries", () => {
      const now = Date.now();
      cache.set("key1", { data: "data1", timestamp: now });
      cache.set("key2", { data: "data2", timestamp: now });
      cache.set("key3", { data: "data3", timestamp: now });

      cache.clear();

      expect(cache.has("key1")).toBe(false);
      expect(cache.has("key2")).toBe(false);
      expect(cache.has("key3")).toBe(false);
    });

    it("resets statistics", () => {
      const now = Date.now();
      cache.set("key1", { data: "data1", timestamp: now });
      cache.get("key1"); // Hit
      cache.get("key2"); // Miss

      cache.clear();

      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.size).toBe(0);
    });
  });

  describe("prune()", () => {
    it("removes expired entries", () => {
      const now = Date.now();

      cache.set("fresh", { data: "fresh", timestamp: now, ttl: 2000 });
      cache.set("expired1", { data: "old1", timestamp: now - 1500, ttl: 1000 });
      cache.set("expired2", { data: "old2", timestamp: now - 1500, ttl: 1000 });

      const removed = cache.prune();

      expect(removed).toBe(2);
      expect(cache.has("fresh")).toBe(true);
      expect(cache.has("expired1")).toBe(false);
      expect(cache.has("expired2")).toBe(false);
    });

    it("returns 0 when no entries expired", () => {
      const now = Date.now();
      cache.set("key1", { data: "data1", timestamp: now });

      const removed = cache.prune();
      expect(removed).toBe(0);
    });
  });

  describe("getStats()", () => {
    it("tracks cache hits", () => {
      const now = Date.now();
      cache.set("key1", { data: "data1", timestamp: now });

      cache.get("key1");
      cache.get("key1");

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
    });

    it("tracks cache misses", () => {
      cache.get("nonexistent");
      cache.get("missing");

      const stats = cache.getStats();
      expect(stats.misses).toBe(2);
    });

    it("calculates hit rate correctly", () => {
      const now = Date.now();
      cache.set("key1", { data: "data1", timestamp: now });

      cache.get("key1"); // Hit
      cache.get("key1"); // Hit
      cache.get("missing"); // Miss

      const stats = cache.getStats();
      expect(stats.hitRate).toBeCloseTo(66.67, 1);
    });

    it("returns 0 hit rate when no requests", () => {
      const stats = cache.getStats();
      expect(stats.hitRate).toBe(0);
    });

    it("includes current cache size", () => {
      const now = Date.now();
      cache.set("key1", { data: "data1", timestamp: now });
      cache.set("key2", { data: "data2", timestamp: now });

      const stats = cache.getStats();
      expect(stats.size).toBe(2);
    });
  });

  describe("getConditionalHeaders()", () => {
    it("returns ETag header when available", () => {
      cache.set("key1", {
        data: "test",
        timestamp: Date.now(),
        etag: '"abc123"',
      });

      const headers = cache.getConditionalHeaders("key1");
      expect(headers["If-None-Match"]).toBe('"abc123"');
    });

    it("returns Last-Modified header when available", () => {
      cache.set("key1", {
        data: "test",
        timestamp: Date.now(),
        lastModified: "Wed, 21 Oct 2015 07:28:00 GMT",
      });

      const headers = cache.getConditionalHeaders("key1");
      expect(headers["If-Modified-Since"]).toBe(
        "Wed, 21 Oct 2015 07:28:00 GMT"
      );
    });

    it("returns both headers when available", () => {
      cache.set("key1", {
        data: "test",
        timestamp: Date.now(),
        etag: '"abc123"',
        lastModified: "Wed, 21 Oct 2015 07:28:00 GMT",
      });

      const headers = cache.getConditionalHeaders("key1");
      expect(headers["If-None-Match"]).toBe('"abc123"');
      expect(headers["If-Modified-Since"]).toBe(
        "Wed, 21 Oct 2015 07:28:00 GMT"
      );
    });

    it("returns empty object for missing entry", () => {
      const headers = cache.getConditionalHeaders("nonexistent");
      expect(headers).toEqual({});
    });

    it("returns empty object for expired entry", () => {
      cache.set("key1", {
        data: "test",
        timestamp: Date.now() - 2000,
        etag: '"abc123"',
      });

      const headers = cache.getConditionalHeaders("key1");
      expect(headers).toEqual({});
    });

    it("returns empty object when useConditionalRequests is false", () => {
      const cacheNoCondition = new MemoryCache<string>({
        useConditionalRequests: false,
      });

      cacheNoCondition.set("key1", {
        data: "test",
        timestamp: Date.now(),
        etag: '"abc123"',
      });

      const headers = cacheNoCondition.getConditionalHeaders("key1");
      expect(headers).toEqual({});
    });
  });

  describe("touch()", () => {
    it("updates access order without modifying data", () => {
      const now = Date.now();

      cache.set("key1", { data: "data1", timestamp: now });
      cache.set("key2", { data: "data2", timestamp: now });
      cache.set("key3", { data: "data3", timestamp: now });

      // Touch key1, making it most recently used
      cache.touch("key1");

      // Add key4, should evict key2 (oldest)
      cache.set("key4", { data: "data4", timestamp: now });

      expect(cache.has("key1")).toBe(true);
      expect(cache.has("key2")).toBe(false);
      expect(cache.has("key3")).toBe(true);
      expect(cache.has("key4")).toBe(true);
    });

    it("does nothing for nonexistent key", () => {
      // Should not throw
      cache.touch("nonexistent");
    });
  });

  describe("configuration", () => {
    it("uses default config when none provided", () => {
      const defaultCache = new MemoryCache();
      const stats = defaultCache.getStats();
      expect(stats).toBeDefined();
    });

    it("respects custom maxSize", () => {
      const smallCache = new MemoryCache<string>({ maxSize: 2 });
      const now = Date.now();

      smallCache.set("key1", { data: "data1", timestamp: now });
      smallCache.set("key2", { data: "data2", timestamp: now });
      smallCache.set("key3", { data: "data3", timestamp: now });

      // Should have evicted key1
      expect(smallCache.has("key1")).toBe(false);
      expect(smallCache.has("key2")).toBe(true);
      expect(smallCache.has("key3")).toBe(true);
    });

    it("respects custom defaultTTL", () => {
      const shortTTLCache = new MemoryCache<string>({ defaultTTL: 100 });

      shortTTLCache.set("key1", {
        data: "test",
        timestamp: Date.now() - 200,
      });

      expect(shortTTLCache.get("key1")).toBeNull();
    });
  });
});
