/**
 * `maplibre-yaml.config.*` settings take effect: an explicit flag wins, then
 * the settings file, then the built-in default (ml-dpe).
 *
 * @remarks
 * citty fills in an option's declared default before the command runs, so
 * `preview.port` and `preview.open` in the settings file used to lose to the
 * defaults (`3000`, open the browser) every time.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { runCommand } from 'citty';
import { explicitFlags, mergeConfig } from '../../src/lib/config-loader.js';

const startedWith = vi.hoisted(() => [] as Array<{ port: number; open: boolean; debug: boolean }>);

vi.mock('../../src/preview/server.js', () => ({
  createPreviewServer: async (_path: string, options: { port: number; open: boolean; debug: boolean }) => {
    startedWith.push(options);
    return { start: async () => {}, stop: async () => {} };
  },
}));

const { previewCommand } = await import('../../src/commands/preview.js');

describe('mlym preview: flag > settings file > default (ml-dpe)', () => {
  let dir: string;
  let listeners: { SIGINT: number; SIGTERM: number };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mlym-settings-'));
    await writeFile(join(dir, 'map.yaml'), 'type: map\n');
    vi.spyOn(process, 'cwd').mockReturnValue(dir);
    startedWith.length = 0;
    listeners = { SIGINT: process.listenerCount('SIGINT'), SIGTERM: process.listenerCount('SIGTERM') };
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    // preview registers shutdown handlers; drop the ones this test added.
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      const added = process.listeners(signal).slice(listeners[signal]);
      for (const listener of added) process.off(signal, listener);
    }
    await rm(dir, { recursive: true, force: true });
  });

  const settings = (preview: Record<string, unknown>) =>
    writeFile(join(dir, 'maplibre-yaml.config.json'), JSON.stringify({ preview }));
  const preview = async (...flags: string[]) => {
    await runCommand(previewCommand, { rawArgs: [join(dir, 'map.yaml'), ...flags] });
    return startedWith.at(-1)!;
  };

  it('uses preview.port, preview.open and preview.debug from the settings file', async () => {
    await settings({ port: 4831, open: false, debug: true });
    expect(await preview()).toEqual({ port: 4831, open: false, debug: true });
  });

  it('an explicit flag beats the settings file', async () => {
    await settings({ port: 4831, open: false, debug: true });
    expect(await preview('--port', '4832', '--open', '--no-debug')).toEqual({
      port: 4832,
      open: true,
      debug: false,
    });
    expect(await preview('--port=4833')).toMatchObject({ port: 4833, open: false });
  });

  it('without a settings file the defaults apply', async () => {
    expect(await preview()).toEqual({ port: 3000, open: true, debug: false });
  });

  it('a setting the file leaves out keeps its default', async () => {
    await settings({ open: false });
    expect(await preview()).toEqual({ port: 3000, open: false, debug: false });
  });
});

describe('explicitFlags / mergeConfig', () => {
  const definitions = { format: { alias: 'f' }, watch: { alias: 'w' } };

  it('names long flags, negations, = values and aliases; stops at --', () => {
    expect([...explicitFlags(['a.yaml', '--port', '1', '--no-open', '--debug=true', '-f', 'json', '--', '--watch'], definitions)]).toEqual([
      'port',
      'open',
      'debug',
      'format',
    ]);
    expect([...explicitFlags(['-wf', 'json'], definitions)].sort()).toEqual(['format', 'watch']);
  });

  it('a settings value replaces a defaulted CLI value but not an explicit one', () => {
    const args = { format: 'json', watch: false };
    const project = { format: 'sarif', watch: true };
    expect(mergeConfig(args, project, { rawArgs: [], definitions })).toEqual({ format: 'sarif', watch: true });
    expect(mergeConfig(args, project, { rawArgs: ['-f', 'json'], definitions })).toEqual({
      format: 'json',
      watch: true,
    });
  });
});
