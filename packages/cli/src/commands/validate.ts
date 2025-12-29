/**
 * @file Validate command implementation
 */

import { defineCommand } from 'citty';
import consola from 'consola';
import pc from 'picocolors';
import { validateFile } from '../lib/validator.js';
import { formatHuman, formatJSON } from '../lib/formatter.js';
import { formatSARIF } from '../lib/sarif-formatter.js';
import { createWatcher, formatWatchEvent } from '../lib/watcher.js';
import { loadProjectConfig, mergeConfig } from '../lib/config-loader.js';
import { logger } from '../lib/logger.js';
import { EXIT_CODES } from '../types.js';

// Get version from package.json
const version = '0.1.0';

export const validateCommand = defineCommand({
  meta: {
    name: 'validate',
    description: 'Validate YAML configuration files',
  },
  args: {
    config: {
      type: 'positional',
      required: true,
      description: 'Path to YAML configuration file',
    },
    json: {
      type: 'boolean',
      default: false,
      description: 'Output results as JSON',
    },
    sarif: {
      type: 'boolean',
      default: false,
      description: 'Output results as SARIF (for GitHub code scanning)',
    },
    strict: {
      type: 'boolean',
      default: false,
      description: 'Treat warnings as errors',
    },
    watch: {
      type: 'boolean',
      alias: 'w',
      default: false,
      description: 'Watch for changes and re-validate',
    },
  },
  async run({ args }) {
    // Load project config
    const projectConfig = await loadProjectConfig();

    // Merge CLI args with project config (CLI takes precedence)
    const mergedArgs = projectConfig?.validate
      ? mergeConfig(args, projectConfig.validate)
      : args;

    const { config, json, sarif, strict, watch: watchMode } = mergedArgs;

    // Define validation function
    async function runValidation() {
      try {
        // Validate the file
        const result = await validateFile(config);
        const results = [result];

        // Apply strict mode
        if (strict) {
          for (const r of results) {
            if (r.warnings.length > 0) {
              r.valid = false;
              r.errors.push(...r.warnings.map(w => ({ ...w, severity: 'error' as const })));
              r.warnings = [];
            }
          }
        }

        // Format output
        let output: string;
        if (sarif) {
          output = formatSARIF(results, version);
        } else if (json) {
          output = formatJSON(results);
        } else {
          output = formatHuman(results);
        }
        console.log(output);

        // In watch mode, don't exit
        if (!watchMode) {
          const hasErrors = results.some(r => !r.valid);
          process.exit(hasErrors ? EXIT_CODES.VALIDATION_ERROR : EXIT_CODES.SUCCESS);
        }
      } catch (error) {
        if (watchMode) {
          consola.error('Validation failed:', error);
        } else {
          consola.error('Validation failed:', error);
          process.exit(EXIT_CODES.UNKNOWN_ERROR);
        }
      }
    }

    // Initial validation
    await runValidation();

    // Start watch mode if enabled
    if (watchMode) {
      logger.info(`\nWatching for changes... ${pc.dim('(Ctrl+C to stop)')}\n`);

      const watcher = createWatcher({
        patterns: [config],
        onChange: async (path) => {
          console.log(formatWatchEvent('change', path));
          await runValidation();
        },
        onError: (error) => {
          logger.error('Watch error:', error.message);
        },
      });

      // Handle graceful shutdown
      const shutdown = async () => {
        logger.info('\nStopping watch mode...');
        await watcher.close();
        process.exit(0);
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);

      // Keep process alive
      await new Promise(() => {});
    }
  },
});
