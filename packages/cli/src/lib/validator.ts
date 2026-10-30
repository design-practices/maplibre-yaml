/**
 * @file Configuration validator
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'pathe';
import {
  bigIntegerWarnings,
  parseDocumentText,
  stripBom,
  type DocumentFormat,
  type DocumentTextResult,
  type ParseError,
} from '@maplibre-yaml/core';
import type { ValidationResult, ValidationError } from '../types.js';
import { tomlReaderFailureMessage } from './formatter.js';

/**
 * Validate a single map or story document, in YAML, JSON or TOML (the file
 * extension picks the format; a file with another extension is sniffed).
 */
export async function validateFile(filePath: string): Promise<ValidationResult> {
  const absolutePath = resolve(filePath);
  
  // Check file exists
  if (!existsSync(absolutePath)) {
    return {
      file: filePath,
      valid: false,
      errors: [{
        path: '',
        message: `File not found: ${filePath}`,
        severity: 'error',
      }],
      warnings: [],
    };
  }

  // Read file
  let content: string;
  try {
    content = await readFile(absolutePath, 'utf-8');
  } catch (error) {
    return {
      file: filePath,
      valid: false,
      errors: [{
        path: '',
        message: `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
        severity: 'error',
      }],
      warnings: [],
    };
  }

  // Detect the document type (map, scrollytelling, or root) and validate
  // against the matching schema. The front door strips a byte-order mark,
  // which Node's readFile keeps, and words errors for the file's format.
  let parsed: DocumentTextResult;
  try {
    parsed = await parseDocumentText(content, { kind: 'any', signals: { fileName: absolutePath } });
  } catch (error) {
    // Only a failed load of the TOML reader rejects (KTD1).
    return {
      file: filePath,
      valid: false,
      errors: [{
        path: '',
        message: tomlReaderFailureMessage(error),
        severity: 'error',
      }],
      warnings: [],
    };
  }
  const { result, format } = parsed;

  // Advisory findings (unknown keys, deprecations, expression hints) flow
  // through the parser's warnings channel in both the valid and invalid cases.
  const warnings: ValidationError[] = result.warnings.map((warning) => ({
    path: warning.path,
    message: warning.message,
    line: warning.line,
    column: warning.column,
    // A note explains how a valid value is read: information, not a warning.
    severity: warning.kind === 'note' ? ('note' as const) : ('warning' as const),
    ...(warning.kind ? { kind: warning.kind } : {}),
  }));
  // Integers past 2^53 that read as other digits (ml-4cn.12). The parser
  // warns for TOML's (in the browser too); YAML's and JSON's are found here
  // only, so the CDN entry doesn't carry the walk.
  if (format !== 'toml') {
    for (const { path, message, line, column } of bigIntegerWarnings(content)) {
      warnings.push({ path, message, line, column, severity: 'warning' });
    }
  }

  if (result.success) {
    return {
      file: filePath,
      valid: true,
      errors: [],
      warnings,
    };
  }

  // Convert parse errors to validation errors
  const lines = stripBom(content).split(/\r?\n/);
  const errors: ValidationError[] = result.errors.map((err: ParseError) => {
    const located = isRootFallback(err, lines, format)
      ? {}
      : { line: err.line, column: err.column };
    return {
      path: err.path,
      message: err.message,
      ...located,
      severity: 'error' as const,
    };
  });

  return {
    file: filePath,
    valid: false,
    errors,
    warnings,
  };
}

/**
 * Whether an error's location is only the document's first key, standing in
 * for a top-level key that is missing (`config: Expected object, got
 * undefined` "at line 1, column 1"). The parser points at the nearest node
 * that exists; for a missing top-level key that is the root mapping, which
 * tells the reader nothing (ml-aot.54). A real top-level key at column 1
 * keeps its location: `type: mapp` in YAML, `"type": "mapp"` in JSON, and
 * `type = "mapp"` or a `[config]` table header in TOML.
 */
function isRootFallback(err: ParseError, lines: string[], format: DocumentFormat): boolean {
  if (err.line === undefined || err.column !== 1 || !err.path) return false;
  const key = `["']?${err.path.split('.')[0]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']?`;
  const text = lines[err.line - 1] ?? '';
  const keyLine =
    format === 'toml'
      ? new RegExp(`^(?:${key}\\s*[=.]|\\[\\[?\\s*${key}\\s*[.\\]])`)
      : new RegExp(`^${key}\\s*:`);
  return !keyLine.test(text);
}

/**
 * Validate multiple files
 */
export async function validateFiles(filePaths: string[]): Promise<ValidationResult[]> {
  return Promise.all(filePaths.map(validateFile));
}

/**
 * Validate files in parallel with concurrency limit
 */
export async function validateFilesParallel(
  files: string[],
  concurrency = 10
): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];

  // Process in batches
  for (let i = 0; i < files.length; i += concurrency) {
    const batch = files.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(file => validateFile(file))
    );
    results.push(...batchResults);
  }

  return results;
}
