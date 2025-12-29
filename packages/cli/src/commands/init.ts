/**
 * @file Init command implementation
 */

import { defineCommand } from 'citty';
import { resolve, join, dirname } from 'pathe';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import consola from 'consola';
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

export const initCommand = defineCommand({
  meta: {
    name: 'init',
    description: 'Create a new maplibre-yaml project',
  },
  args: {
    directory: {
      type: 'positional',
      required: false,
      description: 'Project directory (default: current directory)',
    },
    template: {
      type: 'string',
      alias: 't',
      description: 'Template to use (basic, story, astro)',
    },
    name: {
      type: 'string',
      alias: 'n',
      description: 'Project name',
    },
  },
  async run({ args }) {
    const { directory, template, name } = args;

    try {
      // List available templates if no template specified
      if (!template) {
        const templates = await listTemplates(TEMPLATES_DIR);

        consola.info('Available templates:\n');
        for (const t of templates) {
          console.log(`  ${pc.cyan(t.name.padEnd(10))} ${t.description}`);
        }
        console.log('\nUsage: maplibre-yaml init [directory] --template <template>\n');
        return;
      }

      // Validate template exists
      const templateDir = join(TEMPLATES_DIR, template);
      if (!existsSync(templateDir)) {
        logger.error(`Template not found: ${template}`);
        const templates = await listTemplates(TEMPLATES_DIR);
        consola.info(`Available templates: ${templates.map(t => t.name).join(', ')}`);
        process.exit(EXIT_CODES.VALIDATION_ERROR);
      }

      // Load template metadata
      const metadata = await loadTemplateMetadata(templateDir);

      // Determine project name
      const projectName = name || directory || metadata.variables?.find(v => v.name === 'projectName')?.default || 'my-map';

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

      if (directory || name) {
        console.log(`  ${pc.cyan('cd')} ${projectName}`);
      }

      if (template === 'astro') {
        console.log(`  ${pc.cyan('npm install')}`);
        console.log(`  ${pc.cyan('npm run dev')}`);
      } else {
        console.log(`  ${pc.cyan('maplibre-yaml preview')} ${template === 'story' ? 'story.yaml' : 'map.yaml'}`);
      }
      console.log();

    } catch (err) {
      logger.error('Failed to create project', err as Error);
      process.exit(EXIT_CODES.UNKNOWN_ERROR);
    }
  },
});
