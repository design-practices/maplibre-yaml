/**
 * Every CDN pin in the docs, READMEs, examples and e2e intercepts names the
 * current minor of its package (ml-aot.92): a pin left at the previous minor
 * sends readers to a release without the features the docs describe.
 * `pnpm version-packages` (changeset version + scripts/sync-cdn-pins.mjs)
 * moves them with each release; this guards the result.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { minorPin } from '../../src/lib/package-versions';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const SCRIPT = join(REPO, 'scripts/sync-cdn-pins.mjs');

describe('CDN pins', () => {
  it('match the current core/astro/cli minor everywhere', () => {
    let output = '';
    try {
      output = execFileSync('node', [SCRIPT, '--check'], { encoding: 'utf8', stdio: 'pipe' });
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string };
      throw new Error(`stale CDN pins:\n${e.stderr ?? ''}${e.stdout ?? ''}`);
    }
    // The walk found the pins (an empty walk would pass vacuously).
    const count = Number(/(\d+) pins match/.exec(output)?.[1] ?? 0);
    expect(count).toBeGreaterThan(15);
  });

  it('would move them all to a new minor, leaving exact versions alone', () => {
    const output = execFileSync('node', [SCRIPT, '--dry-run', '--version', 'core=7.3.0'], { encoding: 'utf8' });
    expect(output).toContain('+      src="https://unpkg.com/@maplibre-yaml/core@7.3/register.js"');
    expect(output).not.toMatch(/^\+.*core@7\.3\.0/m);
    // The docs site's versioned schema path follows core too (ml-aot.110).
    expect(output).toContain("docs.maplibre-yaml.org/schema/v7.3/<block>.schema.json");
  });

  it('minorPin takes the minor line of a version', () => {
    expect(minorPin('0.9.2')).toBe('0.9');
    expect(minorPin('1.0.0-next.3')).toBe('1.0');
  });
});
