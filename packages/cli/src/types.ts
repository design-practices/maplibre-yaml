/**
 * Shared types for the CLI
 */

export interface ValidationError {
  path: string;
  message: string;
  line?: number;
  column?: number;
  severity: 'error' | 'warning';
}

export interface ValidationResult {
  file: string;
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

export interface ValidateOptions {
  json?: boolean;
  sarif?: boolean;
  strict?: boolean;
  watch?: boolean;
}

export interface PreviewOptions {
  port?: number;
  open?: boolean;
  debug?: boolean;
}

export type ExitCode = 0 | 1 | 2 | 3 | 4;

export const EXIT_CODES = {
  SUCCESS: 0 as ExitCode,
  VALIDATION_ERROR: 1 as ExitCode,
  FILE_NOT_FOUND: 2 as ExitCode,
  YAML_SYNTAX_ERROR: 3 as ExitCode,
  UNKNOWN_ERROR: 4 as ExitCode,
};
