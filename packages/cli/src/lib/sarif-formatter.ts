/**
 * @file SARIF format output for GitHub code scanning
 * @see https://docs.github.com/en/code-security/code-scanning/integrating-with-code-scanning/sarif-support-for-code-scanning
 */

import type { ValidationResult } from '../types.js';

interface SarifLog {
  version: '2.1.0';
  $schema: string;
  runs: SarifRun[];
}

interface SarifRun {
  tool: {
    driver: {
      name: string;
      version: string;
      informationUri: string;
      rules: SarifRule[];
    };
  };
  results: SarifResult[];
}

interface SarifRule {
  id: string;
  name: string;
  shortDescription: { text: string };
  fullDescription?: { text: string };
  helpUri?: string;
  defaultConfiguration: {
    level: 'error' | 'warning' | 'note';
  };
}

interface SarifResult {
  ruleId: string;
  level: 'error' | 'warning' | 'note';
  message: { text: string };
  locations: SarifLocation[];
}

interface SarifLocation {
  physicalLocation: {
    artifactLocation: {
      uri: string;
    };
    region?: {
      startLine: number;
      startColumn?: number;
    };
  };
}

/**
 * Convert validation results to SARIF format
 */
export function formatSARIF(results: ValidationResult[], version: string): string {
  // Collect unique rules
  const rulesMap = new Map<string, SarifRule>();
  const sarifResults: SarifResult[] = [];

  for (const result of results) {
    // Process errors
    for (const error of result.errors) {
      const ruleId = getRuleId(error.path);

      // Add rule if not already present
      if (!rulesMap.has(ruleId)) {
        rulesMap.set(ruleId, {
          id: ruleId,
          name: getRuleName(error.path),
          shortDescription: { text: getShortDescription(error.path) },
          defaultConfiguration: { level: 'error' },
        });
      }

      // Add result
      sarifResults.push({
        ruleId,
        level: error.severity === 'warning' ? 'warning' : 'error',
        message: { text: error.message },
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri: result.file },
              ...(error.line !== undefined && {
                region: {
                  startLine: error.line,
                  ...(error.column !== undefined && { startColumn: error.column }),
                },
              }),
            },
          },
        ],
      });
    }

    // Process warnings
    for (const warning of result.warnings) {
      const ruleId = getRuleId(warning.path);

      if (!rulesMap.has(ruleId)) {
        rulesMap.set(ruleId, {
          id: ruleId,
          name: getRuleName(warning.path),
          shortDescription: { text: getShortDescription(warning.path) },
          defaultConfiguration: { level: 'warning' },
        });
      }

      sarifResults.push({
        ruleId,
        level: 'warning',
        message: { text: warning.message },
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri: result.file },
              ...(warning.line !== undefined && {
                region: {
                  startLine: warning.line,
                  ...(warning.column !== undefined && { startColumn: warning.column }),
                },
              }),
            },
          },
        ],
      });
    }
  }

  const sarif: SarifLog = {
    version: '2.1.0',
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    runs: [
      {
        tool: {
          driver: {
            name: 'maplibre-yaml',
            version,
            informationUri: 'https://github.com/design-practices/maplibre-yaml',
            rules: Array.from(rulesMap.values()),
          },
        },
        results: sarifResults,
      },
    ],
  };

  return JSON.stringify(sarif, null, 2);
}

/**
 * Generate a rule ID from the error path
 */
function getRuleId(path: string): string {
  if (!path) return 'config-error';

  // Normalize path to rule ID
  const normalized = path
    .replace(/\[\d+\]/g, '') // Remove array indices
    .replace(/\./g, '-')     // Replace dots with dashes
    .toLowerCase();

  return `maplibre-yaml/${normalized || 'config-error'}`;
}

/**
 * Generate a human-readable rule name
 */
function getRuleName(path: string): string {
  if (!path) return 'Configuration Error';

  // Convert path to title case
  return path
    .split('.')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * Generate a short description for a rule
 */
function getShortDescription(path: string): string {
  if (!path) return 'Invalid configuration';
  return `Invalid value at ${path}`;
}
