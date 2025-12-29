/**
 * @file Template engine for project scaffolding
 */

import { readFile, writeFile, mkdir, readdir, copyFile } from 'node:fs/promises';
import { join, dirname, relative } from 'pathe';
import { existsSync } from 'node:fs';
import type { TemplateMetadata } from '../templates/types.js';

/**
 * Resolve template variables in content using {{variableName}} syntax
 */
export function resolveVariables(
  content: string,
  variables: Record<string, string>
): string {
  let result = content;
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    result = result.replace(regex, value);
  }
  return result;
}

/**
 * Load template metadata from template.json
 */
export async function loadTemplateMetadata(templateDir: string): Promise<TemplateMetadata> {
  const metadataPath = join(templateDir, 'template.json');
  const content = await readFile(metadataPath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Recursively get all template files (excluding template.json)
 */
async function getTemplateFiles(dir: string, base = dir): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relativePath = relative(base, fullPath);

    // Skip template.json
    if (entry.name === 'template.json') continue;

    if (entry.isDirectory()) {
      const subFiles = await getTemplateFiles(fullPath, base);
      files.push(...subFiles);
    } else {
      files.push(relativePath);
    }
  }

  return files;
}

/**
 * Scaffold a project from a template
 */
export async function scaffoldProject(
  templateDir: string,
  targetDir: string,
  variables: Record<string, string>
): Promise<void> {
  // Create target directory
  if (!existsSync(targetDir)) {
    await mkdir(targetDir, { recursive: true });
  }

  // Get all template files
  const files = await getTemplateFiles(templateDir);

  for (const file of files) {
    const sourcePath = join(templateDir, file);

    // Resolve variables in filename (e.g., {{projectName}}.yaml)
    const targetFile = resolveVariables(file, variables)
      .replace(/\.template$/, ''); // Remove .template extension
    const targetPath = join(targetDir, targetFile);

    // Create directory if needed
    const targetDirPath = dirname(targetPath);
    if (!existsSync(targetDirPath)) {
      await mkdir(targetDirPath, { recursive: true });
    }

    // Check if it's a text file that needs variable substitution
    const textExtensions = [
      '.yaml', '.yml', '.json', '.html', '.md', '.mdx',
      '.astro', '.ts', '.js', '.mjs', '.css', '.txt'
    ];
    const isTextFile = textExtensions.some(ext =>
      file.endsWith(ext) || file.endsWith(ext + '.template')
    );

    if (isTextFile) {
      // Read, process variables, and write
      const content = await readFile(sourcePath, 'utf-8');
      const processed = resolveVariables(content, variables);
      await writeFile(targetPath, processed, 'utf-8');
    } else {
      // Binary file - just copy
      await copyFile(sourcePath, targetPath);
    }
  }
}

/**
 * List available templates
 */
export async function listTemplates(templatesDir: string): Promise<TemplateMetadata[]> {
  const templates: TemplateMetadata[] = [];

  if (!existsSync(templatesDir)) {
    return templates;
  }

  const entries = await readdir(templatesDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      try {
        const metadata = await loadTemplateMetadata(join(templatesDir, entry.name));
        templates.push(metadata);
      } catch {
        // Skip directories without valid template.json
      }
    }
  }

  return templates;
}
