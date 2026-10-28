/**
 * @file U5 (ml-4cn.6): the research's four documents through every pair of formats
 *
 * Each document starts as its YAML original, is converted to JSON and TOML,
 * and each of the three is converted to each of the three. Every output must
 * hold the authored value (TOML has no null, so a dropped `filter: null` is
 * the one allowed difference), validate as cleanly as the original, and,
 * for TOML, be TOML 1.0. The converted TOML also matches the research's
 * hand-written TOML value.
 */

import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  const w = globalThis as any;
  w.URL.createObjectURL ??= () => "blob:convert";
  w.URL.revokeObjectURL ??= () => {};
});

import { convertDocument, parseDocumentText, type DocumentFormat } from "../../src";
import { DOCUMENTS, authored, comparable, fixture, multiLineInlineTables, parseToml10 } from "./helpers";

const FORMATS: DocumentFormat[] = ["yaml", "json", "toml"];

async function convert(text: string, from: DocumentFormat, to: DocumentFormat): Promise<string> {
  const result = await convertDocument(text, { from, to });
  if (!result.success) throw new Error(`${from} → ${to}: ${JSON.stringify(result.errors)}`);
  return result.text;
}

describe.each(DOCUMENTS)("%s", (name) => {
  const yaml = fixture(`${name}.yaml`);

  it("converts between every pair of formats, keeping the authored value", async () => {
    const original = authored(yaml, "yaml");
    const sources: Record<DocumentFormat, string> = {
      yaml,
      json: await convert(yaml, "yaml", "json"),
      toml: await convert(yaml, "yaml", "toml"),
    };
    for (const from of FORMATS) {
      for (const to of FORMATS) {
        const out = await convert(sources[from], from, to);
        const viaToml = from === "toml" || to === "toml";
        expect(comparable(authored(out, to), viaToml), `${from} → ${to}`).toEqual(comparable(original, viaToml));
        if (to === "toml") {
          expect(() => parseToml10(out), `${from} → toml is TOML 1.0`).not.toThrow();
          expect(multiLineInlineTables(out), `${from} → toml`).toEqual([]);
        }
        const validation = await parseDocumentText(out, { format: to });
        expect(validation.result.errors, `${from} → ${to}`).toEqual([]);
      }
    }
  });

  it("writes the value of the research's hand-written TOML", async () => {
    const toml = await convert(yaml, "yaml", "toml");
    expect(comparable(authored(toml, "toml"), true)).toEqual(comparable(authored(fixture(`${name}.toml`), "toml"), true));
  });

  it("converts the hand-written TOML back to the YAML original's value", async () => {
    const back = await convert(fixture(`${name}.toml`), "toml", "yaml");
    expect(comparable(authored(back, "yaml"), true)).toEqual(comparable(authored(yaml, "yaml"), true));
  });
});

describe("YAML → TOML → YAML", () => {
  it("keeps the data and the diagnostics of a document with mistakes", async () => {
    const yaml = fixture("quick-start-planted.yaml");
    const toml = await convert(yaml, "yaml", "toml");
    const back = await convert(toml, "toml", "yaml");
    expect(authored(back, "yaml")).toEqual(authored(yaml, "yaml"));

    const findings = async (text: string) => {
      const { result } = await parseDocumentText(text, { format: "yaml" });
      const strip = (list: Array<{ path: string; message: string }>) => list.map(({ path, message }) => ({ path, message }));
      return { errors: strip(result.errors), warnings: strip(result.warnings) };
    };
    const before = await findings(yaml);
    expect(before.errors.length).toBeGreaterThan(0);
    expect(await findings(back)).toEqual(before);
  });
});
