/**
 * The CLI needs Node.js 20.9+ (sharp 0.35) and says so itself on an older
 * Node, since npm's EBADENGINE warning is easy to miss and npx shows none.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'pathe';
import { MIN_NODE, nodeAtLeast, nodeVersionProblem } from '../../src/lib/node-version.js';

describe('Node.js version check', () => {
  it('accepts 20.9 and newer, refuses older', () => {
    expect(nodeAtLeast('v20.9.0')).toBe(true);
    expect(nodeAtLeast('v20.20.2')).toBe(true);
    expect(nodeAtLeast('v22.12.0')).toBe(true);
    expect(nodeAtLeast('v24.1.0')).toBe(true);
    expect(nodeAtLeast('v20.8.1')).toBe(false);
    expect(nodeAtLeast('v18.20.8')).toBe(false);
  });

  it('tells a Node 18 user exactly what to do', () => {
    const message = nodeVersionProblem('v18.20.8')!;
    expect(message).toContain('maplibre-yaml needs Node.js 20.9 or newer, but this is Node.js 18.20.8.');
    expect(message).toContain('https://nodejs.org/');
    expect(nodeVersionProblem('v22.23.3')).toBeNull();
  });

  it('matches package.json engines', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8'));
    expect(pkg.engines.node).toBe(`>=${MIN_NODE}`);
  });

  it('runs before any command loads', () => {
    const cli = readFileSync(join(process.cwd(), 'src/cli.ts'), 'utf-8');
    expect(cli.indexOf('nodeVersionProblem(process.version)')).toBeGreaterThan(-1);
    expect(cli.indexOf('nodeVersionProblem(process.version)')).toBeLessThan(cli.indexOf('runMain('));
  });
});
