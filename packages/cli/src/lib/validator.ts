/**
 * @file Configuration validator
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'pathe';
import { YAMLParser, type ParseError } from '@maplibre-yaml/core';
import type { ValidationResult, ValidationError } from '../types.js';

/**
 * Validate a single YAML configuration file
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

  // Parse and validate
  const result = YAMLParser.safeParseMapBlock(content);

  if (result.success) {
    return {
      file: filePath,
      valid: true,
      errors: [],
      warnings: [],
    };
  }

  // Convert parse errors to validation errors
  const errors: ValidationError[] = result.errors.map((err: ParseError) => ({
    path: err.path,
    message: err.message,
    line: err.line,
    column: err.column,
    severity: 'error' as const,
  }));

  return {
    file: filePath,
    valid: false,
    errors,
    warnings: [],
  };
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
