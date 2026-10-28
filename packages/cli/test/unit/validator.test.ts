import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { validateFile, validateFiles, validateFilesParallel } from '../../src/lib/validator.js';

const FORMATS = './test/fixtures/formats';

describe('validator', () => {
  describe('validateFile', () => {
    it('returns valid for correct basic config', async () => {
      const result = await validateFile('./test/fixtures/valid-basic.yaml');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('returns valid for config with layers', async () => {
      const result = await validateFile('./test/fixtures/valid-with-layers.yaml');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('returns valid for scrollytelling config', async () => {
      const result = await validateFile('./test/fixtures/valid-scrollytelling.yaml');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('returns valid for root pages document', async () => {
      const result = await validateFile('./test/fixtures/valid-root.yaml');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('returns clear error for unknown block type', async () => {
      const result = await validateFile('./test/fixtures/invalid-unknown-type.yaml');
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].path).toBe('type');
      expect(result.errors[0].message).toContain('map, scrollytelling');
    });

    it('returns errors for complex invalid config', async () => {
      const result = await validateFile('./test/fixtures/invalid-complex.yaml');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('returns errors for missing required fields', async () => {
      const result = await validateFile('./test/fixtures/invalid-missing-config.yaml');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toHaveProperty('message');
      expect(result.errors[0]).toHaveProperty('severity', 'error');
    });

    it('returns errors for invalid YAML syntax', async () => {
      const result = await validateFile('./test/fixtures/invalid-yaml-syntax.yaml');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toContain('YAML');
    });

    it('returns errors for bad layer type', async () => {
      const result = await validateFile('./test/fixtures/invalid-bad-layer.yaml');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('returns file not found error for missing file', async () => {
      const result = await validateFile('./nonexistent.yaml');
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('not found');
      expect(result.errors[0].path).toBe('');
    });

    it('includes file path in result', async () => {
      const result = await validateFile('./test/fixtures/valid-basic.yaml');
      expect(result.file).toBe('./test/fixtures/valid-basic.yaml');
    });

    it('includes line numbers when available', async () => {
      const result = await validateFile('./test/fixtures/invalid-bad-layer.yaml');
      const errorWithLine = result.errors.find(e => e.line !== undefined);
      // Line numbers may or may not be available depending on error type
      if (errorWithLine) {
        expect(typeof errorWithLine.line).toBe('number');
      }
    });
  });

  describe('validateFiles', () => {
    it('validates multiple files in parallel', async () => {
      const results = await validateFiles([
        './test/fixtures/valid-basic.yaml',
        './test/fixtures/valid-with-layers.yaml',
      ]);
      expect(results).toHaveLength(2);
      expect(results.every(r => r.valid)).toBe(true);
    });

    it('returns results for mix of valid and invalid files', async () => {
      const results = await validateFiles([
        './test/fixtures/valid-basic.yaml',
        './test/fixtures/invalid-missing-config.yaml',
      ]);
      expect(results).toHaveLength(2);
      expect(results[0].valid).toBe(true);
      expect(results[1].valid).toBe(false);
    });

    it('handles empty array', async () => {
      const results = await validateFiles([]);
      expect(results).toHaveLength(0);
    });

    it('validates all fixtures', async () => {
      const results = await validateFiles([
        './test/fixtures/valid-basic.yaml',
        './test/fixtures/valid-with-layers.yaml',
        './test/fixtures/invalid-missing-config.yaml',
        './test/fixtures/invalid-yaml-syntax.yaml',
        './test/fixtures/invalid-bad-layer.yaml',
        './test/fixtures/invalid-complex.yaml',
      ]);
      expect(results).toHaveLength(6);
      const validCount = results.filter(r => r.valid).length;
      const invalidCount = results.filter(r => !r.valid).length;
      expect(validCount).toBe(2);
      expect(invalidCount).toBe(4);
    });
  });

  describe('validateFilesParallel', () => {
    it('validates files with concurrency limit', async () => {
      const files = [
        './test/fixtures/valid-basic.yaml',
        './test/fixtures/valid-with-layers.yaml',
      ];
      const results = await validateFilesParallel(files, 2);
      expect(results).toHaveLength(2);
      expect(results.every(r => r.valid)).toBe(true);
    });

    it('uses default concurrency of 10', async () => {
      const files = [
        './test/fixtures/valid-basic.yaml',
        './test/fixtures/valid-with-layers.yaml',
      ];
      const results = await validateFilesParallel(files);
      expect(results).toHaveLength(2);
    });

    it('processes files in batches', async () => {
      const files = Array(5).fill('./test/fixtures/valid-basic.yaml');
      const results = await validateFilesParallel(files, 2);
      expect(results).toHaveLength(5);
      expect(results.every(r => r.valid)).toBe(true);
    });
  });

  // R1, R6, R7: JSON and TOML documents through the front door.
  describe('JSON and TOML documents', () => {
    const dirs: string[] = [];
    const tempFile = (name: string, text: string) => {
      const d = mkdtempSync(join(tmpdir(), 'mlym-validator-'));
      dirs.push(d);
      writeFileSync(join(d, name), text);
      return join(d, name);
    };
    afterAll(() => {
      for (const d of dirs) rmSync(d, { recursive: true, force: true });
    });

    it('validates a JSON map and a TOML map', async () => {
      for (const file of [`${FORMATS}/folder/map.json`, `${FORMATS}/folder/map.toml`, `${FORMATS}/quick-start.toml`]) {
        const result = await validateFile(file);
        expect(result.errors, file).toEqual([]);
        expect(result.valid, file).toBe(true);
      }
    });

    it('a JSON syntax error says "JSON syntax error", at its line and column', async () => {
      const result = await validateFile(`${FORMATS}/bad.json`);
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toMatch(/^JSON syntax error:/);
      expect(result.errors[0].message).not.toContain('YAML');
      expect(result.errors[0]).toMatchObject({ line: 6, column: 5 });
    });

    it('a TOML syntax error says "TOML syntax error", at a TOML line and column', async () => {
      const result = await validateFile(`${FORMATS}/bad.toml`);
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toMatch(/^TOML syntax error:/);
      expect(result.errors[0]).toMatchObject({ line: 5, column: 1 });
    });

    it('TOML schema findings point at the TOML line and column', async () => {
      const result = await validateFile(`${FORMATS}/quick-start-planted.toml`);
      expect(result.errors).toEqual([
        expect.objectContaining({ path: 'config.zoom', line: 7, column: 8 }),
      ]);
      expect(result.warnings).toContainEqual(
        expect.objectContaining({ path: 'layers.0.interactive.click.popup.1.p.1.format.max-fraction-digit', line: 35, column: 34 })
      );
    });

    it('a missing top-level key has no stand-in location in JSON or TOML (ml-aot.54)', async () => {
      const json = await validateFile(tempFile('no-config.json', '{\n  "type": "map",\n  "id": "x",\n  "layers": []\n}\n'));
      const toml = await validateFile(tempFile('no-config.toml', 'type = "map"\nid = "x"\nlayers = []\n'));
      for (const result of [json, toml]) {
        const missing = result.errors.find((e) => e.path === 'config');
        expect(missing).toBeDefined();
        expect(missing!.line).toBeUndefined();
      }
    });

    it('a TOML table header at column 1 keeps its location', async () => {
      const result = await validateFile(tempFile('no-center.toml', 'type = "map"\nid = "x"\n[config]\nzoom = 1\n'));
      expect(result.errors.find((e) => e.path === 'config.center')).toMatchObject({ line: 3, column: 1 });
    });

    it('a file with a byte-order mark validates, in YAML and JSON', async () => {
      const yaml = readFileSync('./test/fixtures/valid-basic.yaml', 'utf-8');
      const json = readFileSync(`${FORMATS}/folder/map.json`, 'utf-8');
      for (const file of [tempFile('bom.yaml', '\uFEFF' + yaml), tempFile('bom.json', '\uFEFF' + json)]) {
        const result = await validateFile(file);
        expect(result.errors, file).toEqual([]);
        expect(result.valid, file).toBe(true);
      }
    });
  });
});
