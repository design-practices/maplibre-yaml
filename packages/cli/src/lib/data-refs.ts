/**
 * @file Convert FlatGeobuf sources to GeoJSON at emit time (0.9, ml-cnv.3)
 *
 * @description
 * style.json can't carry a FlatGeobuf decoder, so `mlym emit` converts the
 * file: core's projection emits an empty GeoJSON source plus an
 * `EmitDataRef`; this reads the file (an http(s) URL, or a path on disk) and
 * inlines its features — the same core/CLI split as `images:` (core
 * describes, the CLI fetches). A file that can't be read leaves the source
 * empty, reported as `lossy` so `--strict` refuses it.
 *
 * Paths on disk: the browser resolves a relative `url:` against the page,
 * which emit doesn't have, so the likely places are tried in order — next to
 * the YAML file, the current folder, and its `public/` (where an Astro site
 * keeps data).
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { decodeFlatGeobuf, type EmitDataRef, type EmitWarning } from '@maplibre-yaml/core';

/** Inline data larger than this gets a note: the style file grows by as much. */
export const LARGE_INLINE_BYTES = 2 * 1024 * 1024;

/** Reads a file's bytes (injectable for tests). */
export type DataReader = (url: string, candidates: string[]) => Promise<Uint8Array>;

/** Where on disk a relative/root-relative `url:` may live. */
export function diskCandidates(url: string, documentDir: string | undefined, cwd = process.cwd()): string[] {
  const path = url.replace(/[?#].*$/, '');
  const rel = path.replace(/^\/+/, '');
  const dirs = [documentDir, cwd, join(cwd, 'public')].filter((d): d is string => Boolean(d));
  return [...new Set(dirs.map((dir) => resolve(dir, rel)))];
}

/** The default reader: fetch an http(s) URL; otherwise the first existing candidate. */
export const defaultReader: DataReader = async (url, candidates) => {
  if (/^https?:\/\//i.test(url)) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
    return new Uint8Array(await response.arrayBuffer());
  }
  const found = candidates.find((file) => existsSync(file));
  if (!found) throw new Error(`not found (looked in ${candidates.join(', ')})`);
  return new Uint8Array(await readFile(found));
};

/**
 * Read and convert every FlatGeobuf source the projection described.
 *
 * @returns The features per source, and warnings (`lossy` for a source that
 *   couldn't be read, which then stays empty).
 */
export async function resolveDataRefs(
  refs: readonly EmitDataRef[],
  options: { documentDir?: string; reader?: DataReader } = {}
): Promise<{ resolved: { source: string; data: unknown }[]; warnings: EmitWarning[] }> {
  const reader = options.reader ?? defaultReader;
  const resolved: { source: string; data: unknown }[] = [];
  const warnings: EmitWarning[] = [];
  for (const ref of refs) {
    try {
      const bytes = await reader(ref.url, diskCandidates(ref.url, options.documentDir));
      const data = await decodeFlatGeobuf(bytes, ref.url);
      resolved.push({ source: ref.source, data });
      const size = JSON.stringify(data).length;
      if (size > LARGE_INLINE_BYTES) {
        warnings.push({
          path: `sources.${ref.source}.data`,
          kind: 'contract',
          construct: 'format.flatgeobuf',
          exportClass: 'exports-with-fallback',
          message:
            `\`${ref.url}\` converted to ${Math.round(size / 1024 / 1024)} MB of inline GeoJSON; ` +
            'the emitted style is that much larger.',
        });
      }
    } catch (error) {
      warnings.push({
        path: `sources.${ref.source}.data`,
        kind: 'lossy',
        construct: 'format.flatgeobuf',
        exportClass: 'exports-with-fallback',
        message:
          `\`${ref.url}\` couldn't be read at emit time (${(error as Error).message.replace(/`/g, '"')}); ` +
          'the emitted source is empty.',
      });
    }
  }
  return { resolved, warnings };
}
