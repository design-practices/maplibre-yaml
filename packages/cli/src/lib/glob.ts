/**
 * @file Glob pattern utilities
 */

import fg from 'fast-glob';
import { statSync } from 'node:fs';
import { resolve as resolvePath } from 'pathe';

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

export interface ResolvedTargets {
  /** Absolute, de-duplicated, sorted file paths to validate. */
  files: string[];
  /** Arguments (files or patterns) that matched no file. */
  unmatched: string[];
}

/**
 * Resolve every command-line target (files and/or glob patterns) independently.
 *
 * @remarks
 * Each argument is resolved on its own so that one that matches nothing can be
 * reported by name instead of silently disappearing among the others. An
 * argument that names an existing file is taken literally (a shell-expanded
 * glob arrives as plain paths, and a file name containing glob syntax such as
 * `map[1].yaml` must not be re-read as a pattern). A single argument that is
 * not a file and contains whitespace is split, preserving the older
 * `validate "a.yaml b.yaml"` spelling.
 */
export async function resolveTargets(
  args: ReadonlyArray<string | number>,
  options: GlobOptions = {}
): Promise<ResolvedTargets> {
  const cwd = options.cwd ?? process.cwd();

  const expanded: string[] = [];
  for (const raw of args) {
    const arg = String(raw);
    if (arg.trim() === '') continue;
    if (/\s/.test(arg) && !isFile(resolvePath(cwd, arg))) {
      expanded.push(...arg.split(/\s+/).filter(Boolean));
    } else {
      expanded.push(arg);
    }
  }

  const seen = new Set<string>();
  const unmatched: string[] = [];
  for (const arg of expanded) {
    const literal = resolvePath(cwd, arg);
    const matches = isFile(literal) ? [literal] : await resolveGlobPatterns([arg], options);
    if (matches.length === 0) {
      unmatched.push(arg);
      continue;
    }
    for (const m of matches) seen.add(m);
  }

  return { files: [...seen].sort(), unmatched };
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
