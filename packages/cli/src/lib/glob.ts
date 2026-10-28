/**
 * @file Glob pattern utilities
 */

// tinyglobby (picomatch), not fast-glob: fast-glob -> micromatch -> braces
// carries an advisory with no fixed release (ml-aot.56).
import { glob, escapePath, isDynamicPattern } from 'tinyglobby';
import { statSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { resolve as resolvePath, relative as relativePath, basename, extname } from 'pathe';

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
  /**
   * JSON and TOML files found under a folder argument that are not map or
   * story documents (`package.json`, a GeoJSON file, `pyproject.toml`).
   * `validate --verbose` lists them.
   */
  skipped: string[];
  /** Folder arguments under which no map or story document was found. */
  emptyFolders: string[];
}

/** The YAML files a folder argument stands for: every one of them. */
const FOLDER_PATTERN = '**/*.{yaml,yml}';

/** The JSON and TOML files under a folder argument, which join only if they read as a document. */
const FOLDER_CANDIDATE_PATTERN = '**/*.{json,toml}';

/** The CLI's own project config, never a document (see config-loader.ts). */
const PROJECT_CONFIG_FILE = 'maplibre-yaml.config.json';

/** How much of a JSON or TOML file the folder sniff reads. */
const SNIFF_BYTES = 64 * 1024;

/** A `$schema` (or TOML `#:schema` directive) under this site's schema folder. */
const SCHEMA_URL = String.raw`https?://docs\.maplibre-yaml\.org/schema/`;

const DOCUMENT_MARKS: Record<'json' | 'toml', RegExp[]> = {
  json: [
    /"type"\s*:\s*"(?:map|scrollytelling)"/,
    /"pages"\s*:\s*\[/,
    new RegExp(String.raw`"\$schema"\s*:\s*"` + SCHEMA_URL),
  ],
  toml: [
    /^type[ \t]*=[ \t]*["'](?:map|scrollytelling)["']/m,
    /^(?:pages[ \t]*=|\[\[[ \t]*pages[ \t]*\]\])/m,
    new RegExp(String.raw`^(?:#:schema[ \t]+|["']\$schema["'][ \t]*=[ \t]*["'])` + SCHEMA_URL, 'm'),
  ],
};

/**
 * Whether a JSON or TOML file under a folder argument is a map or story
 * document, judged from the raw text of its first 64 KB, not a parse
 * (KTD11): a `type` of `map` or `scrollytelling`, a `pages` key, or a
 * `$schema` under docs.maplibre-yaml.org/schema/. A document with a syntax
 * error, or one too large to parse quickly, still joins the run and fails
 * there, rather than vanishing from it.
 */
export async function looksLikeDocument(file: string): Promise<boolean> {
  const format = extname(file).toLowerCase() === '.toml' ? 'toml' : 'json';
  let text: string;
  try {
    const handle = await open(file, 'r');
    try {
      const buffer = Buffer.alloc(SNIFF_BYTES);
      const { bytesRead } = await handle.read(buffer, 0, SNIFF_BYTES, 0);
      text = buffer.subarray(0, bytesRead).toString('utf-8');
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return DOCUMENT_MARKS[format].some((mark) => mark.test(text));
}

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
 * - an existing **folder** stands for every `.yaml`/`.yml` file under it,
 *   and for each `.json`/`.toml` file under it that {@link looksLikeDocument}
 *   (the others are listed in `skipped`; `maplibre-yaml.config.json` is the
 *   project config and always skipped). A folder with no document is listed
 *   in `emptyFolders`;
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
  const skipped = new Set<string>();
  const emptyFolders: string[] = [];

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
      for (const candidate of await resolveGlobPatterns([base + FOLDER_CANDIDATE_PATTERN], options)) {
        if (basename(candidate) !== PROJECT_CONFIG_FILE && (await looksLikeDocument(candidate))) {
          files.push(candidate);
        } else {
          skipped.add(candidate);
        }
      }
      if (files.length === 0) {
        emptyFolders.push(arg);
        return [];
      }
      return files;
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

  return {
    files: [...seen].sort(),
    unmatched,
    ignored,
    // A file another argument named is not skipped.
    skipped: [...skipped].filter((f) => !seen.has(f)).sort(),
    emptyFolders,
  };
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
