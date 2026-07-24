/**
 * @file Round-trip converter-fidelity guard.
 *
 * Every canonical example config (`docs/public/configs/*.yaml`) and every CLI
 * scaffold template must validate against BOTH:
 *   1. the Zod source of truth (`YAMLParser.safeParse*`), and
 *   2. the generated JSON Schema (via ajv).
 *
 * This catches divergence between the Zod schemas and their JSON Schema
 * projection — the whole point of the emitter. The schemas are built in memory
 * via `buildSchemas()` so the test does not depend on `pnpm build`.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYAML } from "yaml";
import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { buildSchemas } from "../../scripts/emit-json-schema";
import { YAMLParser } from "../../src/parser/yaml-parser";

const REPO_ROOT = join(process.cwd(), "..", "..");
const CONFIGS_DIR = join(REPO_ROOT, "docs", "public", "configs");
const TEMPLATES_DIR = join(REPO_ROOT, "packages", "cli", "templates");

let validators: Record<"map" | "scrollytelling" | "root" | "any", ValidateFunction>;

beforeAll(() => {
  const schemas = buildSchemas();
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  validators = {
    map: ajv.compile(schemas.map),
    scrollytelling: ajv.compile(schemas.scrollytelling),
    root: ajv.compile(schemas.root),
    any: ajv.compile(schemas.any),
  };
});

/** Pick the type-specific validator + Zod parse for a parsed document. */
function classify(doc: any): {
  kind: "map" | "scrollytelling" | "root";
  zod: (yaml: string) => { success: boolean; errors: unknown[] };
} {
  if (doc?.type === "map") {
    return { kind: "map", zod: (y) => YAMLParser.safeParseMapBlock(y) };
  }
  if (doc?.type === "scrollytelling") {
    return {
      kind: "scrollytelling",
      zod: (y) => YAMLParser.safeParseScrollytellingBlock(y),
    };
  }
  return { kind: "root", zod: (y) => YAMLParser.safeParse(y) };
}

function renderTemplate(content: string, vars: Record<string, string>): string {
  let out = content;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }
  return out;
}

function ajvErrors(fn: ValidateFunction): string {
  return JSON.stringify(fn.errors, null, 2);
}

describe("JSON Schema round-trip (Zod ⇄ JSON Schema)", () => {
  // --- Canonical example configs -----------------------------------------
  const configFiles = existsSync(CONFIGS_DIR)
    ? readdirSync(CONFIGS_DIR).filter((f) => f.endsWith(".yaml"))
    : [];

  it("finds canonical configs to check", () => {
    expect(configFiles.length).toBeGreaterThan(0);
  });

  it.each(configFiles)("config %s validates against Zod + JSON Schema", (file) => {
    const yaml = readFileSync(join(CONFIGS_DIR, file), "utf-8");
    const doc = parseYAML(yaml);
    const { kind, zod } = classify(doc);

    // 1. Zod source of truth
    const zres = zod(yaml);
    expect(zres.success, `Zod rejected ${file}: ${JSON.stringify(zres.errors)}`).toBe(true);

    // 2. Generated JSON Schema (type-specific + the `any` dispatcher)
    const specific = validators[kind];
    expect(specific(doc), `${kind} schema rejected ${file}: ${ajvErrors(specific)}`).toBe(true);
    expect(validators.any(doc), `any schema rejected ${file}: ${ajvErrors(validators.any)}`).toBe(true);
  });

  // --- CLI scaffold templates --------------------------------------------
  const templateCases: Array<{ name: string; yaml: string; meta: string }> = [
    { name: "basic", yaml: "basic/map.yaml", meta: "basic/template.json" },
    { name: "story", yaml: "story/story.yaml", meta: "story/template.json" },
    {
      name: "astro",
      yaml: "astro/public/configs/map.yaml",
      meta: "astro/template.json",
    },
  ];

  it.each(templateCases)(
    "template $name validates (rendered) against Zod + JSON Schema",
    ({ yaml, meta }) => {
      const metadata = JSON.parse(
        readFileSync(join(TEMPLATES_DIR, meta), "utf-8"),
      );
      const vars: Record<string, string> = Object.fromEntries(
        (metadata.variables ?? []).map((v: any) => [v.name, v.default]),
      );
      const rendered = renderTemplate(
        readFileSync(join(TEMPLATES_DIR, yaml), "utf-8"),
        vars,
      );
      const doc = parseYAML(rendered);
      const { kind, zod } = classify(doc);

      const zres = zod(rendered);
      expect(zres.success, `Zod rejected ${yaml}: ${JSON.stringify(zres.errors)}`).toBe(true);

      const specific = validators[kind];
      expect(specific(doc), `${kind} schema rejected ${yaml}: ${ajvErrors(specific)}`).toBe(true);
    },
  );

  // --- Every scaffold template carries the editor modeline ----------------
  it.each(templateCases)("template $name has a yaml-language-server modeline", ({ yaml }) => {
    const raw = readFileSync(join(TEMPLATES_DIR, yaml), "utf-8");
    expect(raw.split("\n")[0]).toContain("yaml-language-server: $schema=");
  });
});
