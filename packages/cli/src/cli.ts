/**
 * @file CLI entry point for maplibre-yaml
 * @module @maplibre-yaml/cli
 */

import { defineCommand, runMain } from 'citty';
import { validateCommand } from './commands/validate.js';
import { previewCommand } from './commands/preview.js';
import { initCommand } from './commands/init.js';

const main = defineCommand({
  meta: {
    name: 'maplibre-yaml',
    version: '0.1.0',
    description: 'CLI tools for maplibre-yaml configurations',
  },
  subCommands: {
    validate: validateCommand,
    preview: previewCommand,
    init: initCommand,
  },
});

runMain(main);
