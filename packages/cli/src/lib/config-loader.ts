/**
 * @file Configuration file loader
 */

import { join } from 'pathe';
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
          return parseYAML(content, { merge: true }) as ProjectConfig;
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

/** A command's option definitions, as far as {@link explicitFlags} needs them. */
export type FlagDefinitions = Record<string, { alias?: string | string[]; [key: string]: unknown }>;

/**
 * The option names given explicitly on the command line: `--port 4000`,
 * `--port=4000`, `--open`, `--no-open`, and an alias such as `-f json` (with
 * `definitions`, an alias is reported under its option's name).
 *
 * @remarks
 * citty fills in an option's declared default, so the parsed args cannot say
 * whether `open: true` was typed or defaulted. The raw arguments can. Parsing
 * stops at `--`, as citty's does. Short flags may be grouped (`-wf`), as
 * citty allows.
 */
export function explicitFlags(
  rawArgs: readonly string[],
  definitions: FlagDefinitions = {}
): Set<string> {
  const aliases = new Map<string, string>();
  for (const [name, def] of Object.entries(definitions)) {
    const list = def.alias === undefined ? [] : Array.isArray(def.alias) ? def.alias : [def.alias];
    for (const alias of list) aliases.set(alias, name);
  }
  const canonical = (flag: string) => aliases.get(flag) ?? flag;

  const names = new Set<string>();
  for (const arg of rawArgs) {
    if (arg === '--') break;
    const long = /^--(?:no-)?([^=]+)/.exec(arg);
    if (long) {
      names.add(canonical(long[1]!));
      continue;
    }
    const short = /^-([^-=][^=]*)/.exec(arg);
    if (short) for (const flag of short[1]!) names.add(canonical(flag));
  }
  return names;
}

/**
 * Merge CLI args with project config: a flag given on the command line wins,
 * then the project config file, then the option's built-in default.
 *
 * @param cli - The raw command-line arguments and the command's option
 *   definitions. With them, a project value replaces any CLI value that was
 *   not given explicitly, including one citty filled in from the option's
 *   default (ml-dpe). Without them, a project value only fills a CLI value
 *   that is `undefined` or `null`.
 */
export function mergeConfig<T extends Record<string, any>>(
  cliArgs: T,
  projectConfig: Partial<T> | undefined,
  cli?: { rawArgs: readonly string[]; definitions?: FlagDefinitions }
): T {
  if (!projectConfig) return cliArgs;

  const merged = { ...cliArgs };
  const explicit = cli ? explicitFlags(cli.rawArgs, cli.definitions) : undefined;

  for (const [key, value] of Object.entries(projectConfig)) {
    if (value === undefined || value === null) continue;
    const cliValue = merged[key];
    const cliSetIt = explicit
      ? explicit.has(key)
      : cliValue !== undefined && cliValue !== null;
    if (!cliSetIt) {
      (merged as any)[key] = value;
    }
  }

  return merged;
}
