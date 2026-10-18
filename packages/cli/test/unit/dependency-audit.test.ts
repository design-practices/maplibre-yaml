/**
 * Installing the CLI must not pull in dependencies with known advisories
 * that can be fixed without dropping a supported Node version (ml-aot.56).
 * `npm install @maplibre-yaml/cli` used to report 8 vulnerabilities (7 high),
 * "no fix available":
 *
 * - vite <= 6.4.2 (and esbuild <= 0.24.2 through vite 5): dev-server path
 *   traversal / fs.deny bypass / launch-editor;
 * - braces <= 3.0.3 (every release): through chokidar 3 and
 *   fast-glob -> micromatch. braces has no fixed version, so the chain has
 *   to go: chokidar 4 dropped glob support (and braces), and tinyglobby
 *   (picomatch) replaces fast-glob.
 * - sharp < 0.35.5: libvips, libheif and librsvg advisories. NOT fixed here:
 *   sharp 0.35 needs Node 20.9+ (it throws on import under Node 18, which the
 *   CLI and this repo's CI still support). sharp only decodes the author's
 *   own sprite images (`emit`/`bake`), not downloaded input. Moving to 0.35
 *   means raising engines.node -- a support-policy decision for a release
 *   of its own. This test keeps the pin exact (raster determinism) and the
 *   engines range in step with it.
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
  it('vite is past 6.4.2 (dev-server advisories; vite 5 also brought old esbuild)', () => {
    expect(atLeast(deps.vite!, [6, 4, 3]), deps.vite).toBe(true);
  });

  it('nothing pulls in braces: chokidar 4+, no fast-glob/micromatch', () => {
    expect(atLeast(deps.chokidar!, [4, 0, 0]), deps.chokidar).toBe(true);
    expect(deps['fast-glob']).toBeUndefined();
    expect(deps.micromatch).toBeUndefined();
    expect(deps.braces).toBeUndefined();
  });

  it('sharp stays pinned exactly, and on a line that runs on every Node the CLI supports', () => {
    expect(deps.sharp).toMatch(/^\d+\.\d+\.\d+$/);
    // sharp 0.35 needs Node >= 20.9; while engines admits Node 18, stay on 0.34.
    const supports18 = /\^18\./.test(pkg.engines.node);
    if (supports18) expect(atLeast(deps.sharp!, [0, 35, 0]), deps.sharp).toBe(false);
  });
});
