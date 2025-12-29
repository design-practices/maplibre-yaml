/**
 * @file Configuration file loader
 */

import { resolve, join } from 'pathe';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parse as parseYAML } from 'yaml';

export interface ProjectConfig {
  validate?: {
    strict?: boolean;
    ignorePatterns?: string[];
  };
  preview?: {
    port?: number;
    open?: boolean;
    debug?: boolean;
  };
  configs?: string[];
}

const CONFIG_FILES = [
  'maplibre-yaml.config.js',
  'maplibre-yaml.config.mjs',
  'maplibre-yaml.config.json',
  'maplibre-yaml.config.yaml',
  'maplibre-yaml.config.yml',
];

/**
 * Load project configuration from file
 */
export async function loadProjectConfig(cwd = process.cwd()): Promise<ProjectConfig | null> {
  for (const filename of CONFIG_FILES) {
    const configPath = join(cwd, filename);

    if (existsSync(configPath)) {
      try {
        // Handle different file types
        if (filename.endsWith('.json')) {
          const content = await readFile(configPath, 'utf-8');
          return JSON.parse(content);
        } else if (filename.endsWith('.yaml') || filename.endsWith('.yml')) {
          const content = await readFile(configPath, 'utf-8');
          return parseYAML(content) as ProjectConfig;
        } else {
          // .js or .mjs files
          const fileUrl = pathToFileURL(configPath).href;
          const module = await import(fileUrl);
          return module.default || module;
        }
      } catch (error) {
        console.warn(`Warning: Failed to load ${filename}:`, error);
      }
    }
  }

  return null;
}

/**
 * Merge CLI args with project config (CLI takes precedence)
 */
export function mergeConfig<T extends Record<string, any>>(
  cliArgs: T,
  projectConfig: Partial<T> | undefined
): T {
  if (!projectConfig) return cliArgs;

  const merged = { ...cliArgs };

  for (const [key, value] of Object.entries(projectConfig)) {
    // Only use project config value if CLI didn't set it (undefined or default)
    if (merged[key] === undefined || merged[key] === null) {
      (merged as any)[key] = value;
    }
  }

  return merged;
}
