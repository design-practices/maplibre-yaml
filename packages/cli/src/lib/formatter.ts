/**
 * @file Output formatters for validation results
 */

import pc from 'picocolors';
import { displayPath, type ConvertLoss, type DocumentFormat } from '@maplibre-yaml/core';
import type { ValidationResult, ValidationError } from '../types.js';

/** ` (line:column)` after a one-line finding that has a line, else nothing. */
export function lineColumnSuffix(item: { line?: number; column?: number }): string {
  return item.line ? ` (${item.line}:${item.column ?? 1})` : '';
}

/**
 * What the CLI says when the TOML reader's file (core's on-demand `toml`
 * chunk, a `FormatError` of code `"chunk"`) could not be loaded: the one way
 * reading a document rejects (KTD1).
 */
export function tomlReaderFailureMessage(error: unknown): string {
  return `The TOML reader could not be loaded: ${error instanceof Error ? error.message : String(error)}`;
}

/**
 * Format validation results for human-readable terminal output
 */
export function formatHuman(results: ValidationResult[]): string {
  const lines: string[] = [];
  
  let totalErrors = 0;
  let totalWarnings = 0;
  let filesWithErrors = 0;
  let filesWithWarnings = 0;

  let totalNotes = 0;

  for (const result of results) {
    // A note explains how a valid value is read (a basemap written as just
    // a .pmtiles file): nothing is wrong, so it isn't counted as a warning.
    const warnings = result.warnings.filter((w) => w.kind !== 'note');
    const notes = result.warnings.filter((w) => w.kind === 'note');
    if (warnings.length > 0) {
      filesWithWarnings++;
    }

    if (!result.valid) {
      filesWithErrors++;

      lines.push('');
      lines.push(pc.red(`✗ ${result.file}`));

      for (const error of result.errors) {
        totalErrors++;
        const location = formatLocation(error);
        const path = displayPath(error) ? pc.yellow(displayPath(error)) + ': ' : '';
        lines.push(`  ${pc.red('error')} ${path}${error.message}`);
        if (location) {
          lines.push(`    ${pc.dim(location)}`);
        }
      }
    } else if (warnings.length > 0) {
      // Valid, but has advisory warnings worth surfacing.
      lines.push('');
      lines.push(pc.yellow(`⚠ ${result.file}`));
    } else {
      lines.push(pc.green(`✓ ${result.file}`));
    }

    // Warnings are surfaced whether or not the file also has errors.
    for (const warning of warnings) {
      totalWarnings++;
      const location = formatLocation(warning);
      const path = displayPath(warning) ? pc.yellow(displayPath(warning)) + ': ' : '';
      lines.push(`  ${pc.yellow('warning')} ${path}${warning.message}`);
      if (location) {
        lines.push(`    ${pc.dim(location)}`);
      }
    }
    for (const note of notes) {
      totalNotes++;
      const location = formatLocation(note);
      const path = displayPath(note) ? pc.cyan(displayPath(note)) + ': ' : '';
      lines.push(`  ${pc.cyan('ℹ note')} ${path}${note.message}`);
      if (location) {
        lines.push(`    ${pc.dim(location)}`);
      }
    }
  }

  // Summary
  lines.push('');
  if (totalErrors === 0 && totalWarnings === 0) {
    lines.push(
      pc.green(`✓ ${results.length} file(s) valid`) + (totalNotes > 0 ? pc.dim(` (${totalNotes} note(s))`) : '')
    );
  } else if (totalErrors === 0) {
    // Warnings only: the run still exits 0, so use a warning glyph and accurate
    // wording rather than a red ✗ over "0 file(s) with issues".
    lines.push(
      pc.yellow(`⚠ ${filesWithWarnings} file(s) with warnings: ${totalWarnings} warning(s)`)
    );
  } else {
    // A mixed run says how many passed too (ml-aot.54), as the docs show.
    const validCount = results.length - filesWithErrors;
    if (validCount > 0) lines.push(pc.green(`✓ ${validCount} file(s) valid`));
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
      // A note is information, not a warning (`severity: "note"`).
      warnings: r.warnings.map((w) => (w.kind === 'note' ? { ...w, severity: 'note' as const } : w)),
    })),
    summary: {
      total: results.length,
      valid: results.filter(r => r.valid).length,
      invalid: results.filter(r => !r.valid).length,
      errorCount: results.reduce((sum, r) => sum + r.errors.length, 0),
      warningCount: results.reduce((sum, r) => sum + r.warnings.filter((w) => w.kind !== 'note').length, 0),
      noteCount: results.reduce((sum, r) => sum + r.warnings.filter((w) => w.kind === 'note').length, 0),
    },
  };

  return JSON.stringify(output, null, 2);
}

/** One reason `mlym convert` wrote nothing, as `convert -f json` reports it. */
export interface ConvertReportError {
  path: string;
  message: string;
  /**
   * Core's code (`toml-syntax`, `convert-null`, …) when it has one, or the
   * command's own: `strict` (`--strict` and a loss).
   */
  code?: string;
  line?: number;
  column?: number;
  suggestion?: string;
}

/** What `mlym convert -f json` prints: one object, whatever the outcome. */
export interface ConvertReport {
  success: boolean;
  /** The input's format, or null when it was never read (a missing file). */
  from: DocumentFormat | null;
  to: string;
  /** The converted document, when it went to stdout. */
  text?: string;
  /** The file it was written to, with `--out`. */
  out?: string;
  losses: ConvertLoss[];
  errors: ConvertReportError[];
}

/**
 * Format a `mlym convert` outcome as JSON. Losses and errors keep the fields
 * `validate -f json` uses (`path`, `message`, `line`, `column`), so an agent
 * reads both commands' output the same way.
 */
export function formatConvertJSON(report: ConvertReport): string {
  const output: ConvertReport = {
    success: report.success,
    from: report.from,
    to: report.to,
    ...(report.text !== undefined ? { text: report.text } : {}),
    ...(report.out !== undefined ? { out: report.out } : {}),
    losses: report.losses.map(({ kind, message, path, line, column }) => ({ kind, message, path, line, column })),
    errors: report.errors.map(({ path, message, code, line, column, suggestion }) => ({
      path,
      message,
      code,
      line,
      column,
      suggestion,
    })),
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
