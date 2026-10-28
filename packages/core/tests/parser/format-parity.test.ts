/**
 * @file U10 (R4, R6): the same document in YAML, JSON and TOML gives the same findings
 *
 * The corpus is every document in `tests/fixtures/parity` (the whole
 * documents the checks suites parse) plus every file in
 * `tests/fixtures/error-corpus`. Each document is read as YAML, converted to
 * JSON and to TOML with `convertDocument`, and each conversion is read back
 * with `parseDocumentText`. For each format the test asserts:
 *
 * - the same `success`, `blockType` and validated value (R4);
 * - the same errors and warnings, in order: path, message, suggestion, code,
 *   kind and onPage. Messages are compared with quoted line numbers masked
 *   (`lines 12 and 15` names each format's own lines), and, for JSON only,
 *   with the missing-key fix normalised, because JSON deliberately spells
 *   that fix as JSON (`add "center": […]`) where YAML and TOML write
 *   `add center: […]`;
 * - every finding YAML positions is positioned in JSON and TOML too, and at
 *   the offending key or value (R6), as below.
 *
 * **How "at the offending key or value" is decided.** The pipeline answers a
 * position for a path with the node at that path, else its nearest ancestor
 * (`positionForPath`, and the TOML index behind KTD5). A finding is *exact*
 * when its line and column are where the key or the value at its path starts
 * in that format's text, looked up independently of the pipeline: with the
 * `yaml` library's tree for YAML and JSON, and with the TOML reader's index
 * (`walkPath`, `keyAt`) for TOML. A finding that is not exact fell back to an
 * ancestor (or is anchored somewhere else on purpose). A JSON or TOML finding
 * that is not exact fails the test unless the YAML finding is not exact
 * either, so a missing key (positioned at its parent in every format) passes
 * and a TOML position that lost its node does not.
 *
 * **Messages that quote lines** are also checked in each format's own text:
 * every quoted line must hold the key the finding's path ends in.
 *
 * Nothing is skipped silently. A document that cannot convert is listed in
 * {@link NOT_CONVERTIBLE} with its reason, the conversion must fail for that
 * reason, and the other leg still runs. A finding whose message cannot be the
 * same across formats is listed in {@link FORMAT_SPECIFIC_MESSAGES}, and its
 * messages must differ, so a stale entry fails too.
 *
 * The last block reads a ~5 MB TOML document and the same document in YAML,
 * and holds TOML to at most 1.9× YAML's time (U3's benchmark measured 1.72×).
 */

import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  const w = globalThis as any;
  w.URL.createObjectURL ??= () => "blob:parity";
  w.URL.revokeObjectURL ??= () => {};
});

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LineCounter, isMap, parseDocument } from "yaml";
import { convertDocument, parseDocumentText, YAML_PARSE_OPTIONS, type DocumentFormat } from "../../src";
import { readToml } from "../../src/parser/toml/index";
import { walkPath, type TomlPositions } from "../../src/parser/toml/index-positions";
import { PARITY_DOCUMENTS, studentMistakes, type ParityDocument } from "../fixtures/parity";

const ERROR_CORPUS = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/error-corpus");

const CORPUS: ParityDocument[] = [
  ...PARITY_DOCUMENTS,
  ...readdirSync(ERROR_CORPUS)
    .filter((file) => file.endsWith(".yaml"))
    .sort()
    .map((file) => ({
      id: `error-corpus/${file}`,
      suite: "parser/error-corpus.test.ts",
      kind: "any" as const,
      text: readFileSync(join(ERROR_CORPUS, file), "utf8"),
    })),
];

type Target = "json" | "toml";

const SYNTAX = "a YAML syntax error: there is no document to convert";
const TOML_NULL =
  "TOML has no null: YAML reads the unquoted # as a comment, so the value is null, and leaving the key out would change the document";

/** Documents that cannot be converted, per target, and why. Their other leg still runs. */
const NOT_CONVERTIBLE: Record<string, Partial<Record<Target, string>>> = {
  "student-mistakes/hex-in-flow-map": { json: SYNTAX, toml: SYNTAX },
  "error-corpus/syntax-unterminated-string.yaml": { json: SYNTAX, toml: SYNTAX },
  "student-mistakes/unquoted-hex": { toml: TOML_NULL },
  "student-mistakes/empty-key-comment": { toml: TOML_NULL },
};

/**
 * Findings whose message is about the format itself, keyed by document and
 * path. The finding must still match in every other field and position.
 */
const FORMAT_SPECIFIC_MESSAGES: Record<string, Partial<Record<Target, { path: string; reason: string }>>> = {
  "student-mistakes/unquoted-hex": {
    json: {
      path: "layers.0.paint.circle-color",
      reason:
        "YAML's message is about YAML reading # as a comment. The JSON conversion holds the null YAML read, " +
        "written out, so JSON reports the null itself (Expected string or array, got null).",
    },
  },
};

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

interface Finding {
  path: string;
  message: string;
  suggestion?: string;
  code?: string;
  kind?: string;
  onPage?: boolean;
  line?: number;
  column?: number;
}

interface Read {
  success: boolean;
  blockType?: string;
  data: unknown;
  errors: Finding[];
  warnings: Finding[];
}

async function read(text: string, kind: ParityDocument["kind"], format: DocumentFormat): Promise<Read> {
  const result: any = await parseDocumentText(text, { kind, format } as never);
  const inner = kind === "any" ? result.result : result;
  return {
    success: inner.success,
    blockType: kind === "any" ? result.blockType : undefined,
    data: inner.data,
    errors: inner.errors,
    warnings: inner.warnings,
  };
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

const QUOTED_LINES = /\b(lines?) (\d+)((?:(?:, | and )\d+)*)/g;

/** The line numbers a message quotes ("line 4", "lines 12 and 15"). */
function quotedLines(message: string): number[] {
  return [...message.matchAll(QUOTED_LINES)].flatMap((m) => (m[0].match(/\d+/g) ?? []).map(Number));
}

/** `X is missing key: — add …` (YAML, TOML) and `X is missing "key" — add …` (JSON), without the format's fix. */
const MISSING_KEY = /^(.*?) is missing (?:"([^"]+)"|([^\s:"]+):)\s*(.*)$/s;

function canonicalMissingKey(message: string): string {
  const m = MISSING_KEY.exec(message);
  if (!m) return message;
  const [, owner, quoted, bare, rest] = m;
  const tail = rest!.startsWith("—") ? "" : rest!.replace("an object", "a block of keys");
  return `${owner} is missing ${quoted ?? bare} ${tail}`.trim();
}

function comparableMessage(message: string, target: Target): string {
  const masked = message.replace(QUOTED_LINES, (_all, word) => `${word} N`);
  return target === "json" ? canonicalMissingKey(masked) : masked;
}

// ---------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------

interface Position {
  line: number;
  column: number;
}

const segmentsOf = (path: string) => (path === "" ? [] : path.split("."));

/** Where the key and the value at `path` start in YAML or JSON text, if the path exists. */
function yamlExact(text: string, path: string): Position[] {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { ...YAML_PARSE_OPTIONS, lineCounter });
  const at = (offset: number) => {
    const { line, col } = lineCounter.linePos(offset);
    return { line, column: col };
  };
  const segments = segmentsOf(path);
  const out: Position[] = [];
  const node: any = segments.length === 0 ? doc.contents : doc.getIn(segments, true);
  if (node && Array.isArray(node.range)) out.push(at(node.range[0]));
  if (segments.length > 0) {
    const parent: any = segments.length === 1 ? doc.contents : doc.getIn(segments.slice(0, -1), true);
    if (isMap(parent)) {
      const last = segments[segments.length - 1];
      const pair: any = parent.items.find((p: any) => String(p.key?.value ?? p.key) === last);
      if (pair?.key && Array.isArray(pair.key.range)) out.push(at(pair.key.range[0]));
    }
  }
  return out;
}

/** Where the key and the value at `path` start in TOML text, from the reader's own index. */
function tomlExact(positions: TomlPositions, path: string): Position[] {
  const segments = segmentsOf(path);
  const { found } = walkPath(positions.root, segments);
  const out: Position[] = [];
  if (found !== undefined) out.push(positions.position(typeof found === "number" ? found : found.at));
  const key = positions.keyAt(segments);
  if (key) out.push(key);
  return out;
}

function exactIn(text: string, format: DocumentFormat): (path: string) => Position[] {
  if (format !== "toml") return (path) => yamlExact(text, path);
  const result = readToml(text);
  if (!result.ok) throw new Error(`TOML did not read: ${result.error.message}`);
  return (path) => tomlExact(result.positions, path);
}

const isExact = (finding: Finding, exact: Position[]) =>
  finding.line !== undefined && exact.some((p) => p.line === finding.line && p.column === finding.column);

/**
 * Each line a message quotes holds the key its path ends in, in that format's
 * text, and the finding's own line is one of them.
 */
function quotedLinesProblems(finding: Finding, text: string): string[] {
  const lines = text.split("\n");
  const key = segmentsOf(finding.path).at(-1) ?? "";
  const quoted = quotedLines(finding.message);
  return [
    ...quoted
      .filter((n) => !lines[n - 1]?.includes(key))
      .map((n) => `line ${n} (${JSON.stringify(lines[n - 1] ?? "")}) does not hold ${key}`),
    ...(finding.line !== undefined && !quoted.includes(finding.line)
      ? [`the finding is on line ${finding.line}, which the message does not quote`]
      : []),
  ];
}

// ---------------------------------------------------------------------------
// The corpus
// ---------------------------------------------------------------------------

describe("the position check tells an exact position from an ancestor's", () => {
  it.each(["yaml", "json", "toml"] as const)("%s", async (format) => {
    const text =
      format === "yaml"
        ? studentMistakes.centreTypo
        : ((await convertDocument(studentMistakes.centreTypo, { from: "yaml", to: format })) as { text: string }).text;
    const { errors } = await read(text, "map", format);
    const typo = errors.find((e) => e.path === "config.centre")!;
    const exactAt = exactIn(text, format);
    expect(isExact(typo, exactAt(typo.path))).toBe(true);
    // The same path answered with its parent's key (config) is a fallback. (Not
    // its value: a YAML block map's value starts at its first key, `centre:`.)
    const parent = exactAt("config").at(-1);
    expect(parent).toBeDefined();
    expect(isExact({ ...typo, ...parent }, exactAt(typo.path))).toBe(false);
    // So is a missing key: positioned at config in every format, exact in none.
    const missing = (await read(
      format === "yaml"
        ? studentMistakes.missingCenter
        : ((await convertDocument(studentMistakes.missingCenter, { from: "yaml", to: format })) as { text: string }).text,
      "map",
      format
    )).errors[0]!;
    expect(missing.path).toBe("config.center");
    expect(missing.line).toBeDefined();
    expect(exactAt("config.center")).toEqual([]);
  });
});

const tally = { documents: 0, json: 0, toml: 0, notConvertible: [] as string[], positioned: 0, exact: 0, quotingLines: 0 };

describe("the parity tables name real documents", () => {
  it("every listed id is in the corpus", () => {
    const ids = new Set(CORPUS.map((d) => d.id));
    expect(ids.size).toBe(CORPUS.length);
    for (const id of [...Object.keys(NOT_CONVERTIBLE), ...Object.keys(FORMAT_SPECIFIC_MESSAGES)]) {
      expect(ids.has(id), id).toBe(true);
    }
  });
});

describe.each(CORPUS.map((doc) => [doc.id, doc] as const))("%s", (id, doc) => {
  it.each(["json", "toml"] as const)("YAML and %s agree", async (target) => {
    const yaml = await read(doc.text, doc.kind, "yaml");
    const converted = await convertDocument(doc.text, { from: "yaml", to: target });
    const expectedFailure = NOT_CONVERTIBLE[id]?.[target];

    if (expectedFailure) {
      expect(converted.success, `${id} → ${target} was listed as not convertible, but converted`).toBe(false);
      if (converted.success) return;
      const [first] = converted.errors;
      if (expectedFailure === SYNTAX) expect((first as Finding).code).toBe("yaml-syntax");
      else expect(first!.message).toContain("TOML has no null");
      tally.notConvertible.push(`${id} → ${target}: ${expectedFailure}`);
      return;
    }
    expect(converted.success, `${id} → ${target}: ${JSON.stringify(!converted.success && converted.errors)}`).toBe(true);
    if (!converted.success) return;

    const other = await read(converted.text, doc.kind, target);
    tally[target]++;
    expect(other.success).toBe(yaml.success);
    expect(other.blockType).toBe(yaml.blockType);
    expect(other.data).toEqual(yaml.data);

    const yamlExactAt = exactIn(doc.text, "yaml");
    const otherExactAt = exactIn(converted.text, target);
    const specific = FORMAT_SPECIFIC_MESSAGES[id]?.[target];

    for (const list of ["errors", "warnings"] as const) {
      const ys = yaml[list];
      const os = other[list];
      expect(os.map((f) => f.path), `${list} paths`).toEqual(ys.map((f) => f.path));
      ys.forEach((y, i) => {
        const o = os[i]!;
        const where = `${list}[${i}] ${y.path}`;
        expect(
          { suggestion: o.suggestion, code: o.code, kind: o.kind, onPage: o.onPage },
          where
        ).toEqual({ suggestion: y.suggestion, code: y.code, kind: y.kind, onPage: y.onPage });

        if (specific?.path === y.path) {
          expect(o.message, `${where}: listed as format-specific, but the messages agree`).not.toBe(y.message);
        } else {
          expect(comparableMessage(o.message, target), where).toBe(comparableMessage(y.message, target));
        }

        if (quotedLines(y.message).length > 0) {
          tally.quotingLines++;
          expect(quotedLinesProblems(y, doc.text), `${where} (YAML)`).toEqual([]);
          expect(quotedLinesProblems(o, converted.text), `${where} (${target})`).toEqual([]);
        }

        if (y.line === undefined) return;
        tally.positioned++;
        expect(o.line, `${where}: positioned in YAML, not in ${target}`).toBeDefined();
        expect(o.column, `${where}: positioned in YAML, not in ${target}`).toBeDefined();
        if (isExact(y, yamlExactAt(y.path))) {
          tally.exact++;
          expect(
            isExact(o, otherExactAt(o.path)),
            `${where}: exact in YAML (${y.line}:${y.column}), but in ${target} ${o.line}:${o.column} ` +
              `is not where its key or value starts (${JSON.stringify(otherExactAt(o.path))})`
          ).toBe(true);
        }
      });
    }
  });
});

describe("the run", () => {
  it("covered the whole corpus", () => {
    tally.documents = CORPUS.length;
    const notConvertible = Object.values(NOT_CONVERTIBLE).flatMap((t) => Object.keys(t)).length;
    console.log(
      `[format-parity] ${tally.documents} documents (${PARITY_DOCUMENTS.length} parity, ` +
        `${tally.documents - PARITY_DOCUMENTS.length} error corpus); compared as JSON ${tally.json}, as TOML ${tally.toml}; ` +
        `${tally.positioned} positioned finding comparisons (${tally.exact} exact in YAML), ${tally.quotingLines} quoting lines; ` +
        `not convertible:\n  ` +
        tally.notConvertible.join("\n  ")
    );
    expect(tally.json + tally.toml + tally.notConvertible.length).toBe(2 * CORPUS.length);
    expect(tally.notConvertible).toHaveLength(notConvertible);
    expect(tally.quotingLines).toBeGreaterThan(0);
    expect(tally.exact).toBeGreaterThan(tally.positioned / 2);
  });
});

// ---------------------------------------------------------------------------
// TOML at scale
// ---------------------------------------------------------------------------

/**
 * A FeatureCollection of `target` bytes or more, with inline coordinates, as
 * TOML and as the same document in YAML. Seeded, so every run reads the same
 * text (U3's benchmark generator).
 */
function largeDocuments(target: number): { toml: string; yaml: string; features: number } {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const round = (v: number) => Math.round(v * 1e5) / 1e5;
  const features: Array<{ name: string; kind: number; coords: Array<[number, number]> }> = [];
  for (let size = 0, i = 0; size < target; i++) {
    const n = 20 + Math.floor(rnd() * 40);
    let x = -75 + rnd();
    let y = 40 + rnd();
    const coords: Array<[number, number]> = [];
    for (let k = 0; k < n; k++) {
      x += (rnd() - 0.5) / 100;
      y += (rnd() - 0.5) / 100;
      coords.push([round(x), round(y)]);
    }
    features.push({ name: `road ${i}`, kind: i % 7, coords });
    size += n * 22 + 120;
  }
  const line = (cs: Array<[number, number]>) => "[" + cs.map(([a, b]) => `[${a}, ${b}]`).join(", ") + "]";
  const toml = [
    `type = "map"
id = "big"

[config]
center = [-74.5, 40.5]
zoom = 9
mapStyle = "https://demotiles.maplibre.org/style.json"

[[layers]]
id = "roads"
type = "line"
source = "roads"

[sources.roads]
type = "geojson"

[sources.roads.data]
type = "FeatureCollection"
`,
    ...features.map(
      (f) => `
[[sources.roads.data.features]]
type = "Feature"
properties = { name = "${f.name}", kind = ${f.kind} }
geometry = { type = "LineString", coordinates = ${line(f.coords)} }
`
    ),
  ].join("");
  const yaml = [
    `type: map
id: big
config:
  center: [-74.5, 40.5]
  zoom: 9
  mapStyle: "https://demotiles.maplibre.org/style.json"
layers:
  - id: roads
    type: line
    source: roads
sources:
  roads:
    type: geojson
    data:
      type: FeatureCollection
      features:
`,
    ...features.map(
      (f) => `        - type: Feature
          properties: { name: "${f.name}", kind: ${f.kind} }
          geometry: { type: LineString, coordinates: ${line(f.coords)} }
`
    ),
  ].join("");
  return { toml, yaml, features: features.length };
}

/**
 * About 15 s a round on the dev box (two 5 MB reads), so it runs on request:
 * `MLYM_SCALE=1 pnpm --filter @maplibre-yaml/core test -- tests/parser/format-parity.test.ts`.
 */
describe.skipIf(!process.env["MLYM_SCALE"])("TOML at scale (MLYM_SCALE=1)", () => {
  it("a 5 MB TOML document validates within 1.9× the YAML time, and its memory is recorded", async () => {
    const { toml, yaml, features } = largeDocuments(5.2e6);
    expect(toml.length).toBeGreaterThan(5e6);
    const mb = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`;
    const before = process.memoryUsage();
    let peakRss = before.rss;
    let peakHeap = before.heapUsed;
    const time = async (text: string, format: DocumentFormat) => {
      const start = performance.now();
      const result = await parseDocumentText(text, { kind: "map", format });
      const ms = performance.now() - start;
      const now = process.memoryUsage();
      peakRss = Math.max(peakRss, now.rss);
      peakHeap = Math.max(peakHeap, now.heapUsed);
      expect(result.errors, format).toEqual([]);
      expect(result.success, format).toBe(true);
      const data = result.data as { sources: { roads: { data: { features: unknown[] } } } };
      expect(data.sources.roads.data.features).toHaveLength(features);
      return ms;
    };
    // Alternate, twice, and keep each format's best: the box's load moves both alike.
    const runs: Record<"yaml" | "toml", number[]> = { yaml: [], toml: [] };
    for (let round = 0; round < 2; round++) {
      runs.yaml.push(await time(yaml, "yaml"));
      runs.toml.push(await time(toml, "toml"));
    }
    const best = { yaml: Math.min(...runs.yaml), toml: Math.min(...runs.toml) };
    const ratio = best.toml / best.yaml;
    console.log(
      `[toml-at-scale] ${features} features; TOML ${mb(toml.length)}, YAML ${mb(yaml.length)}; ` +
        `YAML ${runs.yaml.map((t) => t.toFixed(0)).join(" / ")} ms, TOML ${runs.toml.map((t) => t.toFixed(0)).join(" / ")} ms; ` +
        `best ratio ${ratio.toFixed(2)}×; peak rss ${mb(peakRss)} (from ${mb(before.rss)}), ` +
        `peak heap ${mb(peakHeap)} (from ${mb(before.heapUsed)}), sampled after each read`
    );
    expect(ratio).toBeLessThanOrEqual(1.9);
  }, 300_000);
});

describe('a key named "<<" is a key in TOML, as in JSON', () => {
  const STYLE = "https://demotiles.maplibre.org/style.json";
  const json = JSON.stringify({
    type: "map",
    id: "m",
    config: { center: [0, 0], zoom: 2, mapStyle: STYLE },
    layers: [
      {
        id: "a",
        type: "circle",
        source: {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                geometry: { type: "Point", coordinates: [0, 0] },
                properties: { "<<": { merged: 1 }, kept: 2 },
              },
            ],
          },
        },
      },
    ],
  });
  const toml = `type = "map"
id = "m"

[config]
center = [0, 0]
zoom = 2
mapStyle = "${STYLE}"

[[layers]]
id = "a"
type = "circle"
source = { type = "geojson", data = { type = "FeatureCollection", features = [{ type = "Feature", geometry = { type = "Point", coordinates = [0, 0] }, properties = { "<<" = { merged = 1 }, kept = 2 } }] } }
`;

  for (const kind of ["map", "any"] as const) {
    it(`kind ${kind}: the same value and findings`, async () => {
      const fromJson = await parseDocumentText(json, { kind, format: "json" } as never);
      const fromToml = await parseDocumentText(toml, { kind, format: "toml" } as never);
      const strip = (r: any) => {
        const result = kind === "any" ? r.result : r;
        return {
          success: result.success,
          data: result.data,
          errors: result.errors.map((e: any) => [e.path, e.message]),
          warnings: result.warnings.map((w: any) => [w.path, w.message]),
        };
      };
      const a = strip(fromJson);
      expect(a.errors).toEqual([]);
      const props = (a.data as any).layers[0].source.data.features[0].properties;
      expect(Object.getOwnPropertyDescriptor(props, "<<")?.value).toEqual({ merged: 1 });
      expect(strip(fromToml)).toEqual(a);
    });
  }
});
