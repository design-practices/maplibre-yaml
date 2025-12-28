import { describe, it, expect } from 'vitest';
import { validateFile } from '../src/lib/validator.js';

describe('validate command', () => {
  it('validates a correct basic config', async () => {
    const result = await validateFile('./test/fixtures/valid-basic.yaml');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validates a config with layers', async () => {
    const result = await validateFile('./test/fixtures/valid-with-layers.yaml');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('catches missing required fields', async () => {
    const result = await validateFile('./test/fixtures/invalid-missing-config.yaml');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('handles file not found', async () => {
    const result = await validateFile('./nonexistent.yaml');
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain('not found');
  });
});
