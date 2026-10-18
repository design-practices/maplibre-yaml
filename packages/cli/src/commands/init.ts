/**
 * @file Init command implementation
 */

import { defineCommand } from 'citty';
import { resolve, join, dirname, basename } from 'pathe';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pc from 'picocolors';
import {
  loadTemplateMetadata,
  scaffoldProject,
  listTemplates,
} from '../lib/template-engine.js';
import { logger } from '../lib/logger.js';
import { EXIT_CODES } from '../types.js';

// Get templates directory (bundled with CLI)
// In production, templates are at the package root: packages/cli/templates
// The compiled file is at packages/cli/dist/cli.js
// So we go up one level from dist to get to the package root
const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(__dirname, '../templates');

/** The template `init` uses when `--template` is not given. */
export const DEFAULT_TEMPLATE = 'basic';

/** Flags `init` accepts, with whether each one takes a value. */
const INIT_FLAGS: Record<string, { value: boolean }> = {
  template: { value: true },
  t: { value: true },
  name: { value: true },
  n: { value: true },
  list: { value: false },
  help: { value: false },
  h: { value: false },
};

/**
 * Check `init`'s raw arguments for things citty would silently ignore: an
 * unknown flag (`--dir`, a typo) or a second positional. Before this, `init
 * --dir my-maps` printed the template list, created nothing and exited 0, so
 * a student reasonably assumed it had worked.
 *
 * @returns a message describing the first problem, or null when the
 *   arguments are all ones `init` understands
 */
export function initArgsError(rawArgs: readonly string[]): string | null {
  const positionals: string[] = [];
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i]!;
    if (arg === '--') {
      positionals.push(...rawArgs.slice(i + 1));
      break;
    }
    if (!arg.startsWith('-') || arg === '-') {
      positionals.push(arg);
      continue;
    }
    const [flag, inlineValue] = arg.replace(/^-{1,2}/, '').split(/=(.*)/s, 2);
    const known = INIT_FLAGS[flag!];
    if (!known) {
      if (flag === 'dir' || flag === 'd' || flag === 'directory') {
        return (
          `init has no ${arg.split('=')[0]} option. Give the folder as an argument ` +
          `instead: init my-maps --template basic`
        );
      }
      return `Unknown option for init: ${arg.split('=')[0]}`;
    }
    // A flag that takes a value consumes the next argument, unless it was
    // given inline (`--template=basic`).
    if (known.value && inlineValue === undefined) i++;
  }
  if (positionals.length > 1) {
    return (
      `init takes one folder name, got ${positionals.length}: ${positionals.join(' ')}. ` +
      'Quote a folder name that contains spaces.'
    );
  }
  return null;
}

/**
 * The commands printed after a successful scaffold.
 *
 * @remarks
 * Written for someone who ran the CLI through `npx`: a bare `maplibre-yaml` or
 * `mlym` only exists after an install, so every CLI command is spelled
 * `npx @maplibre-yaml/cli …`, which works either way.
 *
 * @param template - the template that was scaffolded
 * @param cdPath - the folder to `cd` into, or null when it is the current one
 */
export function nextSteps(template: string, cdPath: string | null): string[] {
  const cli = 'npx @maplibre-yaml/cli';
  const lines: string[] = [];
  if (cdPath) lines.push(`  ${pc.cyan('cd')} ${cdPath}`);

  if (template === 'astro') {
    lines.push(`  ${pc.cyan('npm install')}`);
    lines.push(`  ${pc.cyan('npm run dev')}`);
    lines.push('');
    lines.push(`  ${pc.dim('Edit public/configs/map.yaml to change the map.')}`);
  } else {
    // basic and story: a static page that fetches its YAML file.
    const file = template === 'story' ? 'story.yaml' : 'map.yaml';
    lines.push(`  ${pc.cyan('npx serve .')}`);
    lines.push('');
    lines.push('  Then open the http://localhost address it prints (usually http://localhost:3000).');
    lines.push(`  ${pc.dim('Opening index.html by double-clicking does not work: the browser blocks')}`);
    lines.push(`  ${pc.dim(`it from loading ${file}. Any static web server works instead of serve.`)}`);
    lines.push('');
    lines.push(`  ${pc.dim(`Edit ${file} and reload the page. Check it for mistakes with:`)}`);
    lines.push(`  ${pc.cyan(`${cli} validate`)} ${file}`);
  }
  return lines;
}

export const initCommand = defineCommand({
  meta: {
    name: 'init',
    description: 'Create a new maplibre-yaml project',
  },
  args: {
    directory: {
      type: 'positional',
      required: false,
      description: 'Folder to create the project in (default: ./<name>, i.e. ./my-map)',
    },
    template: {
      type: 'string',
      alias: 't',
      description: `Template to use: basic (default), story, astro`,
    },
    name: {
      type: 'string',
      alias: 'n',
      description: 'Project name (default: the folder name)',
    },
    list: {
      type: 'boolean',
      description: 'List the available templates and exit',
    },
  },
  async run({ args, rawArgs }) {
    const { directory, name, list } = args;

    try {
      const argsError = initArgsError(rawArgs);
      if (argsError) {
        logger.error(argsError);
        console.log(`\nUsage: ${pc.cyan('npx @maplibre-yaml/cli init [folder] --template <template>')}`);
        console.log(`Run ${pc.cyan('npx @maplibre-yaml/cli init --help')} for all options.\n`);
        process.exit(EXIT_CODES.VALIDATION_ERROR);
      }

      const templates = await listTemplates(TEMPLATES_DIR);

      if (list) {
        console.log('Available templates:\n');
        for (const t of templates) {
          console.log(`  ${pc.cyan(t.name.padEnd(10))} ${t.description}`);
        }
        console.log(`\nUsage: ${pc.cyan('npx @maplibre-yaml/cli init [folder] --template <template>')}\n`);
        return;
      }

      const template = args.template || DEFAULT_TEMPLATE;
      if (!args.template) {
        console.log(
          `Using the ${pc.cyan(DEFAULT_TEMPLATE)} template ` +
            `(others: ${templates.map(t => t.name).filter(n => n !== DEFAULT_TEMPLATE).join(', ')}; ` +
            `choose one with --template).`
        );
      }

      // Validate template exists
      const templateDir = join(TEMPLATES_DIR, template);
      if (!templates.some(t => t.name === template) || !existsSync(templateDir)) {
        logger.error(`Unknown template "${template}".`);
        console.error(`Available templates: ${templates.map(t => t.name).join(', ')}`);
        process.exit(EXIT_CODES.VALIDATION_ERROR);
      }

      // Load template metadata
      const metadata = await loadTemplateMetadata(templateDir);

      // Determine project name: --name, else the folder's own name.
      const projectName =
        name ||
        (directory ? basename(resolve(directory)) : undefined) ||
        metadata.variables?.find(v => v.name === 'projectName')?.default ||
        'my-map';

      // Determine target directory
      const targetDir = resolve(directory || projectName);

      // Check if directory already exists and is not empty
      if (existsSync(targetDir)) {
        const files = await readdir(targetDir);
        if (files.length > 0) {
          logger.error(`Directory already exists and is not empty: ${targetDir}`);
          process.exit(EXIT_CODES.VALIDATION_ERROR);
        }
      }

      // Gather variables
      const variables: Record<string, string> = {
        projectName,
      };

      // Apply defaults for any missing variables
      for (const v of metadata.variables || []) {
        if (!(v.name in variables) && v.default) {
          variables[v.name] = v.default;
        }
      }

      // Scaffold the project
      logger.info(`Creating project in ${pc.cyan(targetDir)}...`);
      await scaffoldProject(templateDir, targetDir, variables);

      // Success message
      logger.success(`Project created successfully!`);
      console.log();
      console.log('Next steps:');
      console.log();
      const cdPath = resolve(targetDir) === resolve('.') ? null : (directory || projectName);
      for (const line of nextSteps(template, cdPath)) console.log(line);
      console.log();

    } catch (err) {
      logger.error('Failed to create project', err as Error);
      process.exit(EXIT_CODES.UNKNOWN_ERROR);
    }
  },
});
