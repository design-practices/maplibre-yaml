/**
 * The classics launch page's exported panes are fresh `mlym emit` output
 * (U11 build-time freshness).
 *
 * The docs build writes public/classics/<name>/exported/ with
 * `mlym emit --with-fallbacks` (scripts/classics-export.mjs, an Astro
 * config hook). This suite compiles each launch document again, from
 * scratch, with the CLI invoked independently of the hook, and requires
 * the shipped files — style.json and every sprite file — to be
 * byte-identical. It fails when a document changed and the docs were not
 * rebuilt, or when the hook stops being a plain emit (a hand-edit, a
 * post-process, a different flag).
 *
 * It also pins what the exported pane claims to be:
 *  - the honest fallback: the emitted layers are exactly the strict emit
 *    of the gallery's static preset — the effect exports to its static
 *    layer and nothing else changes;
 *  - lossy, and said so: exactly one warning, on the effect, and `--strict`
 *    refuses the document;
 *  - the same classic: each launch document is its gallery preset plus the
 *    `effect:` block (and, for crosshatch, the atlas the effect samples).
 *
 * Needs the docs build output (pnpm build) and the CLI build.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DOCS = join(dirname(fileURLToPath(import.meta.url)), "..");
const MLYM = join(DOCS, "scripts", "mlym-offline.mjs");
const PUBLIC = join(DOCS, "public");
const DIST = join(DOCS, "dist");
const SITE = "https://docs.maplibre-yaml.org";
const CLASSICS = [
  { name: "crosshatch", effect: "tonal-hatch", effectOnlyImages: ["hatch-atlas"] },
  { name: "blueprint", effect: "blueprint", effectOnlyImages: [] },
];

// `yaml` lives in core's dependency tree, not the docs package's.
const { parse: parseYAML } = createRequire(join(DOCS, "..", "packages/core/package.json"))("yaml");

function mlym(args) {
  const run = spawnSync(process.execPath, [MLYM, ...args], { encoding: "utf8" });
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

function files(dir) {
  return readdirSync(dir).sort();
}

for (const { name, effect, effectOnlyImages } of CLASSICS) {
  const doc = join(PUBLIC, "classics", `${name}.yaml`);
  const shipped = join(PUBLIC, "classics", name, "exported");

  test(`${name}: the shipped exported pane is byte-identical to a fresh mlym emit`, (t) => {
    assert.ok(
      existsSync(join(shipped, "style.json")),
      `${shipped}/style.json is missing — run the docs build (pnpm --filter @maplibre-yaml/docs build)`
    );
    const fresh = mkdtempSync(join(tmpdir(), `classics-${name}-`));
    t.after(() => rmSync(fresh, { recursive: true, force: true }));

    const run = mlym([
      "emit", doc, "--with-fallbacks",
      "--out", join(fresh, "style.json"),
      "--sprite-base", `${SITE}/classics/${name}/exported`,
    ]);
    assert.equal(run.status, 0, run.output);

    const targets = [shipped];
    if (existsSync(join(DIST, "classics", name, "exported"))) targets.push(join(DIST, "classics", name, "exported"));
    for (const target of targets) {
      assert.deepEqual(files(target), files(fresh), `${target}: different files than a fresh emit`);
      for (const file of files(fresh)) {
        assert.ok(
          readFileSync(join(target, file)).equals(readFileSync(join(fresh, file))),
          `${target}/${file} is stale: ${name}.yaml changed without regenerating — rebuild the docs`
        );
      }
    }
  });

  test(`${name}: lossy exactly once, on the effect; --strict refuses`, (t) => {
    const fresh = mkdtempSync(join(tmpdir(), `classics-${name}-`));
    t.after(() => rmSync(fresh, { recursive: true, force: true }));
    const run = mlym([
      "emit", doc, "--with-fallbacks",
      "--out", join(fresh, "style.json"),
      "--sprite-base", `${SITE}/classics/${name}/exported`,
    ]);
    assert.equal(run.status, 0, run.output);
    // The CLI prints `WARN` on a terminal and `[warn]` in CI (its CI logger).
    const warnings = run.output.split("\n").filter((l) => /\bwarn\b/i.test(l));
    assert.equal(warnings.length, 1, run.output);
    assert.match(warnings[0], new RegExp(`layers\\.buildings\\.effect: effect "${effect}"`));
    assert.match(warnings[0], /lossy/);
    assert.ok(!readFileSync(join(fresh, "style.json"), "utf8").includes('"effect"'));

    const strict = mlym(["emit", doc, "--strict"]);
    assert.notEqual(strict.status, 0, "--strict must refuse a document whose effect cannot export");
  });

  test(`${name}: the exported layers are the gallery static preset's own export`, (t) => {
    const fresh = mkdtempSync(join(tmpdir(), `classics-${name}-`));
    t.after(() => rmSync(fresh, { recursive: true, force: true }));
    const out = (n) => join(fresh, n, "style.json");
    const launch = mlym(["emit", doc, "--out", out("launch"), "--sprite-base", `${SITE}/x`]);
    const preset = mlym([
      "emit", join(PUBLIC, "configs", "gallery", `${name}.yaml`), "--strict",
      "--out", out("preset"), "--sprite-base", `${SITE}/x`,
    ]);
    assert.equal(launch.status, 0, launch.output);
    assert.equal(preset.status, 0, preset.output);
    const a = JSON.parse(readFileSync(out("launch"), "utf8"));
    const b = JSON.parse(readFileSync(out("preset"), "utf8"));
    assert.deepEqual(a.layers, b.layers);
    assert.deepEqual(a.sources, b.sources);
    assert.deepEqual(a.light, b.light);
    assert.equal(a.glyphs, b.glyphs);
  });

  test(`${name}: the launch document is its gallery preset plus the effect`, () => {
    const launch = parseYAML(readFileSync(doc, "utf8"));
    const preset = parseYAML(readFileSync(join(PUBLIC, "configs", "gallery", `${name}.yaml`), "utf8"));
    const withEffect = launch.layers.filter((l) => l.effect);
    assert.deepEqual(withEffect.map((l) => [l.id, l.effect.type]), [["buildings", effect]]);
    const stripped = {
      ...launch,
      layers: launch.layers.map(({ effect: _e, ...l }) => l),
      images: Object.fromEntries(Object.entries(launch.images).filter(([k]) => !effectOnlyImages.includes(k))),
    };
    assert.deepEqual(stripped, preset);
  });
}
