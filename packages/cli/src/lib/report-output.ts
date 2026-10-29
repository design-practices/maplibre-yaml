/**
 * @file `--format` handling shared by the report commands (`mlym breaks`,
 * `mlym prepare`): text for people, or one JSON object on stdout.
 */

import { logger } from './logger.js';
import { EXIT_CODES } from '../types.js';

/** `--format` values; `human` is accepted as `text`, as `validate` spells it. */
const OUTPUT_FORMATS = ['text', 'json', 'human'] as const;

/** Whether the command prints JSON, and how it stops with an error. */
export interface ReportOutput {
  json: boolean;
  /** Print the message (a JSON error object, or error lines) and exit. */
  fail(exitCode: number, message: string): never;
}

/**
 * Read the `--format` flag. An unknown value fails at once (exit 1).
 *
 * @param format - The flag's raw value.
 */
export function reportOutput(format: unknown): ReportOutput {
  const outputFormat = String(format ?? 'text').toLowerCase();
  const json = outputFormat === 'json';
  const fail = (exitCode: number, message: string): never => {
    if (json) process.stdout.write(JSON.stringify({ success: false, errors: [{ message }] }, null, 2) + '\n');
    else for (const line of message.split('\n')) logger.error(line);
    return process.exit(exitCode);
  };
  if (!(OUTPUT_FORMATS as readonly string[]).includes(outputFormat)) {
    fail(EXIT_CODES.VALIDATION_ERROR, `--format must be text or json, not "${String(format)}".`);
  }
  return { json, fail };
}
