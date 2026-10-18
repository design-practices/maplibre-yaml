/**
 * Installing the CLI must not pull in dependencies with known advisories
 * (ml-aot.56). `npm install @maplibre-yaml/cli` used to report 8
 * vulnerabilities (7 high), "no fix available":
 *
 * - sharp < 0.35.5: libvips, libheif and librsvg advisories;
 * - vite <= 6.4.2 (and esbuild <= 0.24.2 through vite 5): dev-server path
 *   traversal / fs.deny bypass / launch-editor;
 * - braces <= 3.0.3 (every release): through chokidar 3 and
 *   fast-glob -> micromatch. braces has no fixed version, so the chain has
 *   to go: chokidar 4 dropped glob support (and braces), and tinyglobby
 *   (picomatch) replaces fast-glob.
 *
 * A real `npm audit` needs the network; this pins the floors so a later
 * edit cannot quietly bring a vulnerable range back.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'pathe';

const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8'));
const deps: Record<string, string> = pkg.dependencies;

/** [major, minor, patch] of the lowest version a range allows (^x.y.z, ~x.y.z or x.y.z). */
function floor(range: string): [number, number, number] {
  const m = /^[\^~]?(\d+)\.(\d+)\.(\d+)$/.exec(range.trim());
  if (!m) throw new Error(`unexpected range ${range}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}
const atLeast = (range: string, min: [number, number, number]) => {
  const f = floor(range);
  for (let i = 0; i < 3; i++) if (f[i] !== min[i]) return f[i]! > min[i]!;
  return true;
};

describe('CLI dependencies stay clear of known advisories (ml-aot.56)', () => {
  it('sharp is 0.35.5 or later (libvips/libheif/librsvg advisories)', () => {
    expect(atLeast(deps.sharp!, [0, 35, 5]), deps.sharp).toBe(true);
  });

  it('vite is past 6.4.2 (dev-server advisories; vite 5 also brought old esbuild)', () => {
    expect(atLeast(deps.vite!, [6, 4, 3]), deps.vite).toBe(true);
  });

  it('nothing pulls in braces: chokidar 4+, no fast-glob/micromatch', () => {
    expect(atLeast(deps.chokidar!, [4, 0, 0]), deps.chokidar).toBe(true);
    expect(deps['fast-glob']).toBeUndefined();
    expect(deps.micromatch).toBeUndefined();
    expect(deps.braces).toBeUndefined();
  });

  it('engines.node matches what sharp 0.35 and vite 6 need', () => {
    expect(pkg.engines.node).toBe('>=20.9.0');
  });
});
