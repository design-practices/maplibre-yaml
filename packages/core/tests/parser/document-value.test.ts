/**
 * @file readDocumentValue: a document's raw value in YAML, JSON or TOML
 *
 * The value as written (no validation, no normalization: `$schema` stays,
 * dates stay text), read with the same guards as validation (the merge
 * fan-out refusal and the alias budget), and the same value for the same
 * data in each format (`!html` and `{ "$html" = … }` alike).
 */

import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  const w = globalThis as any;
  w.URL.createObjectURL ??= () => "blob:document-value";
  w.URL.revokeObjectURL ??= () => {};
});

vi.mock("../../src/formats/decoders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/formats/decoders")>();
  return { ...actual, getDecoder: vi.fn(actual.getDecoder) };
});

import { readDocumentValue } from "../../src";
import { getDecoder } from "../../src/formats/decoders";

const SCHEMA = "https://docs.maplibre-yaml.org/schema/latest/map.schema.json";

const YAML = `$schema: ${SCHEMA}
type: map
id: m
when: 2024-01-02
popup: !html "<b>Hi</b>"
config:
  center: [0, 0]
  zoom: 2
`;
const JSON_DOC = JSON.stringify({
  $schema: SCHEMA,
  type: "map",
  id: "m",
  when: "2024-01-02",
  popup: { $html: "<b>Hi</b>" },
  config: { center: [0, 0], zoom: 2 },
});
const TOML = `"$schema" = "${SCHEMA}"
type = "map"
id = "m"
when = 2024-01-02
popup = { "$html" = "<b>Hi</b>" }

[config]
center = [0, 0]
zoom = 2
`;

const EXPECTED = {
  $schema: SCHEMA,
  type: "map",
  id: "m",
  when: "2024-01-02",
  popup: { $html: "<b>Hi</b>" },
  config: { center: [0, 0], zoom: 2 },
};

const ok = (r: Awaited<ReturnType<typeof readDocumentValue>>) => {
  if (!r.success) throw new Error(JSON.stringify(r.errors));
  return r;
};

describe("readDocumentValue", () => {
  it("is exported from the package root", async () => {
    const core = await import("../../src");
    expect(typeof core.readDocumentValue).toBe("function");
  });

  it("gives the same raw value for the same data in YAML, JSON and TOML ($schema kept, dates as text, !html as {$html})", async () => {
    const yaml = ok(await readDocumentValue(YAML, { signals: { fileName: "m.yaml" } }));
    const json = ok(await readDocumentValue(JSON_DOC, { signals: { fileName: "m.json" } }));
    const toml = ok(await readDocumentValue(TOML, { signals: { fileName: "m.toml" } }));
    expect(yaml.format).toBe("yaml");
    expect(json.format).toBe("json");
    expect(toml.format).toBe("toml");
    // YAML 1.2 (the core schema) leaves 2024-01-02 a string.
    expect(yaml.value).toEqual(EXPECTED);
    expect(json.value).toEqual(EXPECTED);
    expect(toml.value).toEqual(EXPECTED);
  });

  it("sniffs the format without signals, and an explicit format wins", async () => {
    expect((await readDocumentValue(TOML)).format).toBe("toml");
    expect((await readDocumentValue(JSON_DOC)).format).toBe("json");
    expect((await readDocumentValue(YAML)).format).toBe("yaml");
    expect((await readDocumentValue(JSON_DOC, { format: "yaml" })).format).toBe("yaml");
  });

  it("refuses a YAML merge fan-out, as validation does", async () => {
    const bomb = "a: &a { x: 1 }\nb: &b { y: 2 }\nc:\n  <<: [*a, *b]\n";
    const r = await readDocumentValue(bomb, { format: "yaml" });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.errors[0]).toMatchObject({ code: "yaml-expansion", format: "yaml" });
    const repeated = "a: &a { x: 1 }\nc: { <<: *a, <<: *a }\n";
    expect((await readDocumentValue(repeated, { format: "yaml" })).success).toBe(false);
  });

  it("refuses an alias bomb past the alias budget", async () => {
    const lines = ['a: &a ["x","x","x","x","x","x","x","x","x","x"]'];
    for (let i = 1; i < 12; i++) {
      const prev = String.fromCharCode(96 + i);
      const next = String.fromCharCode(97 + i);
      lines.push(`${next}: &${next} [${Array(10).fill(`*${prev}`).join(",")}]`);
    }
    const r = await readDocumentValue(lines.join("\n"), { format: "yaml" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.errors[0]!.code).toBe("yaml-expansion");
  });

  it("accepts a TOML integer past 2^53, as a number", async () => {
    const r = ok(await readDocumentValue('type = "map"\nid = "m"\nbig = 9007199254740993\n', { format: "toml" }));
    expect(typeof (r.value as any).big).toBe("number");
    expect((r.value as any).big).toBe(9007199254740992);
  });

  it("keeps a `<<` key in TOML a key", async () => {
    const r = ok(await readDocumentValue('[a]\n"<<" = { x = 1 }\ny = 2\n', { format: "toml" }));
    expect(Object.getOwnPropertyDescriptor((r.value as any).a, "<<")?.value).toEqual({ x: 1 });
  });

  it("words syntax errors for the format, with line and column", async () => {
    const json = await readDocumentValue('{\n  "a": 1\n  "b": 2\n}', { format: "json" });
    expect(json.success).toBe(false);
    if (!json.success) {
      expect(json.errors[0]!.message).toMatch(/^JSON syntax error:/);
      expect(json.errors[0]!.line).toBeDefined();
      expect(json.errors[0]!.format).toBe("json");
    }
    const comment = await readDocumentValue('// hi\n{"a": 1}', { format: "json" });
    expect(comment.success).toBe(false);
    if (!comment.success) expect(comment.errors[0]!.message).toContain("comments are not allowed in JSON");
    const toml = await readDocumentValue('a = "x\nb = 1\n', { format: "toml" });
    expect(toml.success).toBe(false);
    if (!toml.success) expect(toml.errors[0]).toMatchObject({ code: "toml-syntax", format: "toml", line: 1 });
    const yaml = await readDocumentValue("a: [1, 2\nb: 3\n", { format: "yaml" });
    expect(yaml.success).toBe(false);
    if (!yaml.success) expect(yaml.errors[0]!.message).toMatch(/^YAML syntax error:/);
  });

  it("never rejects on content; empty YAML is null, empty TOML an empty table", async () => {
    expect(await readDocumentValue("", { format: "yaml" })).toEqual({ success: true, value: null, format: "yaml" });
    expect(await readDocumentValue("﻿", { format: "toml" })).toEqual({ success: true, value: {}, format: "toml" });
    const notText = await readDocumentValue(42 as never);
    expect(notText.success).toBe(false);
  });

  it("does not load the TOML reader for YAML or JSON", async () => {
    vi.mocked(getDecoder).mockClear();
    await readDocumentValue(YAML);
    await readDocumentValue(JSON_DOC);
    expect(getDecoder).not.toHaveBeenCalled();
  });

  it("rejects when the TOML reader cannot be loaded, like parseDocumentText", async () => {
    vi.mocked(getDecoder).mockRejectedValueOnce(new Error("chunk failed"));
    await expect(readDocumentValue(TOML, { format: "toml" })).rejects.toThrow("chunk failed");
  });
});
