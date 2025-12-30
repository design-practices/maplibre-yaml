/**
 * @file Validate command implementation
 */

import { defineCommand } from 'citty';
import consola from 'consola';
import pc from 'picocolors';
import { validateFile, validateFilesParallel } from '../lib/validator.js';
import { formatHuman, formatJSON } from '../lib/formatter.js';
import { formatSARIF } from '../lib/sarif-formatter.js';
import { createWatcher, formatWatchEvent } from '../lib/watcher.js';
import { loadProjectConfig, mergeConfig } from '../lib/config-loader.js';
import { logger } from '../lib/logger.js';
import { resolveGlobPatterns } from '../lib/glob.js';
import { createProgress } from '../lib/progress.js';
import { EXIT_CODES } from '../types.js';

// Get version from package.json
const version = '0.1.0';

export const validateCommand = defineCommand({
  meta: {
    name: 'validate',
    description: 'Validate YAML configuration files',
  },
  args: {
    patterns: {
      type: 'positional',
      required: true,
      description: 'File path(s) or glob pattern(s)',
    },
    format: {
      type: 'string',
      alias: 'f',
      description: 'Output format: human, json, sarif',
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

    const { patterns, format, strict, watch: watchMode } = mergedArgs;

    // Parse patterns (space-separated or single)
    const patternList = patterns.includes(' ')
      ? patterns.split(/\s+/).filter(Boolean)
      : [patterns];

    // Resolve glob patterns to files
    let files: string[];
    try {
      files = await resolveGlobPatterns(patternList, {
        ignore: projectConfig?.validate?.ignorePatterns,
      });
    } catch (error) {
      consola.error('Failed to resolve patterns:', error);
      process.exit(EXIT_CODES.FILE_NOT_FOUND);
    }

    if (files.length === 0) {
      console.log(pc.yellow('No files found matching pattern(s):'), patternList.join(', '));
      process.exit(EXIT_CODES.FILE_NOT_FOUND);
    }

    // Define validation function
    async function runValidation() {
      try {
        // Validate with progress for large sets
        let results;

        if (files.length > 10 && format !== 'json' && format !== 'sarif') {
          const progress = createProgress({ total: files.length, label: 'Validating' });
          results = [];

          for (const file of files) {
            const result = await validateFile(file);
            results.push(result);
            progress.update();
          }

          progress.done(`Validated ${files.length} files`);
        } else {
          results = await validateFilesParallel(files);
        }

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
        switch (format) {
          case 'json':
            output = formatJSON(results);
            break;
          case 'sarif':
            output = formatSARIF(results, version);
            break;
          default:
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
        patterns: files,
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
