import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { validateFiles, validateFilesParallel } from '../src/lib/validator.js';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'pathe';

describe('performance', () => {
  const tempDir = join(process.cwd(), 'test/.temp-perf');

  beforeAll(() => {
    // Create 100 test files
    mkdirSync(tempDir, { recursive: true });

    const validConfig = `type: map
id: test
config:
  center: [0, 0]
  zoom: 5
  mapStyle: "https://demotiles.maplibre.org/style.json"
layers: []
`;

    for (let i = 0; i < 100; i++) {
      writeFileSync(join(tempDir, `config-${i}.yaml`), validConfig);
    }
  });

  afterAll(() => {
    // Clean up temp directory
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('validates 100 files in under 5 seconds', async () => {
    const files = Array.from({ length: 100 }, (_, i) =>
      join(tempDir, `config-${i}.yaml`)
    );

    const start = performance.now();
    const results = await validateFiles(files);
    const duration = performance.now() - start;

    expect(results).toHaveLength(100);
    expect(results.every(r => r.valid)).toBe(true);
    expect(duration).toBeLessThan(5000);

    console.log(`Validated 100 files in ${duration.toFixed(0)}ms`);
  }, 10000); // 10 second timeout

  it('parallel validation is faster than sequential for large sets', async () => {
    const files = Array.from({ length: 50 }, (_, i) =>
      join(tempDir, `config-${i}.yaml`)
    );

    // Sequential (concurrency = 1)
    const startSeq = performance.now();
    await validateFilesParallel(files, 1);
    const durationSeq = performance.now() - startSeq;

    // Parallel (concurrency = 10)
    const startPar = performance.now();
    await validateFilesParallel(files, 10);
    const durationPar = performance.now() - startPar;

    expect(durationPar).toBeLessThan(durationSeq);
    console.log(`Sequential: ${durationSeq.toFixed(0)}ms, Parallel: ${durationPar.toFixed(0)}ms`);
  }, 15000);

  it('validates small files quickly', async () => {
    const file = join(tempDir, 'config-0.yaml');

    const start = performance.now();
    await validateFiles([file]);
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(100);
    console.log(`Validated 1 file in ${duration.toFixed(2)}ms`);
  });

  it('handles 10 files efficiently', async () => {
    const files = Array.from({ length: 10 }, (_, i) =>
      join(tempDir, `config-${i}.yaml`)
    );

    const start = performance.now();
    await validateFiles(files);
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(500);
    console.log(`Validated 10 files in ${duration.toFixed(0)}ms`);
  });

  it('concurrency limit prevents resource exhaustion', async () => {
    const files = Array.from({ length: 100 }, (_, i) =>
      join(tempDir, `config-${i}.yaml`)
    );

    // Should complete even with low concurrency
    const start = performance.now();
    const results = await validateFilesParallel(files, 5);
    const duration = performance.now() - start;

    expect(results).toHaveLength(100);
    expect(duration).toBeLessThan(7000);
    console.log(`Validated 100 files with concurrency=5 in ${duration.toFixed(0)}ms`);
  }, 10000);
});
