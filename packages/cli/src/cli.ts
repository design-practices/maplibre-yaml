/**
 * @file CLI entry point for maplibre-yaml
 * @module @maplibre-yaml/cli
 */

import { defineCommand, runMain } from 'citty';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Get package.json path
const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = join(__dirname, '../package.json');

const main = defineCommand({
  meta: {
    name: 'maplibre-yaml',
    // Lazy load version to avoid parsing package.json on every run
    get version() {
      return JSON.parse(readFileSync(packageJsonPath, 'utf-8')).version;
    },
    description: 'CLI tools for maplibre-yaml configurations',
  },
  subCommands: {
    // Lazy load commands - only import when actually used
    validate: () => import('./commands/validate.js').then(m => m.validateCommand),
    preview: () => import('./commands/preview.js').then(m => m.previewCommand),
    init: () => import('./commands/init.js').then(m => m.initCommand),
  },
});

runMain(main);
