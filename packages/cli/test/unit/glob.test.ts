import { describe, it, expect } from 'vitest';
import { resolveGlobPatterns } from '../../src/lib/glob.js';
import { resolve } from 'pathe';

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
        const parts = f.split('/');
        return !parts.some(part => part.startsWith('.') && part !== '.');
      })).toBe(true);
    });
  });
});
