/**
 * @file Preview command implementation (stub for now)
 */

import { defineCommand } from 'citty';
import { logger } from '../lib/logger.js';

export const previewCommand = defineCommand({
  meta: {
    name: 'preview',
    description: 'Start a local preview server with hot reload',
  },
  args: {
    config: {
      type: 'positional',
      required: true,
      description: 'Path to YAML configuration file',
    },
    port: {
      type: 'string',
      default: '3000',
      description: 'Port to run the server on',
    },
  },
  async run() {
    logger.error('Preview command not yet implemented');
    process.exit(1);
  },
});
