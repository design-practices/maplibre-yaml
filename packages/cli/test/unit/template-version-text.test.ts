/**
 * Template text never names a maplibre-yaml version other than the one the
 * CLI was built with (ml-aot.145).
 *
 * The plain-HTML templates' CDN pin comes from `{{coreMinor}}`, but the
 * comment beside it was hand-written and still said `"@0.8"` after 0.9
 * shipped, so every new project told its reader the wrong release line. A
 * version in template text must come from a template variable
 * (`{{coreMinor}}`, `{{coreRange}}`, `{{astroRange}}`); this test fails on a
 * literal one, and checks that every version the scaffolded files name is
 * core's (or, for the astro dependency, astro's) current minor.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveVariables } from '../../src/lib/template-engine';
import { versionVariables } from '../../src/lib/package-versions';

const CLI_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const TEMPLATES = join(CLI_ROOT, 'templates');

/** `"0.9"` for core at 0.9.x, read from the package itself, not the build define. */
function minorOf(pkg: 'core' | 'astro'): string {
  const { version } = JSON.parse(
    readFileSync(join(CLI_ROOT, '..', pkg, 'package.json'), 'utf-8'),
  ) as { version: string };
  const [major, minor] = version.split('-')[0]!.split('.');
  return `${major}.${minor}`;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (entry !== 'template.json') out.push(path);
  }
  return out;
}

const FILES = walk(TEMPLATES).map((path) => ({
  path,
  name: relative(TEMPLATES, path),
  text: readFileSync(path, 'utf-8'),
}));

/**
 * Ways template text names a maplibre-yaml version. Third-party versions
 * (`maplibre-gl@6`, `"astro": "^7.4.0"`, the Node engine) are not matched.
 * Each pattern's first group is the package (or undefined for core), the
 * second the `<major>.<minor>` it names.
 */
const VERSION_TEXT: RegExp[] = [
  // A CDN pin: @maplibre-yaml/core@0.9
  /@maplibre-yaml\/(core|astro|cli)@(\d+\.\d+)/g,
  // A dependency range: "@maplibre-yaml/core": "^0.9.0"
  /"@maplibre-yaml\/(core|astro|cli)":\s*"[~^]?(\d+\.\d+)/g,
  // A bare pin in prose: "@0.9" (not preceded by a package name)
  /(?<![\w./-])@()(\d+\.\d+)(?![\d])/g,
  // A release line in prose: 0.9.x
  /(?<![\w.])()(\d+\.\d+)\.x\b/g,
  // The docs site's versioned schema path: /schema/v0.9/
  /\/schema\/v()(\d+\.\d+)\//g,
];

function versionMentions(text: string): { pkg: string; minor: string; match: string }[] {
  return VERSION_TEXT.flatMap((pattern) =>
    [...text.matchAll(pattern)].map((m) => ({ pkg: m[1] || 'core', minor: m[2]!, match: m[0] })),
  );
}

describe('template version text (ml-aot.145)', () => {
  it('finds the templates', () => {
    const names = FILES.map((f) => f.name);
    expect(names).toContain('basic/index.html');
    expect(names).toContain('story/index.html');
    expect(names).toContain('astro/package.json.template');
  });

  it('names no maplibre-yaml version as a literal: each comes from a template variable', () => {
    const literal = FILES.flatMap((f) =>
      versionMentions(f.text).map((m) => `${f.name}: ${m.match}`),
    );
    expect(literal).toEqual([]);
  });

  it('scaffolds files whose every version is the current minor of its package', () => {
    const want: Record<string, string> = { core: minorOf('core'), astro: minorOf('astro') };
    const variables = {
      projectName: 'my-map',
      title: 'My Story Map',
      mapCenter: '[0, 0]',
      ...versionVariables(),
    };
    const wrong: string[] = [];
    const counts: Record<string, number> = {};
    for (const f of FILES) {
      const rendered = resolveVariables(f.text, variables);
      for (const m of versionMentions(rendered)) {
        counts[f.name] = (counts[f.name] ?? 0) + 1;
        if (m.minor !== want[m.pkg]) wrong.push(`${f.name}: ${m.match} (want ${m.pkg} ${want[m.pkg]})`);
      }
    }
    expect(wrong).toEqual([]);
    // Non-vacuous: the plain-HTML pages name the release line twice (the pin
    // and the comment explaining it); the astro package.json names core and astro.
    expect(counts['basic/index.html']).toBeGreaterThanOrEqual(2);
    expect(counts['story/index.html']).toBeGreaterThanOrEqual(2);
    expect(counts['astro/package.json.template']).toBe(2);
  });
});
