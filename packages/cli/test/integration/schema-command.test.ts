import { describe, it, expect, afterAll } from 'vitest';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';

const execAsync = promisify(exec);
const CLI = join(process.cwd(), 'dist/cli.js');

// Requires the CLI and @maplibre-yaml/core to be built (schemas emitted).
// Run `pnpm --filter @maplibre-yaml/core build && pnpm --filter @maplibre-yaml/cli build` first.
describe('schema command (integration)', () => {
  const tmpDirs: string[] = [];
  afterAll(async () => {
    await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
  });

  it('prints valid JSON Schema for `schema map`', async () => {
    const { stdout } = await execAsync(`node "${CLI}" schema map`);
    const schema = JSON.parse(stdout);
    expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(schema.$id).toBe(
      'https://docs.maplibre-yaml.org/schema/latest/map.schema.json',
    );
    expect(schema.$ref).toBe('#/$defs/map');
    expect(schema.$defs.map).toBeDefined();
  });

  it('defaults to the map schema when no block is given', async () => {
    const { stdout } = await execAsync(`node "${CLI}" schema`);
    const schema = JSON.parse(stdout);
    expect(schema.$id).toContain('/map.schema.json');
  });

  it('prints the `any` schema as a oneOf over three shapes', async () => {
    const { stdout } = await execAsync(`node "${CLI}" schema any`);
    const schema = JSON.parse(stdout);
    expect(schema.$defs.any.oneOf).toHaveLength(3);
  });

  it('prints scrollytelling and root schemas', async () => {
    for (const block of ['scrollytelling', 'root']) {
      const { stdout } = await execAsync(`node "${CLI}" schema ${block}`);
      const schema = JSON.parse(stdout);
      expect(schema.$id).toContain(`/${block}.schema.json`);
    }
  });

  it('writes a valid schema file with --out', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mlym-schema-'));
    tmpDirs.push(dir);
    const outFile = join(dir, 'nested', 'map.schema.json');
    const { stdout } = await execAsync(
      `node "${CLI}" schema map --out "${outFile}"`,
    );
    // With --out the schema is written to the file, not dumped to stdout.
    expect(stdout).not.toContain('"$defs"');
    // The nested directory is created and the file is valid JSON Schema.
    const written = JSON.parse(await readFile(outFile, 'utf-8'));
    expect(written.$id).toContain('/map.schema.json');
    expect(written.$defs.map).toBeDefined();
  });

  it('exits non-zero with a helpful error for an unknown block', async () => {
    try {
      await execAsync(`node "${CLI}" schema bogus`);
      expect.unreachable('should have exited non-zero');
    } catch (error: any) {
      expect(error.code).toBe(1);
      const out = `${error.stdout}${error.stderr}`;
      expect(out).toContain('map, scrollytelling, root, any');
    }
  });
});
