/**
 * @file Validate command implementation
 */

import { defineCommand } from 'citty';
import consola from 'consola';
import { validateFile } from '../lib/validator.js';
import { formatHuman, formatJSON } from '../lib/formatter.js';
import { EXIT_CODES } from '../types.js';

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
    strict: {
      type: 'boolean',
      default: false,
      description: 'Treat warnings as errors',
    },
  },
  async run({ args }) {
    const { config, json, strict } = args;

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
      const output = json ? formatJSON(results) : formatHuman(results);
      console.log(output);

      // Exit with appropriate code
      const hasErrors = results.some(r => !r.valid);
      process.exit(hasErrors ? EXIT_CODES.VALIDATION_ERROR : EXIT_CODES.SUCCESS);

    } catch (error) {
      consola.error('Validation failed:', error);
      process.exit(EXIT_CODES.UNKNOWN_ERROR);
    }
  },
});
