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

  for (const result of results) {
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

      for (const warning of result.warnings) {
        totalWarnings++;
        const location = formatLocation(warning);
        const path = warning.path ? pc.yellow(warning.path) + ': ' : '';
        lines.push(`  ${pc.yellow('warning')} ${path}${warning.message}`);
        if (location) {
          lines.push(`    ${pc.dim(location)}`);
        }
      }
    } else {
      lines.push(pc.green(`✓ ${result.file}`));
    }
  }

  // Summary
  lines.push('');
  if (totalErrors === 0 && totalWarnings === 0) {
    lines.push(pc.green(`✓ ${results.length} file(s) valid`));
  } else {
    const errorText = totalErrors > 0 ? pc.red(`${totalErrors} error(s)`) : '';
    const warningText = totalWarnings > 0 ? pc.yellow(`${totalWarnings} warning(s)`) : '';
    const separator = totalErrors > 0 && totalWarnings > 0 ? ', ' : '';
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
