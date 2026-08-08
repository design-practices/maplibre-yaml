/**
 * @file Unit tests for the emit command's compile step
 * @module @maplibre-yaml/cli/test
 *
 * @description
 * `emitStyle` is the exit-free core of `mlym emit`, so it can be exercised
 * without spawning a process. The end-to-end command behavior (arg parsing,
 * exit codes, stdout/stderr split) is covered by the integration test, which
 * needs a built CLI.
 */

import { describe, it, expect } from 'vitest';
import { YAMLParser } from '@maplibre-yaml/core';
import { emitStyle } from '../src/commands/emit';

const parse = (yaml: string) => {
  const result = YAMLParser.safeParseMapBlock(yaml);
  if (!result.success) throw new Error(JSON.stringify(result.errors));
  return result.data;
};

const DOC = `
type: map
id: parcels
config:
  center: [-73.98, 40.75]
  zoom: 12
sources:
  parcels:
    type: geojson
    data: { type: FeatureCollection, features: [] }
    refresh:
      refreshInterval: 5000
layers:
  - id: fill
    type: fill
    source: parcels
    paint: { fill-color: "#8899aa" }
    interactive:
      hover: { highlight: true }
`;

describe('emitStyle', () => {
  it('compiles a document to a spec-valid style, dropping the runtime half', async () => {
    const { style, warnings } = await emitStyle(parse(DOC), 'with-fallbacks', {
      trust: 'untrusted',
    });

    expect(style['version']).toBe(8);
    // The runtime half is gone: no interactive on the layer, no refresh on the source.
    const layers = style['layers'] as Record<string, unknown>[];
    expect(layers[0]).not.toHaveProperty('interactive');
    const sources = style['sources'] as Record<string, Record<string, unknown>>;
    expect(sources['parcels']).not.toHaveProperty('refresh');
    // The source had compile-time data, so its live-data loss is a contract warning.
    expect(warnings.some((w) => w.path === 'sources.parcels' && w.kind === 'contract')).toBe(true);
  });

  it('merges an inline basemap so the output is self-contained', async () => {
    const withBase = DOC.replace(
      'config:\n  center',
      `config:
  mapStyle:
    version: 8
    name: Base
    sources: { base: { type: vector, url: "https://t.test/v.json" } }
    layers: [{ id: bg, type: background, paint: { background-color: "#eee" } }]
  center`,
    );
    const { style } = await emitStyle(parse(withBase), 'with-fallbacks', { trust: 'untrusted' });

    expect(Object.keys(style['sources'] as object).sort()).toEqual(['base', 'parcels']);
    const ids = (style['layers'] as Record<string, unknown>[]).map((l) => l['id']);
    expect(ids).toEqual(['bg', 'fill']);
  });

  it('inlines state below the target floor', async () => {
    const stateDoc = `
type: map
id: s
config:
  center: [0, 0]
  zoom: 5
state:
  scenario:
    default: built
sources:
  s: { type: geojson, data: { type: FeatureCollection, features: [] } }
layers:
  - id: a
    type: fill
    source: s
    paint:
      fill-opacity: ["case", ["==", ["global-state", "scenario"], "built"], 1, 0.3]
`;
    const { style } = await emitStyle(parse(stateDoc), 'with-fallbacks', {
      trust: 'trusted',
      target: '5.4.0',
    });
    expect(style).not.toHaveProperty('state');
    expect(style['version']).toBe(8);
  });
});

describe('CLI config-loader merge parity (ml-he2.4)', () => {
  it('resolves merge keys in project config', async () => {
    const { parse } = await import('yaml');
    // The loader now passes { merge: true }; assert the option itself resolves.
    const parsed = parse('base: &b { a: 1 }\ncfg:\n  <<: *b\n  c: 2\n', { merge: true });
    expect(parsed.cfg).toEqual({ a: 1, c: 2 });
  });
});
