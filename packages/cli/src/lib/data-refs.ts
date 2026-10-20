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
 * Paths on disk resolve exactly as `classify:` data does
 * ({@link localDataCandidates}, data-loader.ts): beside the document, then
 * the site root and its `public/` folder.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { decodeFlatGeobuf, type EmitDataRef, type EmitWarning } from '@maplibre-yaml/core';
import { localDataCandidates } from './data-loader.js';

/** Inline data larger than this gets a note: the style file grows by as much. */
export const LARGE_INLINE_BYTES = 2 * 1024 * 1024;

/** How long one data fetch may take at export. */
const FETCH_TIMEOUT_MS = 30_000;

/** Reads a file's bytes (injectable for tests). */
export type DataReader = (url: string, documentPath?: string) => Promise<Uint8Array>;

/** The default reader: fetch an http(s) URL; otherwise the first existing local candidate. */
export const defaultReader: DataReader = async (url, documentPath) => {
  if (/^https?:\/\//i.test(url)) {
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
    return new Uint8Array(await response.arrayBuffer());
  }
  const candidates = localDataCandidates(url, documentPath);
  const found = candidates.find((file) => existsSync(file));
  if (!found) {
    const shown = candidates.slice(0, 4).join(', ') + (candidates.length > 4 ? ', …' : '');
    throw new Error(`no file found (looked for ${shown})`);
  }
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
  options: { documentPath?: string; reader?: DataReader } = {}
): Promise<{ resolved: { source: string; data: unknown }[]; warnings: EmitWarning[] }> {
  const reader = options.reader ?? defaultReader;
  const resolved: { source: string; data: unknown }[] = [];
  const warnings: EmitWarning[] = [];
  for (const ref of refs) {
    try {
      const bytes = await reader(ref.url, options.documentPath);
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
