/**
 * @file CLI entry point for maplibre-yaml
 * @module @maplibre-yaml/cli
 */

import { defineCommand, runMain } from 'citty';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { nodeVersionProblem } from './lib/node-version.js';

// Before anything else: on a Node.js the CLI can't run on, say so plainly
// instead of failing later inside a dependency (sharp needs 20.9+).
const tooOld = nodeVersionProblem(process.version);
if (tooOld) {
  console.error(tooOld);
  process.exit(1);
}

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
    schema: () => import('./commands/schema.js').then(m => m.schemaCommand),
    emit: () => import('./commands/emit.js').then(m => m.emitCommand),
    convert: () => import('./commands/convert.js').then(m => m.convertCommand),
    bake: () => import('./commands/bake.js').then(m => m.bakeCommand),
  },
});

runMain(main);
