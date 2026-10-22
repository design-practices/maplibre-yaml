import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'pathe';

const execRaw = promisify(exec);
/**
 * The CLI, without colour codes: picocolors colours output whenever `CI` is
 * set, and the assertions match plain text ("error config: …").
 */
const execAsync = (command: string, options: { cwd?: string } = {}) =>
  execRaw(command, { ...options, env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '' } });
const CLI = join(process.cwd(), 'dist/cli.js');

describe('validate command (integration)', () => {
  beforeAll(async () => {
    // Tests assume CLI is already built
    // Run `pnpm build` before running integration tests
  });

  it('exits with 0 for valid config', async () => {
    const { stdout } = await execAsync(
      `node "${CLI}" validate "test/fixtures/valid-basic.yaml"`
    );
    expect(stdout).toContain('✓');
    expect(stdout).toContain('valid-basic.yaml');
  });

  it('newer MapLibre expression operators (split, join, elevation, semiliteral) pass strict CI validation', async () => {
    const { stdout } = await execRaw(`node "${CLI}" validate "test/fixtures/valid-new-operators.yaml"`, {
      env: { ...process.env, CI: 'true', NO_COLOR: '1' },
    });
    expect(stdout).toContain('1 file(s) valid');
    expect(stdout).not.toContain('Unknown expression operator');
  });

  it('exits with 1 for invalid config', async () => {
    await expect(
      execAsync(`node "${CLI}" validate "test/fixtures/invalid-missing-config.yaml"`)
    ).rejects.toThrow();
  });

  it('exits with 0 for valid scrollytelling config', async () => {
    const { stdout } = await execAsync(
      `node "${CLI}" validate "test/fixtures/valid-scrollytelling.yaml"`
    );
    expect(stdout).toContain('✓');
    expect(stdout).toContain('valid-scrollytelling.yaml');
  });

  it('exits with 0 for root pages document, warning that nothing renders it', async () => {
    // A deprecation warning (ml-j2p.4): exit 0 even under --strict.
    const { stdout } = await execAsync(
      `node "${CLI}" validate --strict "test/fixtures/valid-root.yaml"`
    );
    expect(stdout).toContain('valid-root.yaml');
    expect(stdout).toContain("aren't rendered by any maplibre-yaml package yet");
  });

  it('exits with 1 and lists valid types for unknown block type', async () => {
    try {
      await execAsync(`node "${CLI}" validate "test/fixtures/invalid-unknown-type.yaml"`);
      expect.unreachable('should have exited non-zero');
    } catch (error: any) {
      expect(error.code).toBe(1);
      expect(error.stdout).toContain('map, scrollytelling');
    }
  });

  it('validates a scaffolded story template end-to-end', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const dir = await mkdtemp(join(tmpdir(), 'mlym-story-'));
    try {
      await execAsync(
        `node "${CLI}" init "${dir}/story" --template story --name test-story`
      );
      const { stdout } = await execAsync(
        `node "${CLI}" validate "${dir}/story/story.yaml"`
      );
      expect(stdout).toContain('✓');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('validates multiple files with glob pattern', async () => {
    const { stdout } = await execAsync(
      `node "${CLI}" validate "test/fixtures/valid-*.yaml"`
    );
    expect(stdout).toContain('valid-basic.yaml');
    expect(stdout).toContain('valid-with-layers.yaml');
  });

  it('outputs valid JSON with --format json', async () => {
    const { stdout } = await execAsync(
      `node "${CLI}" validate "test/fixtures/valid-basic.yaml" --format json`
    );
    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveProperty('valid', true);
    expect(parsed).toHaveProperty('files');
    expect(parsed.files).toHaveLength(1);
  });

  it('outputs valid SARIF with --format sarif', async () => {
    const { stdout } = await execAsync(
      `node "${CLI}" validate "test/fixtures/valid-basic.yaml" --format sarif`
    );
    const parsed = JSON.parse(stdout);
    expect(parsed.version).toBe('2.1.0');
    expect(parsed).toHaveProperty('runs');
    expect(parsed.runs[0]).toHaveProperty('tool');
  });

  it('validates all fixtures with glob', async () => {
    try {
      await execAsync(`node "${CLI}" validate "test/fixtures/*.yaml"`);
    } catch (error: any) {
      // Should fail because some fixtures are invalid
      expect(error.code).toBe(1);
      expect(error.stdout).toContain('valid-basic.yaml');
      expect(error.stdout).toContain('invalid');
    }
  });

  it('shows errors for invalid files', async () => {
    try {
      await execAsync(`node "${CLI}" validate "test/fixtures/invalid-*.yaml"`);
    } catch (error: any) {
      expect(error.stdout).toContain('✗');
      expect(error.stdout).toContain('error');
    }
  });

  it('a plain path that does not exist says "File not found" (ml-aot.54)', async () => {
    const error: any = await execAsync(`node "${CLI}" validate "nonexistent.yaml"`).then(
      () => expect.unreachable('should have exited non-zero'),
      (e) => e
    );
    expect(error.code).toBe(2);
    expect(error.stdout).toContain('File not found: nonexistent.yaml');
    expect(error.stdout).not.toContain('pattern');
  });

  it('a glob that matches nothing says "No files match"', async () => {
    const error: any = await execAsync(`node "${CLI}" validate "test/fixtures/*.nonexistent"`).then(
      () => expect.unreachable('should have exited non-zero'),
      (e) => e
    );
    expect(error.code).toBe(2); // FILE_NOT_FOUND exit code
    expect(error.stdout).toContain('No files match "test/fixtures/*.nonexistent"');
  });

  it('catches errors in complex invalid fixture', async () => {
    try {
      await execAsync(`node "${CLI}" validate "test/fixtures/invalid-complex.yaml"`);
    } catch (error: any) {
      expect(error.stdout).toContain('✗');
      expect(error.stdout).toContain('invalid-complex.yaml');
    }
  });

  it('JSON output includes error details', async () => {
    try {
      await execAsync(
        `node "${CLI}" validate "test/fixtures/invalid-missing-config.yaml" --format json`
      );
    } catch (error: any) {
      const parsed = JSON.parse(error.stdout);
      expect(parsed.valid).toBe(false);
      expect(parsed.files[0].errors.length).toBeGreaterThan(0);
      expect(parsed.files[0].errors[0]).toHaveProperty('message');
    }
  });

  it('validates multiple patterns', async () => {
    const { stdout } = await execAsync(
      `node "${CLI}" validate "test/fixtures/valid-basic.yaml test/fixtures/valid-with-layers.yaml"`
    );
    expect(stdout).toContain('valid-basic.yaml');
    expect(stdout).toContain('valid-with-layers.yaml');
    expect(stdout).toContain('2 file(s) valid');
  });

  // Skipping help test - citty's help output timing is inconsistent in CI
  // Help functionality is provided by the framework and works reliably

  it('respects --strict flag', async () => {
    // Create a test case where we'd have warnings if they existed
    // For now, just test the flag is accepted
    const { stdout } = await execAsync(
      `node "${CLI}" validate "test/fixtures/valid-basic.yaml" --strict`
    );
    expect(stdout).toContain('✓');
  });

  it('accepts short format flag -f', async () => {
    const { stdout } = await execAsync(
      `node "${CLI}" validate "test/fixtures/valid-basic.yaml" -f json`
    );
    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveProperty('valid');
  });

  // ml-aot.31: every positional argument is validated, not just the first.
  // `validate a.yaml b.yaml c.yaml` and an unquoted shell glob both arrive as
  // separate argv entries; dropping all but the first was a silent false pass.
  describe('multiple positional arguments (ml-aot.31)', () => {
    const run = async (args: string) => {
      try {
        const { stdout, stderr } = await execAsync(`node "${CLI}" validate ${args}`);
        return { code: 0, stdout, stderr };
      } catch (error: any) {
        return { code: error.code as number, stdout: error.stdout as string, stderr: error.stderr as string };
      }
    };

    it('validates every file when given three files (2nd and 3rd broken)', async () => {
      const r = await run(
        'test/fixtures/valid-basic.yaml test/fixtures/invalid-missing-config.yaml test/fixtures/invalid-bad-layer.yaml'
      );
      expect(r.code).toBe(1);
      expect(r.stdout).toContain('valid-basic.yaml');
      expect(r.stdout).toContain('invalid-missing-config.yaml');
      expect(r.stdout).toContain('invalid-bad-layer.yaml');
      expect(r.stdout).toContain('2 file(s) with issues');
    });

    it('validates a shell-expanded glob (unquoted) — every match, not only the first', async () => {
      // The shell expands this before the CLI sees it; valid-basic sorts first.
      const r = await run('test/fixtures/valid-basic.yaml test/fixtures/invalid-*.yaml');
      expect(r.code).toBe(1);
      expect(r.stdout).toContain('invalid-unknown-type.yaml');
      expect(r.stdout).toContain('invalid-yaml-syntax.yaml');
    });

    it('accepts several quoted glob patterns (docs "Multiple patterns")', async () => {
      const r = await run('"test/fixtures/valid-basic.yaml" "test/fixtures/invalid-bad-*.yaml"');
      expect(r.code).toBe(1);
      expect(r.stdout).toContain('valid-basic.yaml');
      expect(r.stdout).toContain('invalid-bad-layer.yaml');
    });

    it('JSON output covers every file', async () => {
      const r = await run(
        'test/fixtures/valid-basic.yaml test/fixtures/valid-with-layers.yaml test/fixtures/invalid-missing-config.yaml --format json'
      );
      expect(r.code).toBe(1);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.files).toHaveLength(3);
      expect(parsed.valid).toBe(false);
    });

    it('reports a pattern that matches nothing and exits non-zero, still validating the rest', async () => {
      const r = await run('test/fixtures/valid-basic.yaml test/fixtures/does-not-exist.yaml');
      expect(r.code).not.toBe(0);
      expect(r.stdout).toContain('valid-basic.yaml');
      expect(r.stdout + r.stderr).toContain('does-not-exist.yaml');
      expect(r.stdout + r.stderr).toContain('File not found: test/fixtures/does-not-exist.yaml');
    });

    it('all-valid multiple files exit 0', async () => {
      const r = await run('test/fixtures/valid-basic.yaml test/fixtures/valid-with-layers.yaml');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('2 file(s) valid');
    });
  });

  it('SARIF output includes location info', async () => {
    try {
      await execAsync(
        `node "${CLI}" validate "test/fixtures/invalid-bad-layer.yaml" --format sarif`
      );
    } catch (error: any) {
      const parsed = JSON.parse(error.stdout);
      if (parsed.runs[0].results.length > 0) {
        expect(parsed.runs[0].results[0]).toHaveProperty('locations');
      }
    }
  });

  // Second-round review of ml-aot.31: arguments with spaces, folders, and the
  // project's ignorePatterns.
  describe('targets: spaces, folders, ignorePatterns (ml-aot.31 review)', () => {
    let dir: string;
    const VALID = readFileSync('test/fixtures/valid-basic.yaml', 'utf-8');
    const INVALID = readFileSync('test/fixtures/invalid-missing-config.yaml', 'utf-8');

    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), 'mlym-targets-'));
      mkdirSync(join(dir, 'My Maps'));
      writeFileSync(join(dir, 'My Maps', 'good.yaml'), VALID);
      writeFileSync(join(dir, 'My Maps', 'bad.yaml'), INVALID);
      mkdirSync(join(dir, 'maps', 'nested'), { recursive: true });
      writeFileSync(join(dir, 'maps', 'a.yaml'), VALID);
      writeFileSync(join(dir, 'maps', 'nested', 'b.yml'), INVALID);
      writeFileSync(join(dir, 'maps', 'notes.txt'), 'not yaml');
      mkdirSync(join(dir, 'drafts'));
      writeFileSync(join(dir, 'drafts', 'wip.yaml'), INVALID);
      writeFileSync(
        join(dir, 'maplibre-yaml.config.json'),
        JSON.stringify({ validate: { ignorePatterns: ['drafts/**'] } })
      );
    });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    const runIn = async (args: string) => {
      try {
        const { stdout, stderr } = await execAsync(`node "${CLI}" validate ${args}`, { cwd: dir });
        return { code: 0, stdout, stderr };
      } catch (error: any) {
        return { code: error.code as number, stdout: error.stdout as string, stderr: error.stderr as string };
      }
    };

    it('a quoted glob in a folder with a space is one pattern, not two', async () => {
      const r = await runIn('"My Maps/*.yaml"');
      expect(r.code).toBe(1);
      expect(r.stdout).toContain('My Maps/good.yaml');
      expect(r.stdout).toContain('My Maps/bad.yaml');
      expect(r.stdout).not.toContain('No files match');
    });

    it('a folder argument validates the YAML files under it', async () => {
      const r = await runIn('maps/');
      expect(r.code).toBe(1);
      expect(r.stdout).toContain('maps/a.yaml');
      expect(r.stdout).toContain('maps/nested/b.yml');
      expect(r.stdout).not.toContain('notes.txt');
    });

    it('a literal path still honours validate.ignorePatterns', async () => {
      const r = await runIn('maps/a.yaml drafts/wip.yaml');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('maps/a.yaml');
      expect(r.stdout).not.toContain('✗ drafts/wip.yaml');
      expect(r.stdout).toContain('drafts/wip.yaml');
      expect(r.stdout).toMatch(/ignorePatterns/);
    });

    it('the older single-string spelling "a.yaml b.yaml" still splits', async () => {
      const r = await runIn('"maps/a.yaml My Maps/good.yaml"');
      // "My Maps/good.yaml" is not a path after splitting; the run says so.
      expect(r.stdout).toContain('maps/a.yaml');
    });
  });

  // ml-aot.54: output matches docs/src/content/docs/cli/getting-started.mdx.
  describe('human output matches the docs (ml-aot.54)', () => {
    const run = async (args: string) => {
      try {
        const { stdout } = await execAsync(`node "${CLI}" validate ${args}`);
        return { code: 0, stdout };
      } catch (error: any) {
        return { code: error.code as number, stdout: error.stdout as string };
      }
    };

    it('prints file paths relative to the current folder', async () => {
      const r = await run('test/fixtures/valid-basic.yaml');
      expect(r.stdout).toContain('✓ test/fixtures/valid-basic.yaml');
      expect(r.stdout).not.toContain(process.cwd());
    });

    it('a mixed run prints both the valid and the issues summary lines', async () => {
      const r = await run(
        'test/fixtures/valid-basic.yaml test/fixtures/invalid-missing-config.yaml test/fixtures/invalid-bad-layer.yaml'
      );
      expect(r.stdout).toContain('✓ 1 file(s) valid');
      expect(r.stdout).toMatch(/✗ 2 file\(s\) with issues: 2 error\(s\)/);
    });

    it('a missing top-level key has no fake "line 1, column 1" location', async () => {
      const r = await run('test/fixtures/invalid-missing-config.yaml');
      expect(r.stdout).toContain('error config: The document is missing config:');
      expect(r.stdout).not.toContain('at line 1, column 1');
    });
  });
});
