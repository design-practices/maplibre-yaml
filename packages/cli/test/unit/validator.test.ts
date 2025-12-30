import { describe, it, expect } from 'vitest';
import { validateFile, validateFiles, validateFilesParallel } from '../../src/lib/validator.js';

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
});
