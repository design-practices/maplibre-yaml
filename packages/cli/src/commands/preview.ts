/**
 * @file Preview command implementation
 */

import { defineCommand } from 'citty';
import { existsSync } from 'node:fs';
import { resolve } from 'pathe';
import { createPreviewServer } from '../preview/server.js';
import { logger, error } from '../lib/logger.js';
import { EXIT_CODES } from '../types.js';

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
    open: {
      type: 'boolean',
      default: true,
      description: 'Open browser automatically',
    },
    debug: {
      type: 'boolean',
      default: false,
      description: 'Show debug panel',
    },
  },
  async run({ args }) {
    const { config, port, open, debug } = args;
    const configPath = resolve(config);

    // Check file exists
    if (!existsSync(configPath)) {
      error('File not found: ' + config);
      process.exit(EXIT_CODES.FILE_NOT_FOUND);
    }

    try {
      const server = await createPreviewServer(configPath, {
        port: parseInt(port, 10),
        open,
        debug,
      });

      await server.start();

      // Handle graceful shutdown
      const shutdown = async () => {
        logger.info('Shutting down preview server...');
        await server.stop();
        process.exit(0);
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);

    } catch (err) {
      error('Failed to start preview server', err as Error);
      process.exit(EXIT_CODES.UNKNOWN_ERROR);
    }
  },
});
