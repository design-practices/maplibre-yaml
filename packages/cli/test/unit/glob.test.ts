import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, cpSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolveGlobPatterns, resolveTargets, looksLikeDocument } from '../../src/lib/glob.js';
import { validateFile } from '../../src/lib/validator.js';
import { resolve, relative, join, basename } from 'pathe';

const FOLDER = resolve('test/fixtures/formats/folder');
const names = (files: string[]) => files.map((f) => basename(f));

describe('glob', () => {
  describe('resolveGlobPatterns', () => {
    it('resolves single glob pattern', async () => {
      const files = await resolveGlobPatterns(['test/fixtures/*.yaml']);
      expect(files.length).toBeGreaterThan(0);
      expect(files.every(f => f.endsWith('.yaml'))).toBe(true);
    });

    it('resolves multiple patterns', async () => {
      const files = await resolveGlobPatterns([
        'test/fixtures/valid-*.yaml',
        'test/fixtures/invalid-*.yaml',
      ]);
      expect(files.length).toBeGreaterThan(0);
      expect(files).toContain(resolve('test/fixtures/valid-basic.yaml'));
      expect(files).toContain(resolve('test/fixtures/invalid-missing-config.yaml'));
    });

    it('returns absolute paths', async () => {
      const files = await resolveGlobPatterns(['test/fixtures/valid-basic.yaml']);
      expect(files.length).toBe(1);
      expect(files[0]).toMatch(/^[/\\]/); // Starts with / or \
      expect(files[0]).toContain('valid-basic.yaml');
    });

    it('returns sorted results', async () => {
      const files = await resolveGlobPatterns(['test/fixtures/*.yaml']);
      const sorted = [...files].sort();
      expect(files).toEqual(sorted);
    });

    it('respects custom cwd option', async () => {
      const files = await resolveGlobPatterns(['fixtures/*.yaml'], {
        cwd: resolve('test'),
      });
      expect(files.length).toBeGreaterThan(0);
    });

    it('respects ignore patterns', async () => {
      const files = await resolveGlobPatterns(['test/fixtures/*.yaml'], {
        ignore: ['**/invalid-*.yaml'],
      });
      expect(files.length).toBeGreaterThan(0);
      expect(files.every(f => !f.includes('invalid'))).toBe(true);
      expect(files.some(f => f.includes('valid'))).toBe(true);
    });

    it('uses default ignore patterns for node_modules', async () => {
      const files = await resolveGlobPatterns(['**/*.yaml'], {
        cwd: resolve('.'),
      });
      expect(files.every(f => !f.includes('node_modules'))).toBe(true);
    });

    it('returns empty array for no matches', async () => {
      const files = await resolveGlobPatterns(['test/fixtures/*.nonexistent']);
      expect(files).toEqual([]);
    });

    it('handles ** recursive patterns', async () => {
      const files = await resolveGlobPatterns(['test/**/valid-*.yaml']);
      expect(files.length).toBeGreaterThan(0);
      expect(files.some(f => f.includes('valid-basic.yaml'))).toBe(true);
    });

    it('returns only files, not directories', async () => {
      const files = await resolveGlobPatterns(['test/**']);
      // All results should be files
      expect(files.every(f => !f.endsWith('/'))).toBe(true);
    });

    it('does not return hidden files by default', async () => {
      const files = await resolveGlobPatterns(['test/**/*']);
      expect(files.every(f => {
        // Only inspect segments below the working directory -- the absolute
        // prefix may legitimately contain dot-directories (e.g. worktrees)
        const parts = relative(process.cwd(), f).split('/');
        return !parts.some(part => part.startsWith('.') && part !== '.');
      })).toBe(true);
    });
  });

  // Folder discovery of JSON and TOML documents (KTD11, R14).
  describe('resolveTargets: JSON and TOML under a folder', () => {
    const dirs: string[] = [];
    const tempDir = () => {
      const d = mkdtempSync(join(tmpdir(), 'mlym-glob-'));
      dirs.push(d);
      return d;
    };
    afterAll(() => {
      for (const d of dirs) rmSync(d, { recursive: true, force: true });
    });

    it('AE4: joins map.json and map.toml, skips package.json, style.json, GeoJSON and pyproject.toml', async () => {
      const { files, skipped, unmatched, emptyFolders } = await resolveTargets([FOLDER]);
      expect(names(files)).toEqual(['map.json', 'map.toml']);
      expect(names(skipped)).toEqual(['package.json', 'points.json', 'pyproject.toml', 'style.json']);
      expect(unmatched).toEqual([]);
      expect(emptyFolders).toEqual([]);
    });

    it('a broken JSON map still joins (the sniff reads raw text, not a parse)', async () => {
      const dir = tempDir();
      writeFileSync(join(dir, 'broken.json'), '{\n  "type": "map",\n  "id": "x"\n  "config": {\n');
      const { files } = await resolveTargets([dir]);
      expect(names(files)).toEqual(['broken.json']);
    });

    it('joins on a pages key or a $schema under docs.maplibre-yaml.org/schema/, in either format', async () => {
      const dir = tempDir();
      writeFileSync(join(dir, 'root.json'), '{ "pages": [] }');
      writeFileSync(join(dir, 'root.toml'), '[[pages]]\npath = "/"\n');
      writeFileSync(join(dir, 'typeless.json'), '{ "$schema": "https://docs.maplibre-yaml.org/schema/latest/map.schema.json", "id": "x" }');
      writeFileSync(join(dir, 'typeless.toml'), '#:schema https://docs.maplibre-yaml.org/schema/latest/map.schema.json\nid = "x"\n');
      writeFileSync(join(dir, 'story.toml'), "type = 'scrollytelling'\nid = \"s\"\n");
      writeFileSync(join(dir, 'other-schema.json'), '{ "$schema": "https://json.schemastore.org/package.json" }');
      const { files, skipped } = await resolveTargets([dir]);
      expect(names(files)).toEqual(['root.json', 'root.toml', 'story.toml', 'typeless.json', 'typeless.toml']);
      expect(names(skipped)).toEqual(['other-schema.json']);
    });

    it('a type nested under a TOML table does not count unless it starts a line', async () => {
      const dir = tempDir();
      writeFileSync(join(dir, 'wrangler.toml'), 'name = "worker"\n[vars]\nKIND = "type = \'map\'"\n');
      expect(await looksLikeDocument(join(dir, 'wrangler.toml'))).toBe(false);
    });

    it('reads past a byte-order mark', async () => {
      const dir = tempDir();
      writeFileSync(join(dir, 'bom.toml'), '\uFEFFtype = "map"\n');
      expect(await looksLikeDocument(join(dir, 'bom.toml'))).toBe(true);
    });

    it('reads the first and the last 64 KB: a JSON document whose sorted keys put type last joins', async () => {
      const dir = tempDir();
      // `jq -S` / `sort_keys=True`: config, id, layers (big inline data), then type.
      const features = Array.from({ length: 1500 }, (_, i) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [i % 180, 0] },
        properties: { name: `point ${i}` },
      }));
      const sorted = {
        config: { center: [0, 0], mapStyle: 'https://demotiles.maplibre.org/style.json', zoom: 1 },
        id: 'big',
        layers: [{ id: 'dots', source: { data: { features, type: 'FeatureCollection' }, type: 'geojson' }, type: 'circle' }],
        type: 'map',
      };
      const text = JSON.stringify(sorted, null, 2);
      expect(text.length).toBeGreaterThan(128 * 1024);
      writeFileSync(join(dir, 'sorted.json'), text);
      const { files, skipped } = await resolveTargets([dir]);
      expect(names(files)).toEqual(['sorted.json']);
      expect(skipped).toEqual([]);
    });

    it('a large GeoJSON FeatureCollection is still skipped, read at both ends', async () => {
      const dir = tempDir();
      const features = Array.from({ length: 1500 }, (_, i) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [i % 180, 0] },
        properties: { name: `point ${i}` },
      }));
      const text = JSON.stringify({ type: 'FeatureCollection', features }, null, 2);
      expect(text.length).toBeGreaterThan(128 * 1024);
      writeFileSync(join(dir, 'points.json'), text);
      const { files, skipped } = await resolveTargets([dir]);
      expect(files).toEqual([]);
      expect(names(skipped)).toEqual(['points.json']);
    });

    it('a mark only in the middle of a large file is not read: the file is skipped', async () => {
      const dir = tempDir();
      const pad = 'x'.repeat(70 * 1024);
      writeFileSync(join(dir, 'middle.json'), '{ "a": "' + pad + '", "type": "map", "b": "' + pad + '" }');
      const { files, skipped } = await resolveTargets([dir]);
      expect(files).toEqual([]);
      expect(names(skipped)).toEqual(['middle.json']);
    });

    it('a candidate that vanishes before it is read is skipped', async () => {
      const dir = tempDir();
      expect(await looksLikeDocument(join(dir, 'gone.json'))).toBe(false);
    });

    // chmod 000 does not stop root, and Windows has no such mode.
    const canChmod = process.platform !== 'win32' && process.getuid?.() !== 0;
    it.skipIf(!canChmod)('an unreadable candidate joins the run (and fails there), rather than vanishing', async () => {
      const dir = tempDir();
      const file = join(dir, 'locked.json');
      writeFileSync(file, '{ "type": "map" }');
      chmodSync(file, 0o000);
      try {
        expect(await looksLikeDocument(file)).toBe(true);
        const { files, skipped } = await resolveTargets([dir]);
        expect(names(files)).toEqual(['locked.json']);
        expect(skipped).toEqual([]);
        const result = await validateFile(file);
        expect(result.valid).toBe(false);
        expect(result.errors[0]!.message).toContain('Failed to read file');
      } finally {
        chmodSync(file, 0o644);
      }
    });

    it('skips maplibre-yaml.config.json by name, whatever it holds', async () => {
      const dir = tempDir();
      writeFileSync(join(dir, 'maplibre-yaml.config.json'), '{ "type": "map", "validate": { "strict": true } }');
      writeFileSync(join(dir, 'map.yaml'), 'type: map\n');
      const { files, skipped } = await resolveTargets([dir]);
      expect(names(files)).toEqual(['map.yaml']);
      expect(names(skipped)).toEqual(['maplibre-yaml.config.json']);
    });

    it('a glob keeps today\'s behaviour: every match, no sniff', async () => {
      const { files, skipped } = await resolveTargets([relative(process.cwd(), FOLDER) + '/**/*.json']);
      expect(names(files)).toEqual(['map.json', 'package.json', 'points.json', 'style.json']);
      expect(skipped).toEqual([]);
    });

    it('a file named explicitly always joins', async () => {
      const { files } = await resolveTargets([join(FOLDER, 'package.json')]);
      expect(names(files)).toEqual(['package.json']);
    });

    it('a file named explicitly and also found through its folder is listed once, and not as skipped', async () => {
      const { files, skipped } = await resolveTargets([FOLDER, join(FOLDER, 'map.toml'), join(FOLDER, 'style.json')]);
      expect(names(files)).toEqual(['map.json', 'map.toml', 'style.json']);
      expect(names(skipped)).toEqual(['package.json', 'points.json', 'pyproject.toml']);
    });

    it('YAML discovery is unchanged: every .yaml and .yml file joins, document or not', async () => {
      const dir = tempDir();
      writeFileSync(join(dir, 'notes.yaml'), 'title: not a map\n');
      writeFileSync(join(dir, 'map.yml'), 'type: map\n');
      const { files, skipped } = await resolveTargets([dir]);
      expect(names(files)).toEqual(['map.yml', 'notes.yaml']);
      expect(skipped).toEqual([]);
    });

    it('a folder with no documents is reported as an empty folder, not as unmatched', async () => {
      const dir = tempDir();
      cpSync(join(FOLDER, 'package.json'), join(dir, 'package.json'));
      const { files, unmatched, emptyFolders, skipped } = await resolveTargets([dir]);
      expect(files).toEqual([]);
      expect(unmatched).toEqual([]);
      expect(emptyFolders).toEqual([dir]);
      expect(names(skipped)).toEqual(['package.json']);
    });
  });
});
