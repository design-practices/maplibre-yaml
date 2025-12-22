/**
 * @file TTL-based in-memory cache for fetched data
 * @module @maplibre-yaml/core/data
 */

/**
 * Configuration options for MemoryCache
 */
export interface CacheConfig {
  /**
   * Maximum number of entries to store
   * @default 100
   */
  maxSize: number;

  /**
   * Default time-to-live in milliseconds
   * @default 300000 (5 minutes)
   */
  defaultTTL: number;

  /**
   * Whether to use conditional requests with ETag/Last-Modified headers
   * @default true
   */
  useConditionalRequests: boolean;
}

/**
 * Cache entry containing data and metadata
 */
export interface CacheEntry<T = unknown> {
  /** Cached data */
  data: T;

  /** Timestamp when cached (milliseconds) */
  timestamp: number;

  /** Time-to-live for this entry in milliseconds (overrides default) */
  ttl?: number;

  /** ETag header from HTTP response */
  etag?: string;

  /** Last-Modified header from HTTP response */
  lastModified?: string;
}

/**
 * Cache statistics
 */
export interface CacheStats {
  /** Number of entries currently in cache */
  size: number;

  /** Total number of cache hits */
  hits: number;

  /** Total number of cache misses */
  misses: number;

  /** Hit rate as percentage (0-100) */
  hitRate: number;
}

/**
 * TTL-based in-memory cache with LRU eviction.
 *
 * @remarks
 * Features:
 * - LRU (Least Recently Used) eviction when at capacity
 * - Respects HTTP cache headers (ETag, Last-Modified)
 * - Configurable per-entry TTL
 * - Support for conditional requests (If-None-Match, If-Modified-Since)
 * - Automatic expiration checking on get operations
 *
 * @example
 * ```typescript
 * const cache = new MemoryCache<GeoJSON.FeatureCollection>({
 *   maxSize: 100,
 *   defaultTTL: 300000, // 5 minutes
 * });
 *
 * // Store data with ETag
 * cache.set('https://example.com/data.json', {
 *   data: geojsonData,
 *   timestamp: Date.now(),
 *   etag: '"abc123"',
 * });
 *
 * // Retrieve (returns null if expired or missing)
 * const entry = cache.get('https://example.com/data.json');
 * if (entry) {
 *   console.log('Cache hit:', entry.data);
 * }
 *
 * // Get conditional headers for HTTP request
 * const headers = cache.getConditionalHeaders('https://example.com/data.json');
 * // headers = { 'If-None-Match': '"abc123"' }
 * ```
 *
 * @typeParam T - Type of cached data
 */
export class MemoryCache<T = unknown> {
  private static readonly DEFAULT_CONFIG: CacheConfig = {
    maxSize: 100,
    defaultTTL: 300000, // 5 minutes
    useConditionalRequests: true,
  };

  private config: CacheConfig;
  private cache = new Map<string, CacheEntry<T>>();
  private accessOrder: string[] = [];
  private stats = { hits: 0, misses: 0 };

  /**
   * Create a new MemoryCache instance
   *
   * @param config - Cache configuration options
   */
  constructor(config?: Partial<CacheConfig>) {
    this.config = { ...MemoryCache.DEFAULT_CONFIG, ...config };
  }

  /**
   * Retrieve a cache entry
   *
   * @remarks
   * - Returns null if key doesn't exist
   * - Returns null if entry has expired (and removes it)
   * - Updates access order for LRU
   * - Updates cache statistics
   *
   * @param key - Cache key (typically a URL)
   * @returns Cache entry or null if not found/expired
   */
  get(key: string): CacheEntry<T> | null {
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    const ttl = entry.ttl ?? this.config.defaultTTL;
    const age = Date.now() - entry.timestamp;

    if (age > ttl) {
      this.cache.delete(key);
      this.removeFromAccessOrder(key);
      this.stats.misses++;
      return null;
    }

    this.updateAccessOrder(key);
    this.stats.hits++;
    return entry;
  }

  /**
   * Check if a key exists in cache (without checking expiration)
   *
   * @param key - Cache key
   * @returns True if key exists in cache
   */
  has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * Store a cache entry
   *
   * @remarks
   * - Evicts least recently used entries if at capacity
   * - Updates access order
   *
   * @param key - Cache key (typically a URL)
   * @param entry - Cache entry to store
   */
  set(key: string, entry: CacheEntry<T>): void {
    // Evict oldest entries if at capacity
    while (this.cache.size >= this.config.maxSize && !this.cache.has(key)) {
      const oldest = this.accessOrder.shift();
      if (oldest) {
        this.cache.delete(oldest);
      }
    }

    this.cache.set(key, entry);
    this.updateAccessOrder(key);
  }

  /**
   * Delete a cache entry
   *
   * @param key - Cache key
   * @returns True if entry was deleted, false if it didn't exist
   */
  delete(key: string): boolean {
    const existed = this.cache.delete(key);
    if (existed) {
      this.removeFromAccessOrder(key);
    }
    return existed;
  }

  /**
   * Clear all cache entries and reset statistics
   */
  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
    this.stats = { hits: 0, misses: 0 };
  }

  /**
   * Remove expired entries from cache
   *
   * @remarks
   * Iterates through all entries and removes those that have exceeded their TTL.
   * This is useful for periodic cleanup.
   *
   * @returns Number of entries removed
   */
  prune(): number {
    let removed = 0;
    const now = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      const ttl = entry.ttl ?? this.config.defaultTTL;
      const age = now - entry.timestamp;

      if (age > ttl) {
        this.cache.delete(key);
        this.removeFromAccessOrder(key);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Get cache statistics
   *
   * @returns Current cache statistics including hit rate
   */
  getStats(): CacheStats {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? (this.stats.hits / total) * 100 : 0;

    return {
      size: this.cache.size,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: Math.round(hitRate * 100) / 100, // Round to 2 decimal places
    };
  }

  /**
   * Get conditional request headers for HTTP caching
   *
   * @remarks
   * Returns appropriate If-None-Match and/or If-Modified-Since headers
   * based on cached entry metadata. Returns empty object if:
   * - Key doesn't exist in cache
   * - Entry has expired
   * - useConditionalRequests is false
   *
   * @param key - Cache key
   * @returns Object with conditional headers (may be empty)
   *
   * @example
   * ```typescript
   * const headers = cache.getConditionalHeaders(url);
   * const response = await fetch(url, { headers });
   * if (response.status === 304) {
   *   // Use cached data
   * }
   * ```
   */
  getConditionalHeaders(key: string): Record<string, string> {
    if (!this.config.useConditionalRequests) {
      return {};
    }

    const entry = this.get(key);
    if (!entry) {
      return {};
    }

    const headers: Record<string, string> = {};

    if (entry.etag) {
      headers["If-None-Match"] = entry.etag;
    }

    if (entry.lastModified) {
      headers["If-Modified-Since"] = entry.lastModified;
    }

    return headers;
  }

  /**
   * Update the last access time for an entry
   *
   * @remarks
   * Useful for keeping an entry "fresh" without modifying its data.
   * Updates the access order for LRU.
   *
   * @param key - Cache key
   */
  touch(key: string): void {
    if (this.cache.has(key)) {
      this.updateAccessOrder(key);
    }
  }

  /**
   * Update access order for LRU tracking
   *
   * @param key - Cache key
   */
  private updateAccessOrder(key: string): void {
    // Remove from current position
    this.removeFromAccessOrder(key);
    // Add to end (most recently used)
    this.accessOrder.push(key);
  }

  /**
   * Remove a key from access order array
   *
   * @param key - Cache key
   */
  private removeFromAccessOrder(key: string): void {
    const index = this.accessOrder.indexOf(key);
    if (index !== -1) {
      this.accessOrder.splice(index, 1);
    }
  }
}
