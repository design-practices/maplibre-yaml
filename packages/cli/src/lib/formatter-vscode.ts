/**
 * @file VSCode-compatible output format
 *
 * Format: file:line:column: severity: message
 * This format is compatible with VSCode Problem Matchers
 *
 * @see https://code.visualstudio.com/docs/editor/tasks#_defining-a-problem-matcher
 */

import type { ValidationResult } from '../types.js';

/**
 * Format validation results for VSCode Problem Matcher
 *
 * Output format: file:line:column: severity: message
 *
 * Example:
 * /path/to/config.yaml:5:10: error: [config.center] Expected array, got string
 * /path/to/config.yaml:12:3: warning: [layers[0]] Deprecated property
 */
export function formatVSCode(results: ValidationResult[]): string {
  const lines: string[] = [];

  for (const result of results) {
    // Process errors
    for (const error of result.errors) {
      const line = error.line ?? 1;
      const column = error.column ?? 1;
      const path = error.path ? `[${error.path}] ` : '';

      lines.push(
        `${result.file}:${line}:${column}: error: ${path}${error.message}`
      );
    }

    // Process warnings
    for (const warning of result.warnings) {
      const line = warning.line ?? 1;
      const column = warning.column ?? 1;
      const path = warning.path ? `[${warning.path}] ` : '';

      lines.push(
        `${result.file}:${line}:${column}: warning: ${path}${warning.message}`
      );
    }
  }

  return lines.join('\n');
}
