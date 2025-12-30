/**
 * @file File caching for watch mode
 */

import { stat } from 'node:fs/promises';
import type { ValidationResult } from '../types.js';

interface CacheEntry {
  mtime: number;
  result: ValidationResult;
}

const configCache = new Map<string, CacheEntry>();

/**
 * Validate file with caching based on modification time
 */
export async function validateWithCache(
  file: string,
  validateFn: (file: string) => Promise<ValidationResult>
): Promise<ValidationResult> {
  try {
    const stats = await stat(file);
    const cached = configCache.get(file);

    // Return cached result if file hasn't changed
    if (cached && cached.mtime === stats.mtimeMs) {
      return cached.result;
    }

    // Validate and cache
    const result = await validateFn(file);
    configCache.set(file, { mtime: stats.mtimeMs, result });

    return result;
  } catch (error) {
    // If stat fails, just validate without caching
    return validateFn(file);
  }
}

/**
 * Clear cache for a specific file or all files
 */
export function clearCache(file?: string): void {
  if (file) {
    configCache.delete(file);
  } else {
    configCache.clear();
  }
}

/**
 * Get cache size
 */
export function getCacheSize(): number {
  return configCache.size;
}
