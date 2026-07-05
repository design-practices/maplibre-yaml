/**
 * CLI validation warnings and CI-strict behaviour (decision D9).
 *
 * Exercises the built binary end-to-end:
 *  - warnings are printed in human / json / sarif with line + column,
 *  - CI=true promotes warnings to errors (exit 1),
 *  - --no-strict overrides the CI default,
 *  - --strict promotes even outside CI.
 */
import { describe, it, expect } from 'vitest';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'pathe';

const execAsync = promisify(exec);
const CLI = join(process.cwd(), 'dist/cli.js');
const FIXTURE = 'test/fixtures/warns-unknown-key.yaml';

/** Env with CI explicitly disabled (test host may itself be CI). */
const NO_CI = { ...process.env, CI: '' };
/** Env with CI explicitly enabled. */
const IN_CI = { ...process.env, CI: 'true' };

describe('CLI validation warnings (integration)', () => {
  it('prints warnings with line/column in human format and exits 0', async () => {
    const { stdout } = await execAsync(`node "${CLI}" validate "${FIXTURE}"`, {
      env: NO_CI,
    });
    expect(stdout).toContain('warning');
    expect(stdout).toContain('circle-radis');
    expect(stdout).toContain('Did you mean "circle-radius"?');
    expect(stdout).toContain('at line 12, column 7');
  });

  it('includes warnings with line/column in JSON output', async () => {
    const { stdout } = await execAsync(
      `node "${CLI}" validate "${FIXTURE}" --format json`,
      { env: NO_CI }
    );
    const parsed = JSON.parse(stdout);
    expect(parsed.valid).toBe(true);
    const warnings = parsed.files[0].warnings;
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      path: 'layers.0.paint.circle-radis',
      line: 12,
      column: 7,
      severity: 'warning',
    });
    expect(parsed.summary.warningCount).toBe(1);
  });

  it('emits warning-level SARIF results with region line/column', async () => {
    const { stdout } = await execAsync(
      `node "${CLI}" validate "${FIXTURE}" --format sarif`,
      { env: NO_CI }
    );
    const sarif = JSON.parse(stdout);
    const results = sarif.runs[0].results;
    expect(results).toHaveLength(1);
    expect(results[0].level).toBe('warning');
    expect(results[0].locations[0].physicalLocation.region).toMatchObject({
      startLine: 12,
      startColumn: 7,
    });
  });

  it('promotes warnings to errors and exits 1 when CI=true', async () => {
    try {
      await execAsync(`node "${CLI}" validate "${FIXTURE}"`, { env: IN_CI });
      expect.unreachable('should have exited non-zero under CI');
    } catch (error: any) {
      expect(error.code).toBe(1);
      expect(error.stdout).toContain('error');
      expect(error.stdout).toContain('circle-radis');
    }
  });

  it('--no-strict overrides the CI default and exits 0', async () => {
    const { stdout } = await execAsync(
      `node "${CLI}" validate "${FIXTURE}" --no-strict`,
      { env: IN_CI }
    );
    expect(stdout).toContain('warning');
  });

  it('--strict promotes warnings to errors even outside CI', async () => {
    try {
      await execAsync(`node "${CLI}" validate "${FIXTURE}" --strict`, {
        env: NO_CI,
      });
      expect.unreachable('should have exited non-zero with --strict');
    } catch (error: any) {
      expect(error.code).toBe(1);
      expect(error.stdout).toContain('error');
    }
  });

  it('does not promote warnings outside CI by default (exit 0)', async () => {
    const { stdout } = await execAsync(`node "${CLI}" validate "${FIXTURE}"`, {
      env: NO_CI,
    });
    expect(stdout).toContain('warning');
    expect(stdout).not.toContain('1 error(s)');
  });
});
