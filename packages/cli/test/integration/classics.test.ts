/**
 * @file The Mapzen-classic static presets (U10′): each is its own eject
 *
 * The gallery's crosshatch and blueprint documents are pure style spec, so
 * the static preset IS the fallback. This suite pins that claim from the
 * command line's side:
 *  - both the docs documents and their hermetic twins validate under
 *    `mlym validate --strict`;
 *  - `mlym emit --strict` compiles the docs documents with ZERO warnings —
 *    no runtime construct to declare absent, nothing lossy — and every
 *    pattern reference (including the data-driven landcover `match`) lands
 *    in the document sprite;
 *  - the sprite rasterizes from the committed images (offline: the images
 *    are read from docs/public, the files the docs site serves);
 *  - each twin differs from its docs page only in where tiles, images and
 *    glyphs come from;
 *  - `mlym bake` reproduces the committed images pixel for pixel.
 *
 * The browser half (renders, buildings drawn, hatch on screen) lives in
 * e2e/gallery.spec.ts.
 */
import { describe, it, expect } from 'vitest';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { join } from 'pathe';
import sharp from 'sharp';
import { parse as parseYAML } from 'yaml';
import { YAMLParser } from '@maplibre-yaml/core';
import { emitStyle } from '../../src/commands/emit';
import { rasterizeSpriteFiles, type ResolvedImage } from '../../src/lib/rasterize';
import { BAKE_PRESETS, defaultAssetsDir } from '../../src/lib/bake';

const execAsync = promisify(exec);
const CLI = join(process.cwd(), 'dist/cli.js');
const REPO = join(process.cwd(), '../..');
const DOCS_ORIGIN = 'https://docs.maplibre-yaml.org';
const docsPath = (slug: string) => join(REPO, 'docs/public/configs/gallery', `${slug}.yaml`);
const twinPath = (slug: string) => join(REPO, 'examples/gallery/configs', `${slug}.yaml`);

const PRESETS = ['crosshatch', 'blueprint'] as const;

function parseDoc(path: string) {
  const result = YAMLParser.safeParseMapBlock(readFileSync(path, 'utf-8'));
  if (!result.success) throw new Error(JSON.stringify(result.errors));
  return result.data;
}

/** Every object key in the emitted style, at any depth. */
function allKeys(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((n) => allKeys(n, out));
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      out.push(k);
      allKeys(v, out);
    }
  }
  return out;
}

describe.each(PRESETS)('classic preset: %s', (slug) => {
  it('validates strict — docs document and hermetic twin', async () => {
    for (const path of [docsPath(slug), twinPath(slug)]) {
      await expect(execAsync(`node "${CLI}" validate --strict "${path}"`)).resolves.toBeDefined();
    }
  });

  it('emits strict with zero warnings, no runtime keys, every pattern in the sprite', async () => {
    const { style, warnings, images } = await emitStyle(parseDoc(docsPath(slug)), 'strict', {
      trust: 'untrusted',
    });
    expect(warnings).toEqual([]);

    const keys = allKeys(style);
    for (const forbidden of ['runtime', 'interactive', 'legend', 'toggleable', 'label']) {
      expect(keys, `emitted style carries "${forbidden}"`).not.toContain(forbidden);
    }
    expect(keys.filter((k) => k.startsWith('x-'))).toEqual([]);

    // Every declared image is a fetch-at-emit ref with an absolute URL…
    const doc = parseYAML(readFileSync(docsPath(slug), 'utf-8'));
    expect(images?.map((i) => i.name).sort()).toEqual(Object.keys(doc.images).sort());
    for (const ref of images ?? []) expect(ref.url.startsWith(`${DOCS_ORIGIN}/`)).toBe(true);

    // …and every *-pattern reference resolves into the document sprite.
    const patterns = (style['layers'] as Record<string, any>[]).flatMap((l) =>
      Object.entries(l['paint'] ?? {})
        .filter(([k]) => k.endsWith('-pattern'))
        .map(([, v]) => v)
    );
    expect(patterns.length).toBeGreaterThan(0);
    const names = JSON.stringify(patterns).match(/"[a-z-]+:[a-z-]+"|"[a-z-]+"/g) ?? [];
    for (const name of names) {
      const bare = name.slice(1, -1);
      if (['match', 'get', 'class', 'sand'].includes(bare)) continue;
      expect(bare.startsWith('mlym:'), `pattern ref ${bare} not rewritten`).toBe(true);
    }
  });

  it('the sprite rasterizes from the committed images (what the docs site serves)', async () => {
    const { images } = await emitStyle(parseDoc(docsPath(slug)), 'strict', { trust: 'untrusted' });
    const resolved: ResolvedImage[] = await Promise.all(
      (images ?? []).map(async (ref) => {
        const data = readFileSync(join(REPO, 'docs/public', new URL(ref.url).pathname));
        const meta = await sharp(data).metadata();
        const density = ref.pixelRatio ?? 1;
        return {
          name: ref.name,
          url: ref.url,
          data,
          width: Math.round(meta.width! / density),
          height: Math.round(meta.height! / density),
        };
      })
    );
    const files = await rasterizeSpriteFiles([], resolved);
    const index = JSON.parse(
      files.find((f) => f.filename === 'mlym.json')!.data.toString('utf-8')
    );
    expect(Object.keys(index).sort()).toEqual(resolved.map((r) => r.name).sort());
  });

  it('the twin differs from the docs page only in where tiles, images and glyphs come from', () => {
    const docs = parseYAML(readFileSync(docsPath(slug), 'utf-8'));
    const twin = parseYAML(readFileSync(twinPath(slug), 'utf-8'));
    expect(twin.layers).toEqual(docs.layers);
    expect(twin.light).toEqual(docs.light);
    expect(twin.config.center).toEqual(docs.config.center);
    expect(twin.config.zoom).toEqual(docs.config.zoom);
    expect(twin.config.pitch).toEqual(docs.config.pitch);
    expect(twin.config.bearing).toEqual(docs.config.bearing);
    // Same images, same densities; the twin serves the docs' own files.
    expect(Object.keys(twin.images)).toEqual(Object.keys(docs.images));
    for (const [name, img] of Object.entries<any>(docs.images)) {
      expect(twin.images[name].pixelRatio).toBe(img.pixelRatio);
      expect(`${DOCS_ORIGIN}${twin.images[name].url.replace('/docs/public', '')}`).toBe(img.url);
    }
    // Same source-layers from the same schema, only the transport differs.
    expect(Object.keys(twin.sources)).toEqual(Object.keys(docs.sources));
    expect(twin.sources.omt.type).toBe('vector');
  });
});

describe('mlym bake reproduces the committed classic images', () => {
  it.each(Object.entries(BAKE_PRESETS))('%s', async (preset, def) => {
    const files = await def.bake(defaultAssetsDir());
    expect(files.map((f) => f.filename)).toEqual([...def.outputs]);
    for (const file of files) {
      const committed = join(REPO, 'docs/public/classics', preset, file.filename);
      const a = await sharp(file.data).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const b = await sharp(committed).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      expect([a.info.width, a.info.height]).toEqual([b.info.width, b.info.height]);
      // Decoded RGBA, not PNG bytes: encoders differ across libvips builds.
      expect(Buffer.compare(a.data, b.data), `${preset}/${file.filename} drifted`).toBe(0);
    }
  });

  it('the CLI lists the presets and refuses an unknown one', async () => {
    const { stdout, stderr } = await execAsync(`node "${CLI}" bake`);
    expect(stdout + stderr).toMatch(/crosshatch/);
    expect(stdout + stderr).toMatch(/blueprint/);
    await expect(execAsync(`node "${CLI}" bake nope --out /tmp/x`)).rejects.toMatchObject({
      code: 1,
    });
  });
});
