/**
 * Build-time constants for src/lib/package-versions.ts, shared by
 * tsup.config.ts and vitest.config.ts: the versions of the workspace's core
 * and astro packages, which `init --template astro` depends on (ml-aot.32).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const versionOf = (pkg: string): string =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../${pkg}/package.json`, import.meta.url)), 'utf-8'))
    .version;

export const packageVersionDefines = {
  __MLYM_CORE_VERSION__: JSON.stringify(versionOf('core')),
  __MLYM_ASTRO_VERSION__: JSON.stringify(versionOf('astro')),
};
