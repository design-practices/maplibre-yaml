import { describe, it, expect } from 'vitest';
import { formatHuman, formatJSON } from '../../src/lib/formatter.js';
import type { ValidationResult } from '../../src/types.js';

describe('formatter', () => {
  describe('formatHuman', () => {
    it('formats valid result with checkmark', () => {
      const results: ValidationResult[] = [{
        file: 'test.yaml',
        valid: true,
        errors: [],
        warnings: [],
      }];

      const output = formatHuman(results);
      expect(output).toContain('✓');
      expect(output).toContain('test.yaml');
      expect(output).toContain('valid');
    });

    it('formats invalid result with errors', () => {
      const results: ValidationResult[] = [{
        file: 'test.yaml',
        valid: false,
        errors: [{
          path: 'config',
          message: 'Missing required field',
          severity: 'error',
        }],
        warnings: [],
      }];

      const output = formatHuman(results);
      expect(output).toContain('✗');
      expect(output).toContain('test.yaml');
      expect(output).toContain('error');
      expect(output).toContain('Missing required field');
    });

    it('formats warnings', () => {
      const results: ValidationResult[] = [{
        file: 'test.yaml',
        valid: true,
        errors: [],
        warnings: [{
          path: 'layers[0]',
          message: 'Deprecated property',
          severity: 'warning',
        }],
      }];

      const output = formatHuman(results);
      expect(output).toContain('warning');
      expect(output).toContain('Deprecated property');
    });

    it('includes line and column numbers when available', () => {
      const results: ValidationResult[] = [{
        file: 'test.yaml',
        valid: false,
        errors: [{
          path: 'config.center',
          message: 'Invalid type',
          line: 5,
          column: 10,
          severity: 'error',
        }],
        warnings: [],
      }];

      const output = formatHuman(results);
      expect(output).toContain(':5:10');
    });

    it('formats multiple files summary', () => {
      const results: ValidationResult[] = [
        { file: 'test1.yaml', valid: true, errors: [], warnings: [] },
        { file: 'test2.yaml', valid: true, errors: [], warnings: [] },
        { file: 'test3.yaml', valid: false, errors: [{ path: '', message: 'Error', severity: 'error' }], warnings: [] },
      ];

      const output = formatHuman(results);
      expect(output).toContain('2 file(s) valid');
      expect(output).toContain('1 file(s) with issues');
    });

    it('shows error and warning counts', () => {
      const results: ValidationResult[] = [{
        file: 'test.yaml',
        valid: false,
        errors: [
          { path: '', message: 'Error 1', severity: 'error' },
          { path: '', message: 'Error 2', severity: 'error' },
        ],
        warnings: [
          { path: '', message: 'Warning 1', severity: 'warning' },
        ],
      }];

      const output = formatHuman(results);
      expect(output).toContain('2 error');
      expect(output).toContain('1 warning');
    });
  });

  describe('formatJSON', () => {
    it('produces valid JSON', () => {
      const results: ValidationResult[] = [{
        file: 'test.yaml',
        valid: true,
        errors: [],
        warnings: [],
      }];

      const output = formatJSON(results);
      expect(() => JSON.parse(output)).not.toThrow();
    });

    it('includes all files in output', () => {
      const results: ValidationResult[] = [
        { file: 'test1.yaml', valid: true, errors: [], warnings: [] },
        { file: 'test2.yaml', valid: false, errors: [{ path: '', message: 'Error', severity: 'error' }], warnings: [] },
      ];

      const output = formatJSON(results);
      const parsed = JSON.parse(output);
      expect(parsed.files).toHaveLength(2);
      expect(parsed.files[0].file).toBe('test1.yaml');
      expect(parsed.files[1].file).toBe('test2.yaml');
    });

    it('includes summary statistics', () => {
      const results: ValidationResult[] = [
        { file: 'test1.yaml', valid: true, errors: [], warnings: [] },
        { file: 'test2.yaml', valid: false, errors: [{ path: '', message: 'Error', severity: 'error' }], warnings: [] },
      ];

      const output = formatJSON(results);
      const parsed = JSON.parse(output);
      expect(parsed.summary).toHaveProperty('total', 2);
      expect(parsed.summary).toHaveProperty('valid', 1);
      expect(parsed.summary).toHaveProperty('invalid', 1);
      expect(parsed.summary).toHaveProperty('errorCount', 1);
    });

    it('sets overall valid flag correctly', () => {
      const validResults: ValidationResult[] = [
        { file: 'test1.yaml', valid: true, errors: [], warnings: [] },
      ];
      const invalidResults: ValidationResult[] = [
        { file: 'test1.yaml', valid: true, errors: [], warnings: [] },
        { file: 'test2.yaml', valid: false, errors: [{ path: '', message: 'Error', severity: 'error' }], warnings: [] },
      ];

      const validOutput = JSON.parse(formatJSON(validResults));
      const invalidOutput = JSON.parse(formatJSON(invalidResults));

      expect(validOutput.valid).toBe(true);
      expect(invalidOutput.valid).toBe(false);
    });

    it('includes error details', () => {
      const results: ValidationResult[] = [{
        file: 'test.yaml',
        valid: false,
        errors: [{
          path: 'config.center',
          message: 'Expected array',
          line: 5,
          column: 10,
          severity: 'error',
        }],
        warnings: [],
      }];

      const output = formatJSON(results);
      const parsed = JSON.parse(output);
      expect(parsed.files[0].errors[0]).toHaveProperty('path', 'config.center');
      expect(parsed.files[0].errors[0]).toHaveProperty('message', 'Expected array');
      expect(parsed.files[0].errors[0]).toHaveProperty('line', 5);
      expect(parsed.files[0].errors[0]).toHaveProperty('column', 10);
    });
  });
});
