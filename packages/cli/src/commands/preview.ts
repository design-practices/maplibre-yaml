/**
 * @file Preview command implementation
 */

import { defineCommand, type ArgsDef } from 'citty';
import { existsSync } from 'node:fs';
import { resolve } from 'pathe';
import { loadProjectConfig, mergeConfig } from '../lib/config-loader.js';
import { logger, error } from '../lib/logger.js';
import { EXIT_CODES } from '../types.js';

const PREVIEW_ARGS = {
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
    // citty lists a default-true flag only as `--no-open`, next to this
    // text, so it describes the negative (ml-aot.54).
    description: "Don't open the browser (by default preview opens it)",
  },
  debug: {
    type: 'boolean',
    default: false,
    description: 'Show debug panel',
  },
} satisfies ArgsDef;

export const previewCommand = defineCommand({
  meta: {
    name: 'preview',
    description: 'Start a local preview server with hot reload',
  },
  args: PREVIEW_ARGS,
  async run({ args, rawArgs }) {
    // Load project config
    const projectConfig = await loadProjectConfig();

    // A flag on the command line wins, then the project config's preview:,
    // then the defaults above. citty has already filled those defaults in,
    // so pass the raw args to tell a typed flag from a default (ml-dpe).
    // Note: port from config file is number, from CLI is string
    const mergedArgs = projectConfig?.preview
      ? mergeConfig(
          args,
          {
            ...projectConfig.preview,
            port: projectConfig.preview.port?.toString(),
          },
          { rawArgs, definitions: PREVIEW_ARGS }
        )
      : args;

    const { config, port, open, debug } = mergedArgs;
    const configPath = resolve(config);

    // Check file exists
    if (!existsSync(configPath)) {
      error('File not found: ' + config);
      process.exit(EXIT_CODES.FILE_NOT_FOUND);
    }

    try {
      // Lazy load the preview server (includes heavy Vite dependency)
      const { createPreviewServer } = await import('../preview/server.js');

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
