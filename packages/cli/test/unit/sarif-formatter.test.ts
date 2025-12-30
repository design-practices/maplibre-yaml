import { describe, it, expect } from 'vitest';
import { formatSARIF } from '../../src/lib/sarif-formatter.js';
import type { ValidationResult } from '../../src/types.js';

describe('SARIF formatter', () => {
  it('produces valid SARIF 2.1.0 format', () => {
    const results: ValidationResult[] = [{
      file: '/path/to/test.yaml',
      valid: true,
      errors: [],
      warnings: [],
    }];

    const output = formatSARIF(results, '1.0.0');
    const parsed = JSON.parse(output);

    expect(parsed.version).toBe('2.1.0');
    expect(parsed.$schema).toBe('https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json');
    expect(parsed.runs).toBeInstanceOf(Array);
    expect(parsed.runs).toHaveLength(1);
  });

  it('includes tool information', () => {
    const results: ValidationResult[] = [];
    const output = formatSARIF(results, '1.2.3');
    const parsed = JSON.parse(output);

    expect(parsed.runs[0].tool.driver.name).toBe('maplibre-yaml');
    expect(parsed.runs[0].tool.driver.version).toBe('1.2.3');
  });

  it('converts errors to SARIF results', () => {
    const results: ValidationResult[] = [{
      file: '/path/to/test.yaml',
      valid: false,
      errors: [{
        path: 'config.center',
        message: 'Expected array, got string',
        line: 5,
        column: 10,
        severity: 'error',
      }],
      warnings: [],
    }];

    const output = formatSARIF(results, '1.0.0');
    const parsed = JSON.parse(output);

    expect(parsed.runs[0].results).toHaveLength(1);
    const result = parsed.runs[0].results[0];
    expect(result.level).toBe('error');
    expect(result.message.text).toContain('config.center');
    expect(result.message.text).toContain('Expected array, got string');
  });

  it('includes location information', () => {
    const results: ValidationResult[] = [{
      file: '/path/to/test.yaml',
      valid: false,
      errors: [{
        path: 'layers[0]',
        message: 'Invalid layer type',
        line: 10,
        column: 5,
        severity: 'error',
      }],
      warnings: [],
    }];

    const output = formatSARIF(results, '1.0.0');
    const parsed = JSON.parse(output);

    const location = parsed.runs[0].results[0].locations[0];
    expect(location.physicalLocation.artifactLocation.uri).toBe('/path/to/test.yaml');
    expect(location.physicalLocation.region).toBeDefined();
    expect(location.physicalLocation.region.startLine).toBe(10);
    expect(location.physicalLocation.region.startColumn).toBe(5);
  });

  it('handles warnings as SARIF warnings', () => {
    const results: ValidationResult[] = [{
      file: '/path/to/test.yaml',
      valid: true,
      errors: [],
      warnings: [{
        path: 'layers[0].paint',
        message: 'Deprecated property',
        line: 15,
        column: 3,
        severity: 'warning',
      }],
    }];

    const output = formatSARIF(results, '1.0.0');
    const parsed = JSON.parse(output);

    expect(parsed.runs[0].results).toHaveLength(1);
    expect(parsed.runs[0].results[0].level).toBe('warning');
  });

  it('handles multiple files', () => {
    const results: ValidationResult[] = [
      {
        file: '/path/to/test1.yaml',
        valid: false,
        errors: [{ path: '', message: 'Error 1', severity: 'error' }],
        warnings: [],
      },
      {
        file: '/path/to/test2.yaml',
        valid: false,
        errors: [{ path: '', message: 'Error 2', severity: 'error' }],
        warnings: [],
      },
    ];

    const output = formatSARIF(results, '1.0.0');
    const parsed = JSON.parse(output);

    expect(parsed.runs[0].results).toHaveLength(2);
    expect(parsed.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri).toContain('test1.yaml');
    expect(parsed.runs[0].results[1].locations[0].physicalLocation.artifactLocation.uri).toContain('test2.yaml');
  });

  it('omits region when line and column not provided', () => {
    const results: ValidationResult[] = [{
      file: '/path/to/test.yaml',
      valid: false,
      errors: [{
        path: '',
        message: 'Generic error',
        severity: 'error',
      }],
      warnings: [],
    }];

    const output = formatSARIF(results, '1.0.0');
    const parsed = JSON.parse(output);

    const physicalLocation = parsed.runs[0].results[0].locations[0].physicalLocation;
    expect(physicalLocation.artifactLocation.uri).toBe('/path/to/test.yaml');
    expect(physicalLocation.region).toBeUndefined();
  });

  it('handles empty results', () => {
    const results: ValidationResult[] = [];
    const output = formatSARIF(results, '1.0.0');
    const parsed = JSON.parse(output);

    expect(parsed.runs[0].results).toHaveLength(0);
  });

  it('includes rule information for structured errors', () => {
    const results: ValidationResult[] = [{
      file: '/path/to/test.yaml',
      valid: false,
      errors: [{
        path: 'config',
        message: 'Missing required property',
        severity: 'error',
      }],
      warnings: [],
    }];

    const output = formatSARIF(results, '1.0.0');
    const parsed = JSON.parse(output);

    expect(parsed.runs[0].results[0]).toHaveProperty('ruleId');
  });
});
