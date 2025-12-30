/**
 * @file Glob pattern utilities
 */

import fg from 'fast-glob';

export interface GlobOptions {
  cwd?: string;
  ignore?: string[];
}

/**
 * Resolve glob patterns to file paths
 */
export async function resolveGlobPatterns(
  patterns: string[],
  options: GlobOptions = {}
): Promise<string[]> {
  const cwd = options.cwd ?? process.cwd();
  const ignore = options.ignore ?? ['**/node_modules/**', '**/dist/**'];

  const files = await fg(patterns, {
    cwd,
    ignore,
    absolute: true,
    onlyFiles: true,
    dot: false,
  });

  return files.sort();
}
