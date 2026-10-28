/**
 * Shared by the converter tests: the research's four documents, and the
 * authored value of text in each format (what the converter must keep).
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYAML } from "yaml";
import { parseTOML } from "toml-eslint-parser";
import { YAML_PARSE_OPTIONS, type DocumentFormat } from "../../src";
import { readToml } from "../../src/parser/toml/index";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/toml");
export const fixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

/** The four documents of the research's side-by-side section, by name. */
export const DOCUMENTS = ["quick-start", "choropleth", "story", "locale"] as const;

/** The value the author wrote, read straight from the text (no validation, no defaults). */
export function authored(text: string, format: DocumentFormat): unknown {
  if (format === "toml") {
    const read = readToml(text);
    if (!read.ok) throw new Error(read.error.message);
    return read.value;
  }
  return parseYAML(text, YAML_PARSE_OPTIONS);
}

/** A copy without the root `$schema` and with every null-valued key left out (TOML has no null). */
export function comparable(value: unknown, dropNulls: boolean): unknown {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v === null || typeof v !== "object") return v;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if (dropNulls && x === null) continue;
      Object.defineProperty(out, k, { value: walk(x), enumerable: true, writable: true, configurable: true });
    }
    return out;
  };
  const copy = walk(value) as Record<string, unknown>;
  if (copy && typeof copy === "object" && !Array.isArray(copy)) delete copy.$schema;
  return copy;
}

/** Throws unless `text` is TOML 1.0 (toml-eslint-parser defaults to 1.1). */
export function parseToml10(text: string): void {
  parseTOML(text, { tomlVersion: "1.0.0" } as never);
}

/** Lines that open an inline table and do not close it on the same line (strings blanked). */
export function multiLineInlineTables(text: string): string[] {
  return text
    .split("\n")
    .filter((line) => {
      const bare = line.replace(/"(?:[^"\\]|\\.)*"/g, '""');
      let depth = 0;
      for (const c of bare) {
        if (c === "{") depth++;
        else if (c === "}") depth--;
      }
      return depth !== 0;
    });
}
