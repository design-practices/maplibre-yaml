/**
 * @file Output formatters for validation results
 */

import pc from 'picocolors';
import type { ValidationResult, ValidationError } from '../types.js';

/**
 * Format validation results for human-readable terminal output
 */
export function formatHuman(results: ValidationResult[]): string {
  const lines: string[] = [];
  
  let totalErrors = 0;
  let totalWarnings = 0;
  let filesWithErrors = 0;
  let filesWithWarnings = 0;

  for (const result of results) {
    if (result.warnings.length > 0) {
      filesWithWarnings++;
    }

    if (!result.valid) {
      filesWithErrors++;

      lines.push('');
      lines.push(pc.red(`✗ ${result.file}`));

      for (const error of result.errors) {
        totalErrors++;
        const location = formatLocation(error);
        const path = error.path ? pc.yellow(error.path) + ': ' : '';
        lines.push(`  ${pc.red('error')} ${path}${error.message}`);
        if (location) {
          lines.push(`    ${pc.dim(location)}`);
        }
      }
    } else if (result.warnings.length > 0) {
      // Valid, but has advisory warnings worth surfacing.
      lines.push('');
      lines.push(pc.yellow(`⚠ ${result.file}`));
    } else {
      lines.push(pc.green(`✓ ${result.file}`));
    }

    // Warnings are surfaced whether or not the file also has errors.
    for (const warning of result.warnings) {
      totalWarnings++;
      const location = formatLocation(warning);
      const path = warning.path ? pc.yellow(warning.path) + ': ' : '';
      lines.push(`  ${pc.yellow('warning')} ${path}${warning.message}`);
      if (location) {
        lines.push(`    ${pc.dim(location)}`);
      }
    }
  }

  // Summary
  lines.push('');
  if (totalErrors === 0 && totalWarnings === 0) {
    lines.push(pc.green(`✓ ${results.length} file(s) valid`));
  } else if (totalErrors === 0) {
    // Warnings only: the run still exits 0, so use a warning glyph and accurate
    // wording rather than a red ✗ over "0 file(s) with issues".
    lines.push(
      pc.yellow(`⚠ ${filesWithWarnings} file(s) with warnings: ${totalWarnings} warning(s)`)
    );
  } else {
    const errorText = pc.red(`${totalErrors} error(s)`);
    const warningText = totalWarnings > 0 ? pc.yellow(`${totalWarnings} warning(s)`) : '';
    const separator = totalWarnings > 0 ? ', ' : '';
    lines.push(`✗ ${filesWithErrors} file(s) with issues: ${errorText}${separator}${warningText}`);
  }

  return lines.join('\n');
}

/**
 * Format validation results as JSON
 */
export function formatJSON(results: ValidationResult[]): string {
  const output = {
    valid: results.every(r => r.valid),
    files: results.map(r => ({
      file: r.file,
      valid: r.valid,
      errors: r.errors,
      warnings: r.warnings,
    })),
    summary: {
      total: results.length,
      valid: results.filter(r => r.valid).length,
      invalid: results.filter(r => !r.valid).length,
      errorCount: results.reduce((sum, r) => sum + r.errors.length, 0),
      warningCount: results.reduce((sum, r) => sum + r.warnings.length, 0),
    },
  };

  return JSON.stringify(output, null, 2);
}

/**
 * Format error location string
 */
function formatLocation(error: ValidationError): string {
  if (error.line !== undefined) {
    if (error.column !== undefined) {
      return `at line ${error.line}, column ${error.column}`;
    }
    return `at line ${error.line}`;
  }
  return '';
}
