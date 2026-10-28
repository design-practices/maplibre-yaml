// @vitest-environment node
// (esbuild's API refuses jsdom's TextEncoder; the parser needs no DOM.)
/**
 * @file The CDN entry drops schema descriptions, and nothing else (ml-7qa, R1, KTD1)
 *
 * @description
 * `register.browser.js` is built with `scripts/strip-describe.ts`'s plugin,
 * which removes every `.describe(…)` from `src/schemas/*.ts` as esbuild loads
 * it. This suite holds the three things that must stay true:
 *
 * - **Validation is unchanged.** The parser is bundled twice with esbuild —
 *   with the plugin and without — and every document of the parity corpus
 *   (`tests/fixtures/parity`) and the error corpus parses to the same result
 *   (success, data, errors, warnings) through both. esbuild is tsup's own
 *   dependency (not one of core's under pnpm), so it is resolved from tsup's
 *   install, the copy the build itself runs.
 * - **The guard holds.** A `.describe()` whose argument is not a plain string
 *   fails the transform instead of shipping or being dropped silently.
 * - **Only the CDN entry is stripped.** `index.browser.js`, the npm build and
 *   the emitted JSON Schema (AE3) keep their descriptions. These dist checks
 *   skip when the package is not built, as bundle-size.test.ts does.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.hoisted(() => {
  const w = globalThis as any;
  w.URL.createObjectURL ??= () => "blob:strip-describe";
  w.URL.revokeObjectURL ??= () => {};
});

import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SCHEMA_FILE, stripDescribe, stripDescribePlugin } from "../../scripts/strip-describe";
import { PARITY_DOCUMENTS, type ParityDocument } from "../fixtures/parity";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const DIST = join(PKG_ROOT, "dist");
const SCHEMAS = join(PKG_ROOT, "src/schemas");
const ERROR_CORPUS = join(PKG_ROOT, "tests/fixtures/error-corpus");

/** Descriptions from `src/schemas/map.schema.ts`, one per line, one multi-line call. */
const MAP_DESCRIPTIONS = ["Render the attribution control in its compact form", "Globe/mercator projection toggle (maplibre-gl >= 5.0.0)"];

const CORPUS: ParityDocument[] = [
  ...PARITY_DOCUMENTS,
  ...readdirSync(ERROR_CORPUS)
    .filter((file) => file.endsWith(".yaml"))
    .sort()
    .map((file) => ({ id: `error-corpus/${file}`, suite: "parser/error-corpus.test.ts", kind: "any" as const, text: readFileSync(join(ERROR_CORPUS, file), "utf8") })),
];

describe("stripDescribe (the transform)", () => {
  const files = readdirSync(SCHEMAS).filter((f) => f.endsWith(".ts"));

  it("removes every .describe( from every schema file", () => {
    let removed = 0;
    for (const file of files) {
      const { code, removed: n } = stripDescribe(readFileSync(join(SCHEMAS, file), "utf8"), file);
      expect(code, file).not.toMatch(/\.describe\(/);
      removed += n;
    }
    // 538 at the plan commit; the exact count drifts with the schemas.
    expect(removed).toBeGreaterThan(500);
  });

  it("keeps the chain around a call: before, after, multi-line, concatenated", () => {
    const src = [
      `a: z.string().describe("x").optional(),`,
      `b: z.number().optional().describe('it\\'s "y"'),`,
      `c: z.boolean().describe(\n  "one " +\n    "two",\n),`,
      "d: z.string().describe(`plain template`).min(1),",
    ].join("\n");
    expect(stripDescribe(src, "chains.ts")).toEqual({
      code: [`a: z.string().optional(),`, `b: z.number().optional(),`, `c: z.boolean(),`, "d: z.string().min(1),"].join("\n"),
      removed: 4,
    });
  });

  it.each([
    ["a template with ${}", "export const S = z.string().describe(`the ${name} field`);"],
    ["a constant", "export const S = z.string().describe(TEXT);"],
    ["a string plus a constant", 'export const S = z.string().describe("a " + TEXT);'],
  ])("throws, naming the file and line, for %s", (_, line) => {
    expect(() => stripDescribe(`import { z } from "zod";\n${line}\n`, "synthetic.schema.ts")).toThrow(/synthetic\.schema\.ts:2 /);
  });

  it("the plugin reads only src/schemas/*.ts", () => {
    expect(SCHEMA_FILE.test(join(PKG_ROOT, "src/schemas/map.schema.ts"))).toBe(true);
    expect(SCHEMA_FILE.test(join(PKG_ROOT, "src/parser/yaml-parser.ts"))).toBe(false);
    expect(SCHEMA_FILE.test(join(PKG_ROOT, "tests/schemas/map.test.ts"))).toBe(false);
  });
});

/** The slice of esbuild's API used here (esbuild is tsup's dependency, not core's, so no types). */
interface Esbuild {
  build(options: Record<string, unknown>): Promise<unknown>;
}
interface ResolveBuild {
  onResolve(o: { filter: RegExp }, cb: (args: { path: string; importer: string; kind: string }) => { path: string; external: true } | undefined): void;
}

/** The parser's YAML entry points, as each bundle exports them. */
interface Parser {
  safeParse(text: string): unknown;
  safeParseAny(text: string): unknown;
  safeParseMapBlock(text: string): unknown;
  safeParseScrollytellingBlock(text: string): unknown;
}

describe("stripped and unstripped schemas validate the same corpus identically", () => {
  let dir = "";
  const bundles: Record<"plain" | "stripped", { parser: Parser; code: string }> = {} as never;

  beforeAll(async () => {
    const tsup = realpathSync(join(PKG_ROOT, "node_modules/tsup"));
    const esbuild = createRequire(join(tsup, "package.json"))("esbuild") as Esbuild;
    dir = mkdtempSync(join(tmpdir(), "ml-strip-describe-"));
    const entry = join(dir, "entry.ts");
    writeFileSync(entry, `export { YAMLParser } from ${JSON.stringify(join(PKG_ROOT, "src/parser/yaml-parser.ts"))};\n`);
    // The seam's import()s (readers, TOML) are never reached by a YAML parse: left external.
    const seam = resolve(PKG_ROOT, "src/formats/decoders.ts");
    const seamExternal = {
      name: "seam-external",
      setup(build: ResolveBuild) {
        build.onResolve({ filter: /.*/ }, (args) =>
          args.kind === "dynamic-import" && resolve(args.importer) === seam ? { path: args.path, external: true } : undefined
        );
      },
    };
    for (const variant of ["plain", "stripped"] as const) {
      const outfile = join(dir, `${variant}.mjs`);
      await esbuild.build({
        absWorkingDir: PKG_ROOT,
        entryPoints: [entry],
        outfile,
        bundle: true,
        format: "esm",
        platform: "browser",
        external: ["maplibre-gl"],
        logLevel: "error",
        plugins: [seamExternal, ...(variant === "stripped" ? [stripDescribePlugin as never] : [])],
      });
      const mod = (await import(/* @vite-ignore */ pathToFileURL(outfile).href)) as { YAMLParser: Parser };
      bundles[variant] = { parser: mod.YAMLParser, code: readFileSync(outfile, "utf8") };
    }
  }, 120_000);

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("the stripped bundle has no descriptions; the plain one has them", () => {
    for (const text of MAP_DESCRIPTIONS) {
      expect(bundles.plain.code, text).toContain(text);
      expect(bundles.stripped.code, text).not.toContain(text);
    }
  });

  it(`every corpus document (${CORPUS.length}) parses to the same success, data, errors and warnings`, () => {
    expect(CORPUS.length).toBeGreaterThan(50);
    let failures = 0;
    for (const doc of CORPUS) {
      const calls: (keyof Parser)[] =
        doc.kind === "map" ? ["safeParseMapBlock", "safeParseAny"] : doc.kind === "story" ? ["safeParseScrollytellingBlock", "safeParseAny"] : ["safeParseAny", "safeParse"];
      for (const call of calls) {
        const plain = bundles.plain.parser[call](doc.text) as { success?: boolean; result?: { success: boolean } };
        const stripped = bundles.stripped.parser[call](doc.text);
        expect(stripped, `${doc.id} via ${call}`).toEqual(plain);
        if ((plain.result ?? plain).success === false) failures++;
      }
    }
    // The corpus exercises the error paths, not just valid documents.
    expect(failures).toBeGreaterThan(20);
  });
});

/** Static import specifiers of a minified ESM file. */
function staticImports(code: string): string[] {
  const found = new Set<string>();
  for (const m of code.matchAll(/(?:^|[;\n])import\s*(?:[\w$*{][^'"]*?from\s*)?['"]([^'"]+)['"]/g)) found.add(m[1]!);
  for (const m of code.matchAll(/(?:^|[;\n])export\s*(?:\*|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/g)) found.add(m[1]!);
  return [...found];
}

/** `file` and every dist module it imports statically, transitively. */
function staticClosure(file: string): string[] {
  const seen = new Set<string>();
  const queue = [file];
  while (queue.length > 0) {
    const next = queue.shift()!;
    if (seen.has(next)) continue;
    seen.add(next);
    for (const spec of staticImports(readFileSync(join(DIST, next), "utf8"))) {
      if (spec.startsWith(".")) queue.push(relative(DIST, resolve(DIST, dirname(next), spec)).split(sep).join("/"));
    }
  }
  return [...seen];
}

const built = ["register.browser.js", "index.browser.js", "index.js"].every((f) => existsSync(join(DIST, f)));
if (process.env.CI && !built) throw new Error("dist/ missing under CI — the build step must run before tests");

describe.skipIf(!built)("the builds: only the CDN entry is stripped", () => {
  const read = (f: string) => readFileSync(join(DIST, f), "utf8");

  it("register.browser.js carries no schema description", () => {
    const main = read("register.browser.js");
    for (const text of MAP_DESCRIPTIONS) expect(main.includes(text), text).toBe(false);
  });

  it("index.browser.js (tooling pages) keeps them", () => {
    const code = read("index.browser.js");
    for (const text of MAP_DESCRIPTIONS) expect(code, text).toContain(text);
  });

  it("the npm build (dist/index.js and what it imports) keeps them", () => {
    const closure = staticClosure("index.js").map(read).join("\n");
    for (const text of MAP_DESCRIPTIONS) expect(closure, text).toContain(text);
  });
});

const schemaJson = join(PKG_ROOT, "schemas/map.schema.json");

describe.skipIf(!existsSync(schemaJson))("the emitted JSON Schema keeps its descriptions (AE3)", () => {
  it("schemas/map.schema.json still describes its fields", () => {
    const json = readFileSync(schemaJson, "utf8");
    for (const text of MAP_DESCRIPTIONS) expect(json, text).toContain(`"description": ${JSON.stringify(text)}`);
    expect(json.match(/"description":/g)?.length ?? 0).toBeGreaterThan(300);
  });
});
