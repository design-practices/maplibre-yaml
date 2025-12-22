/**
 * @file HTTP data fetcher with caching and retry support
 * @module @maplibre-yaml/core/data
 */

import { MemoryCache, type CacheEntry, type CacheStats } from "./memory-cache";
import { RetryManager } from "./retry-manager";
import type { FeatureCollection } from "geojson";

/**
 * Configuration for DataFetcher
 */
export interface FetcherConfig {
  /**
   * Cache configuration
   */
  cache: {
    /** Whether caching is enabled */
    enabled: boolean;
    /** Default TTL in milliseconds */
    defaultTTL: number;
    /** Maximum number of cached entries */
    maxSize: number;
  };

  /**
   * Retry configuration
   */
  retry: {
    /** Whether retry is enabled */
    enabled: boolean;
    /** Maximum number of retry attempts */
    maxRetries: number;
    /** Initial delay in milliseconds */
    initialDelay: number;
    /** Maximum delay in milliseconds */
    maxDelay: number;
  };

  /**
   * Request timeout in milliseconds
   * @default 30000
   */
  timeout: number;

  /**
   * Default headers to include in all requests
   */
  defaultHeaders: Record<string, string>;
}

/**
 * Options for individual fetch requests
 */
export interface FetchOptions {
  /**
   * Custom TTL for this request (overrides default)
   */
  ttl?: number;

  /**
   * Skip cache and force fresh fetch
   * @default false
   */
  skipCache?: boolean;

  /**
   * AbortSignal for request cancellation
   */
  signal?: AbortSignal;

  /**
   * Additional headers for this request
   */
  headers?: Record<string, string>;

  /**
   * Callback before each retry attempt
   */
  onRetry?: (attempt: number, delay: number, error: Error) => void;

  /**
   * Callback when fetch starts
   */
  onStart?: () => void;

  /**
   * Callback when fetch completes successfully
   */
  onComplete?: (data: FeatureCollection, fromCache: boolean) => void;

  /**
   * Callback when fetch fails
   */
  onError?: (error: Error) => void;
}

/**
 * Result of a fetch operation
 */
export interface FetchResult {
  /** The fetched GeoJSON data */
  data: FeatureCollection;

  /** Whether data came from cache */
  fromCache: boolean;

  /** Number of features in the collection */
  featureCount: number;

  /** Duration of fetch operation in milliseconds */
  duration: number;
}

/**
 * HTTP data fetcher with caching and retry support.
 *
 * @remarks
 * Features:
 * - In-memory caching with TTL
 * - Conditional requests (If-None-Match, If-Modified-Since)
 * - Automatic retry with exponential backoff
 * - Request timeout and cancellation
 * - GeoJSON validation
 * - Lifecycle callbacks
 *
 * @example
 * ```typescript
 * const fetcher = new DataFetcher({
 *   cache: { enabled: true, defaultTTL: 300000, maxSize: 100 },
 *   retry: { enabled: true, maxRetries: 3, initialDelay: 1000, maxDelay: 10000 },
 *   timeout: 30000,
 * });
 *
 * // Fetch with caching
 * const result = await fetcher.fetch('https://example.com/data.geojson');
 * console.log(`Fetched ${result.featureCount} features in ${result.duration}ms`);
 *
 * // Prefetch for later use
 * await fetcher.prefetch('https://example.com/data2.geojson');
 *
 * // Force fresh fetch
 * const fresh = await fetcher.fetch(url, { skipCache: true });
 * ```
 */
export class DataFetcher {
  private static readonly DEFAULT_CONFIG: FetcherConfig = {
    cache: {
      enabled: true,
      defaultTTL: 300000, // 5 minutes
      maxSize: 100,
    },
    retry: {
      enabled: true,
      maxRetries: 3,
      initialDelay: 1000,
      maxDelay: 10000,
    },
    timeout: 30000,
    defaultHeaders: {
      Accept: "application/geo+json,application/json",
    },
  };

  private config: FetcherConfig;
  private cache: MemoryCache<FeatureCollection>;
  private retryManager: RetryManager;
  private activeRequests = new Map<string, AbortController>();

  /**
   * Create a new DataFetcher instance
   *
   * @param config - Fetcher configuration
   */
  constructor(config?: Partial<FetcherConfig>) {
    this.config = this.mergeConfig(config);

    this.cache = new MemoryCache<FeatureCollection>({
      maxSize: this.config.cache.maxSize,
      defaultTTL: this.config.cache.defaultTTL,
      useConditionalRequests: true,
    });

    this.retryManager = new RetryManager({
      maxRetries: this.config.retry.maxRetries,
      initialDelay: this.config.retry.initialDelay,
      maxDelay: this.config.retry.maxDelay,
    });
  }

  /**
   * Fetch GeoJSON data from a URL
   *
   * @param url - URL to fetch from
   * @param options - Fetch options
   * @returns Fetch result with data and metadata
   * @throws {Error} On network error, timeout, invalid JSON, or non-GeoJSON response
   *
   * @example
   * ```typescript
   * const result = await fetcher.fetch(
   *   'https://example.com/data.geojson',
   *   {
   *     ttl: 60000, // 1 minute cache
   *     onRetry: (attempt, delay, error) => {
   *       console.log(`Retry ${attempt} in ${delay}ms: ${error.message}`);
   *     },
   *   }
   * );
   * ```
   */
  async fetch(url: string, options: FetchOptions = {}): Promise<FetchResult> {
    const startTime = Date.now();

    options.onStart?.();

    try {
      // Check cache first (unless skipCache is true)
      if (this.config.cache.enabled && !options.skipCache) {
        const cached = this.cache.get(url);
        if (cached) {
          const result: FetchResult = {
            data: cached.data,
            fromCache: true,
            featureCount: cached.data.features.length,
            duration: Date.now() - startTime,
          };
          options.onComplete?.(cached.data, true);
          return result;
        }
      }

      // Fetch fresh data
      const data = await this.fetchWithRetry(url, options);

      // Cache the result
      if (this.config.cache.enabled && !options.skipCache) {
        const cacheEntry: CacheEntry<FeatureCollection> = {
          data,
          timestamp: Date.now(),
          ttl: options.ttl,
        };
        this.cache.set(url, cacheEntry);
      }

      const result: FetchResult = {
        data,
        fromCache: false,
        featureCount: data.features.length,
        duration: Date.now() - startTime,
      };

      options.onComplete?.(data, false);
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      options.onError?.(err);
      throw err;
    }
  }

  /**
   * Prefetch data and store in cache
   *
   * @remarks
   * Useful for preloading data that will be needed soon.
   * Does not return the data.
   *
   * @param url - URL to prefetch
   * @param ttl - Optional custom TTL for cached entry
   *
   * @example
   * ```typescript
   * // Prefetch data for quick access later
   * await fetcher.prefetch('https://example.com/data.geojson', 600000);
   * ```
   */
  async prefetch(url: string, ttl?: number): Promise<void> {
    await this.fetch(url, { ttl, skipCache: false });
  }

  /**
   * Invalidate cached entry for a URL
   *
   * @param url - URL to invalidate
   *
   * @example
   * ```typescript
   * // Force next fetch to get fresh data
   * fetcher.invalidate('https://example.com/data.geojson');
   * ```
   */
  invalidate(url: string): void {
    this.cache.delete(url);
  }

  /**
   * Clear all cached entries
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   *
   * @returns Cache stats including size, hits, misses, and hit rate
   */
  getCacheStats(): CacheStats {
    return this.cache.getStats();
  }

  /**
   * Abort all active requests
   */
  abortAll(): void {
    for (const controller of this.activeRequests.values()) {
      controller.abort();
    }
    this.activeRequests.clear();
  }

  /**
   * Fetch with retry logic
   */
  private async fetchWithRetry(
    url: string,
    options: FetchOptions
  ): Promise<FeatureCollection> {
    if (!this.config.retry.enabled) {
      return this.performFetch(url, options);
    }

    return this.retryManager.execute(
      () => this.performFetch(url, options),
      {
        onRetry: options.onRetry,
        isRetryable: (error) => this.isRetryableError(error),
      }
    );
  }

  /**
   * Perform the actual HTTP fetch
   */
  private async performFetch(
    url: string,
    options: FetchOptions
  ): Promise<FeatureCollection> {
    // Create abort controller with timeout
    const controller = options.signal
      ? new AbortController()
      : new AbortController();

    // Link external signal if provided
    if (options.signal) {
      options.signal.addEventListener("abort", () => controller.abort());
    }

    // Set timeout
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, this.config.timeout);

    this.activeRequests.set(url, controller);

    try {
      // Prepare headers
      const headers = {
        ...this.config.defaultHeaders,
        ...options.headers,
      };

      // Add conditional headers if we have cached entry
      if (this.config.cache.enabled && this.cache.has(url)) {
        const conditionalHeaders = this.cache.getConditionalHeaders(url);
        Object.assign(headers, conditionalHeaders);
      }

      // Perform fetch
      const response = await fetch(url, {
        signal: controller.signal,
        headers,
      });

      // Handle 304 Not Modified
      if (response.status === 304) {
        const cached = this.cache.get(url);
        if (cached) {
          // Touch to update access order
          this.cache.touch(url);
          return cached.data;
        }
        // Fallback: shouldn't happen, but handle gracefully
        throw new Error("304 Not Modified but no cached data available");
      }

      // Handle HTTP errors
      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}: ${response.statusText} for ${url}`
        );
      }

      // Parse JSON
      let data: unknown;
      try {
        data = await response.json();
      } catch (error) {
        throw new Error(`Invalid JSON response from ${url}`);
      }

      // Validate GeoJSON
      if (!this.isValidGeoJSON(data)) {
        throw new Error(`Response from ${url} is not valid GeoJSON`);
      }

      // Update cache metadata with response headers
      if (this.config.cache.enabled) {
        const etag = response.headers.get("etag");
        const lastModified = response.headers.get("last-modified");

        if (etag || lastModified) {
          const cached = this.cache.get(url);
          if (cached) {
            // Update existing cache entry with new headers
            this.cache.set(url, {
              ...cached,
              etag: etag || cached.etag,
              lastModified: lastModified || cached.lastModified,
            });
          }
        }
      }

      return data as FeatureCollection;
    } finally {
      clearTimeout(timeoutId);
      this.activeRequests.delete(url);
    }
  }

  /**
   * Check if an error should trigger a retry
   */
  private isRetryableError(error: Error): boolean {
    const message = error.message.toLowerCase();

    // Don't retry on client errors (except 429 rate limit)
    if (message.includes("http 4") && !message.includes("429")) {
      return false;
    }

    // Don't retry on invalid JSON or GeoJSON
    if (
      message.includes("invalid json") ||
      message.includes("not valid geojson")
    ) {
      return false;
    }

    // Retry on network errors, timeouts, and server errors
    return true;
  }

  /**
   * Validate that data is a GeoJSON FeatureCollection
   */
  private isValidGeoJSON(data: unknown): data is FeatureCollection {
    if (typeof data !== "object" || data === null) {
      return false;
    }

    const obj = data as Record<string, unknown>;

    return (
      obj.type === "FeatureCollection" && Array.isArray(obj.features)
    );
  }

  /**
   * Merge partial config with defaults
   */
  private mergeConfig(partial?: Partial<FetcherConfig>): FetcherConfig {
    if (!partial) return DataFetcher.DEFAULT_CONFIG;

    return {
      cache: { ...DataFetcher.DEFAULT_CONFIG.cache, ...partial.cache },
      retry: { ...DataFetcher.DEFAULT_CONFIG.retry, ...partial.retry },
      timeout: partial.timeout ?? DataFetcher.DEFAULT_CONFIG.timeout,
      defaultHeaders: {
        ...DataFetcher.DEFAULT_CONFIG.defaultHeaders,
        ...partial.defaultHeaders,
      },
    };
  }
}
