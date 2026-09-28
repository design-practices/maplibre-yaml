/**
 * @file Static Mapzen-classic presets (U10, R13) — the crosshatch contract
 *
 * @description
 * A static classic claims three things, each asserted here against the REAL
 * docs-gallery document (the file the docs site serves):
 *  1. it validates strict — no errors AND no warnings (CI's default);
 *  2. it ejects without loss — `emitStyle` in strict mode accepts it, with
 *     zero lossy warnings and zero runtime keys in the output: the static
 *     preset is its own fallback (and the eject target the animated hatch
 *     effect degrades to, U12/U13);
 *  3. its committed hatch tiles are exactly what the generator produces
 *     (decoded-pixel drift check — PNG bytes are libvips-fragile).
 * The browser half (renders live; ejected output renders the same map) is
 * e2e/classics-crosshatch.spec.ts.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  YAMLParser,
  LAYER_RUNTIME_KEYS,
  SOURCE_RUNTIME_KEYS,
  DOCUMENT_SPRITE_ID,
} from '@maplibre-yaml/core';
import { emitStyle } from '../src/commands/emit';
import { validateFile } from '../src/lib/validator.js';
import { TILES, TILE_DIR } from '../scripts/crosshatch-tiles';

const ROOT = join(__dirname, '../../..');
const DOC_PATH = join(ROOT, 'docs/public/configs/gallery/crosshatch.yaml');

/**
 * The demotiles basemap as it stands (2026-09): layer ids and root keys that
 * matter to the merge, no sprite. Stubbed so the test stays offline; the
 * live sweep (`pnpm verify:docs-gallery`) covers the real endpoint.
 */
const DEMOTILES_STUB = {
  version: 8,
  name: 'MapLibre',
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: { maplibre: { type: 'vector', url: 'https://demotiles.maplibre.org/tiles/tiles.json' } },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#D8F2FF' } },
    { id: 'countries-fill', type: 'fill', source: 'maplibre', 'source-layer': 'countries' },
    {
      id: 'countries-label',
      type: 'symbol',
      source: 'maplibre',
      'source-layer': 'centroids',
      layout: { 'text-field': '{NAME}' },
    },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('classics: crosshatch (U10)', () => {
  it('validates strict — zero errors, zero warnings', async () => {
    const result = await validateFile(DOC_PATH);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('ejects losslessly: strict emit, zero lossy warnings, zero runtime keys', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(DEMOTILES_STUB), { status: 200 })),
    );
    const parsed = YAMLParser.safeParseMapBlock(readFileSync(DOC_PATH, 'utf8'));
    if (!parsed.success) throw new Error(JSON.stringify(parsed.errors));

    // Strict mode throws on any lossy warning anywhere in the pipeline.
    const { style, warnings, images } = await emitStyle(parsed.data, 'strict', {
      trust: 'untrusted',
    });
    expect(warnings.filter((w) => w.kind === 'lossy')).toEqual([]);

    // No runtime key survives on any layer or source.
    const layers = style['layers'] as Record<string, unknown>[];
    for (const layer of layers) {
      for (const key of LAYER_RUNTIME_KEYS) expect(layer).not.toHaveProperty(key);
    }
    for (const source of Object.values(style['sources'] as Record<string, object>)) {
      for (const key of SOURCE_RUNTIME_KEYS) expect(source).not.toHaveProperty(key);
    }
    // No document-only root key leaks either.
    for (const key of ['images', 'markers', 'parameters', 'config', 'type', 'id']) {
      expect(style).not.toHaveProperty(key);
    }

    // The pattern refs rewrote into the document sprite, and both tiles ride
    // the result for the CLI's fetch stage.
    const pattern = (id: string) =>
      (layers.find((l) => l['id'] === id)!['paint'] as Record<string, unknown>)['fill-pattern'];
    expect(pattern('crosshatch-light')).toBe(`${DOCUMENT_SPRITE_ID}:hatch-light`);
    expect(pattern('crosshatch-dark')).toBe(`${DOCUMENT_SPRITE_ID}:hatch-dark`);
    expect(images?.map((i) => i.name).sort()).toEqual(['hatch-dark', 'hatch-light']);
    expect(images?.every((i) => i.pixelRatio === 2)).toBe(true);

    // Placement survives eject: the preset sits below the basemap labels.
    const ids = layers.map((l) => l['id']);
    expect(ids.indexOf('crosshatch-outline')).toBeLessThan(ids.indexOf('countries-label'));
  });

  it('committed hatch tiles match the generator (decoded pixels)', async () => {
    for (const [name, make] of Object.entries(TILES)) {
      const committed = await sharp(readFileSync(join(ROOT, TILE_DIR, name)))
        .raw()
        .toBuffer({ resolveWithObject: true });
      const fresh = await sharp(await make()).raw().toBuffer({ resolveWithObject: true });
      expect(committed.info, `${name} dimensions drifted`).toEqual(fresh.info);
      expect(
        committed.data.equals(fresh.data),
        `${name} drifted from the generator — rerun scripts/crosshatch-tiles.ts`,
      ).toBe(true);
    }
  });
});
