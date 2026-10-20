/**
 * @file Load a document's GeoJSON at export time (`classify: { method }`)
 * @module @maplibre-yaml/cli/lib/data-loader
 *
 * @description
 * `mlym emit` bakes computed classify breaks into the style, so it needs the
 * data a `url:` source points at. An http(s) URL is fetched. A local path
 * resolves the way the published site would serve it: a relative path
 * against the document's folder, then the site root; a root-relative path
 * (`/data/tracts.geojson`) against the nearest `public/` folder above the
 * document (Astro, Vite) or the folder itself. Every path tried is named
 * when nothing is found.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decodeFlatGeobuf,
  formatFromUrl,
  type ClassifyDataLoader,
  type CloudFormat,
} from '@maplibre-yaml/core';

/** How long one data fetch may take at export. */
const FETCH_TIMEOUT_MS = 30_000;

/** The folders from `dir` up towards the filesystem root (at most `limit`). */
function ancestors(dir: string, limit = 8): string[] {
  const out: string[] = [];
  let current = resolve(dir);
  for (let i = 0; i < limit; i++) {
    out.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return out;
}

/** Candidate files for a local data URL, most specific first. */
export function localDataCandidates(url: string, documentPath?: string): string[] {
  const clean = decodeURIComponent(url.replace(/[?#].*$/, ''));
  if (clean.startsWith('file:')) return [fileURLToPath(clean)];
  const docDir = documentPath ? dirname(resolve(documentPath)) : process.cwd();
  const roots = [...new Set([...ancestors(docDir), resolve(process.cwd())])];
  const candidates: string[] = [];
  if (clean.startsWith('/')) {
    for (const dir of roots) candidates.push(join(dir, 'public', clean), join(dir, clean));
  } else {
    candidates.push(resolve(docDir, clean));
    for (const dir of roots) candidates.push(join(dir, 'public', clean));
  }
  return [...new Set(candidates)];
}

/** Read a FlatGeobuf file (http(s) or local, same rules as below) and decode it. */
async function loadFlatGeobuf(url: string, documentPath?: string): Promise<unknown> {
  let bytes: Uint8Array;
  if (/^https?:\/\//i.test(url)) {
    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch (error) {
      throw new Error(`the request failed (${(error as Error).message})`);
    }
    if (!response.ok) {
      throw new Error(`the server answered ${response.status} ${response.statusText}`.trim());
    }
    bytes = new Uint8Array(await response.arrayBuffer());
  } else {
    const candidates = localDataCandidates(url, documentPath);
    const found = candidates.find((path) => existsSync(path));
    if (!found) {
      const shown = candidates.slice(0, 4).join(', ') + (candidates.length > 4 ? ', …' : '');
      throw new Error(`no file found (looked for ${shown})`);
    }
    bytes = new Uint8Array(readFileSync(found));
  }
  return decodeFlatGeobuf(bytes, url);
}

/**
 * A loader for `bakeClassify`: fetches http(s) URLs, reads local paths
 * relative to `documentPath`. Rejects with a message that says what was tried.
 */
export function createDataLoader(documentPath?: string): ClassifyDataLoader {
  return async (url: string, options?: { format?: CloudFormat }) => {
    // A FlatGeobuf file (ml-cnv.3) is decoded to GeoJSON, so classify breaks
    // can be computed from it like from a .geojson file. The source's
    // `format:` wins over the URL (an extensionless API URL), as in the browser.
    if ((options?.format ?? formatFromUrl(url)) === 'flatgeobuf') {
      return loadFlatGeobuf(url, documentPath);
    }
    if (/^https?:\/\//i.test(url)) {
      let response: Response;
      try {
        response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      } catch (error) {
        throw new Error(`the request failed (${(error as Error).message})`);
      }
      if (!response.ok) {
        throw new Error(`the server answered ${response.status} ${response.statusText}`.trim());
      }
      try {
        return await response.json();
      } catch {
        throw new Error('the response is not JSON');
      }
    }
    const candidates = localDataCandidates(url, documentPath);
    const found = candidates.find((path) => existsSync(path));
    if (!found) {
      const shown = candidates.slice(0, 4).join(', ') + (candidates.length > 4 ? ', …' : '');
      throw new Error(`no file found (looked for ${shown})`);
    }
    try {
      return JSON.parse(readFileSync(found, 'utf-8'));
    } catch (error) {
      throw new Error(`${found} is not valid JSON (${(error as Error).message})`);
    }
  };
}
