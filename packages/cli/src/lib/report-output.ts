/**
 * @file `--format` handling shared by the report commands (`mlym breaks`,
 * `mlym prepare`): text for people, or one JSON object on stdout.
 */

import { logger } from './logger.js';
import type { ConvertReportError } from './formatter.js';
import { EXIT_CODES } from '../types.js';

/** `--format` values; `human` is accepted as `text`, as `validate` spells it. */
const OUTPUT_FORMATS = ['text', 'json', 'human'] as const;

/** Whether the command prints JSON, and how it stops with an error. */
export interface ReportOutput {
  json: boolean;
  /**
   * Print the message and exit: in text, its lines on stderr; in JSON, one
   * object on stdout with `mlym convert`'s error shape (`errors: [{ path,
   * message, code }]`, one entry per line, `code` the exit code's name).
   */
  fail(exitCode: number, message: string): never;
}

/** An exit code's name as an error code: 2 → `file-not-found`. */
function errorCode(exitCode: number): string {
  const name = Object.entries(EXIT_CODES).find(([, code]) => code === exitCode)?.[0];
  return name ? name.toLowerCase().replace(/_/g, '-') : 'error';
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
    if (json) {
      const code = errorCode(exitCode);
      const lines = message.split('\n').filter((line) => line.trim() !== '');
      const errors: ConvertReportError[] = (lines.length > 0 ? lines : [message]).map((line) => ({ path: '', message: line, code }));
      process.stdout.write(JSON.stringify({ success: false, errors }, null, 2) + '\n');
    } else {
      for (const line of message.split('\n')) logger.error(line);
    }
    return process.exit(exitCode);
  };
  if (!(OUTPUT_FORMATS as readonly string[]).includes(outputFormat)) {
    fail(EXIT_CODES.VALIDATION_ERROR, `--format must be text or json, not "${String(format)}".`);
  }
  return { json, fail };
}
