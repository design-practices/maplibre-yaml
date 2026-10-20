/**
 * @file Versions of the sibling packages the scaffolds depend on
 *
 * @description
 * `init --template astro` writes a package.json that depends on
 * `@maplibre-yaml/core` and `@maplibre-yaml/astro`. Hard-coded ranges went
 * stale (0.4.2 still scaffolded core ^0.7.0 after 0.8 shipped, ml-aot.32), so
 * the versions are baked in when the CLI is built, from the workspace
 * packages' own package.json (tsup.config.ts and vitest.config.ts define
 * them). A CLI release therefore always scaffolds the core and astro lines it
 * was built with.
 */

declare const __MLYM_CORE_VERSION__: string;
declare const __MLYM_ASTRO_VERSION__: string;

/** `@maplibre-yaml/core`'s version at build time. */
export const CORE_VERSION: string = __MLYM_CORE_VERSION__;

/** `@maplibre-yaml/astro`'s version at build time. */
export const ASTRO_VERSION: string = __MLYM_ASTRO_VERSION__;

/**
 * The caret range a scaffold depends on: `"0.8.3"` → `"^0.8.0"`, `"1.2.3"` →
 * `"^1.2.0"`. Starting at `.0` of the minor keeps a scaffold installable the
 * moment a minor is published, and a 0.x caret never crosses a minor.
 */
export function caretRange(version: string): string {
  const [major = '0', minor = '0'] = version.split('-')[0]!.split('.');
  return `^${major}.${minor}.0`;
}

/**
 * The CDN minor pin a plain-HTML scaffold loads: `"0.9.2"` → `"0.9"`
 * (`https://unpkg.com/@maplibre-yaml/core@0.9/register.js` is the newest
 * 0.9.x). Taken from the version the CLI was built with, so a scaffold never
 * points at an older line (ml-aot.92).
 */
export function minorPin(version: string): string {
  const [major = '0', minor = '0'] = version.split('-')[0]!.split('.');
  return `${major}.${minor}`;
}
