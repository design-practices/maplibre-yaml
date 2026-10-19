/**
 * @file Glob pattern utilities
 */

// tinyglobby (picomatch), not fast-glob: fast-glob -> micromatch -> braces
// carries an advisory with no fixed release (ml-aot.56).
import { glob, escapePath, isDynamicPattern } from 'tinyglobby';
import { statSync } from 'node:fs';
import { resolve as resolvePath, relative as relativePath } from 'pathe';

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

  const files = await glob(patterns, {
    cwd,
    ignore,
    absolute: true,
    onlyFiles: true,
    dot: false,
    // fast-glob semantics: a pattern naming a folder does not match its
    // contents (resolveTargets expands folder arguments itself).
    expandDirectories: false,
  });

  // tinyglobby returns forward-slash absolute paths, as fast-glob did.
  return files.sort();
}

export interface ResolvedTargets {
  /** Absolute, de-duplicated, sorted file paths to validate. */
  files: string[];
  /** Arguments (files or patterns) that matched no file. */
  unmatched: string[];
  /** Files named literally but excluded by the project's `ignorePatterns`. */
  ignored: string[];
}

/** The YAML files a folder argument stands for. */
const FOLDER_PATTERN = '**/*.{yaml,yml}';

/**
 * Resolve every command-line target (files, folders and/or glob patterns)
 * independently.
 *
 * @remarks
 * Each argument is resolved on its own so that one that matches nothing can be
 * reported by name instead of silently disappearing among the others:
 *
 * - an existing **file** is taken literally (a shell-expanded glob arrives as
 *   plain paths, and a name with glob syntax such as `map[1].yaml` must not be
 *   re-read as a pattern), unless the project's `validate.ignorePatterns`
 *   (`options.ignore`) excludes it;
 * - an existing **folder** stands for every `.yaml`/`.yml` file under it;
 * - anything else is a **glob**, taken whole first, so `"My Maps/*.yaml"` is
 *   one pattern. Only if the whole argument matches nothing and contains
 *   whitespace is it split, preserving the older `validate "a.yaml b.yaml"`
 *   spelling.
 */
export async function resolveTargets(
  args: ReadonlyArray<string | number>,
  options: GlobOptions = {}
): Promise<ResolvedTargets> {
  const cwd = options.cwd ?? process.cwd();
  const seen = new Set<string>();
  const unmatched: string[] = [];
  const ignored: string[] = [];

  /** Files for one argument, or null when it names nothing. */
  async function resolveOne(arg: string): Promise<string[] | null> {
    const literal = resolvePath(cwd, arg);
    const stat = statOf(literal);
    if (stat?.isFile()) {
      if (await isIgnored(literal, cwd, options.ignore)) {
        ignored.push(arg);
        return [];
      }
      return [literal];
    }
    if (stat?.isDirectory()) {
      // From the project folder, so ignore patterns (relative to it) line up.
      const rel = relativePath(cwd, literal);
      const base = rel === '' ? '' : `${escapePath(rel.startsWith('..') ? literal : rel)}/`;
      const files = await resolveGlobPatterns([base + FOLDER_PATTERN], options);
      return files.length > 0 ? files : null;
    }
    const files = await resolveGlobPatterns([arg], options);
    return files.length > 0 ? files : null;
  }

  for (const raw of args) {
    const arg = String(raw);
    if (arg.trim() === '') continue;
    let matches = await resolveOne(arg);
    if (matches === null && /\s/.test(arg.trim())) {
      // Legacy single-string list: "a.yaml b.yaml".
      matches = [];
      for (const part of arg.split(/\s+/).filter(Boolean)) {
        const found = await resolveOne(part);
        if (found === null) unmatched.push(part);
        else matches.push(...found);
      }
    } else if (matches === null) {
      unmatched.push(arg);
      continue;
    }
    for (const m of matches) seen.add(m);
  }

  return { files: [...seen].sort(), unmatched, ignored };
}

/** Whether an argument is a glob pattern rather than a plain path. */
export function isGlobPattern(arg: string): boolean {
  return isDynamicPattern(arg);
}

/** Whether the project's ignore patterns exclude an existing file. */
async function isIgnored(file: string, cwd: string, ignore: string[] | undefined): Promise<boolean> {
  if (!ignore || ignore.length === 0) return false;
  const rel = relativePath(cwd, file);
  // Outside the project folder: the patterns (relative to it) cannot apply.
  if (rel.startsWith('..')) return false;
  const kept = await glob([escapePath(rel)], { cwd, ignore, onlyFiles: true, dot: true, expandDirectories: false });
  return kept.length === 0;
}

function statOf(path: string): ReturnType<typeof statSync> | undefined {
  try {
    return statSync(path);
  } catch {
    return undefined;
  }
}
