/**
 * @file The front door for document text, in YAML, JSON or TOML
 * @module @maplibre-yaml/core/parser/document-text
 *
 * @description
 * Every surface that reads a document the author wrote (the elements, the
 * CLI, Astro, the playground) hands the text to {@link parseDocumentText}.
 * It strips a byte-order mark, decides the format, reads the text, and words
 * every error for the format it came from.
 *
 * - **YAML and JSON** go through the existing `YAMLParser` methods. JSON is
 *   YAML 1.2, so positions, the duplicate-key error and key order come for
 *   free. Only the wording changes: "JSON syntax error", the JSON spelling of
 *   the missing-key fixes, and hints for comments and unquoted strings.
 * - **TOML** is read by a reader loaded on first use, so YAML and JSON pages
 *   never download it.
 *
 * The `YAMLParser` methods stay synchronous and unchanged; this function is
 * async only because TOML waits for its reader.
 */

import { parseDocument, isMap } from "yaml";
import {
  YAMLParser,
  YAML_PARSE_OPTIONS,
  missingTypeMessage,
  type DocumentFormat,
  type MapBlock,
  type ParseError,
  type ParseResult,
  type SafeParseAnyResult,
  type ScrollytellingBlock,
} from "./yaml-parser";
import type { MapBlockV2 } from "../schemas/map-v2.schema";

export type { DocumentFormat };

/** Which document the caller expects. `any` dispatches on the document's `type`. */
export type DocumentKind = "map" | "story" | "any";

/**
 * What the caller knows about where the text came from. Each is optional;
 * the first that names a format wins, in this order: `scriptType`, the
 * extension of `url` (or `fileName`), the extension of `responseUrl`, then
 * `contentType`. Text with no signal is sniffed.
 */
export interface DocumentSignals {
  /** An inline `<script type>`. */
  scriptType?: string | null;
  /** The requested URL. Only its pathname counts, so `map.toml?v=3` is TOML. */
  url?: string;
  /** A file name or path, as the CLI and Astro read it. */
  fileName?: string;
  /** The response's final URL after redirects. */
  responseUrl?: string;
  /**
   * A response `Content-Type`. Only YAML, JSON (including `+json`, such as
   * `application/geo+json`) and TOML media types count. `text/plain` and
   * `application/octet-stream` are no signal.
   */
  contentType?: string | null;
}

export interface ParseDocumentTextOptions {
  /** The document expected. Defaults to `any`. */
  kind?: DocumentKind;
  /** The format, when the caller knows it. Beats every signal. */
  format?: DocumentFormat;
  signals?: DocumentSignals;
}

/** A parse result that names the format it was read as. */
export type FormattedParseResult<T> = ParseResult<T> & { format: DocumentFormat };

/** The `kind: "any"` result: {@link SafeParseAnyResult} plus the format. */
export type DocumentTextResult = SafeParseAnyResult & { format: DocumentFormat };

type Outcome = { blockType: SafeParseAnyResult["blockType"]; result: ParseResult<unknown> };

/** One message for empty text, whatever the format. */
const EMPTY_MESSAGE = "The document is empty. Add a map or a story to it.";

/**
 * Read document text in YAML, JSON or TOML and validate it.
 *
 * @remarks
 * The format comes from `options.format`, else from `options.signals`, else
 * from the text itself: a first `{` is JSON, `key = value` lines with no
 * `key:` line are TOML, and anything else is YAML.
 *
 * The promise never rejects because of what the text says: a syntax error,
 * an invalid document or an unexpected exception all resolve as an error
 * result. Every result, and every error in it, carries `format`.
 *
 * @example
 * ```typescript
 * const result = await parseDocumentText(text, {
 *   kind: "map",
 *   signals: { url: "maps/city.json" },
 * });
 * if (!result.success) console.error(result.format, result.errors);
 * ```
 */
export function parseDocumentText(
  text: string,
  options: ParseDocumentTextOptions & { kind: "map" }
): Promise<FormattedParseResult<MapBlock | MapBlockV2>>;
export function parseDocumentText(
  text: string,
  options: ParseDocumentTextOptions & { kind: "story" }
): Promise<FormattedParseResult<ScrollytellingBlock>>;
export function parseDocumentText(
  text: string,
  options?: ParseDocumentTextOptions & { kind?: "any" }
): Promise<DocumentTextResult>;
export async function parseDocumentText(
  text: string,
  options: ParseDocumentTextOptions = {}
): Promise<FormattedParseResult<unknown> | DocumentTextResult> {
  const kind = options.kind ?? "any";
  let format: DocumentFormat = "yaml";
  let outcome: Outcome;
  try {
    if (typeof text !== "string") throw new TypeError("expected the document as text");
    const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    format = detectDocumentFormat(body, options);
    outcome =
      body.trim() === ""
        ? failure(EMPTY_MESSAGE)
        : format === "toml"
          ? withTomlLabelHint(body, await readToml(body, kind))
          : readYamlOrJson(body, kind, format);
  } catch (err) {
    outcome = failure(`The document could not be read: ${err instanceof Error ? err.message : String(err)}`);
  }
  const result = {
    ...outcome.result,
    format,
    errors: outcome.result.errors.map((err) => ({ ...err, format })),
  };
  return kind === "any"
    ? ({ blockType: outcome.blockType, result, format } as DocumentTextResult)
    : result;
}

function failure(message: string, extra: Partial<ParseError> = {}): Outcome {
  return {
    blockType: "unknown",
    result: { success: false, errors: [{ path: "", message, ...extra }], warnings: [] },
  };
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/** `yaml`, `yml`, `json` or `toml` (an extension or a format name), else undefined. */
function formatNamed(name: string | undefined): DocumentFormat | undefined {
  switch (name?.toLowerCase()) {
    case "yaml":
    case "yml":
      return "yaml";
    case "json":
      return "json";
    case "toml":
      return "toml";
    default:
      return undefined;
  }
}

/** The format a media type names: parameters dropped, case ignored, `+json` accepted. */
function mediaTypeFormat(type: string | null | undefined): DocumentFormat | undefined {
  const essence = (type ?? "").split(";")[0]!.trim().toLowerCase();
  const match = /^(?:(?:application|text)\/(?:x-)?|[\w.-]+\/[\w.-]+\+)(yaml|json|toml)$/.exec(essence);
  return formatNamed(match?.[1]);
}

/** The format a file name's extension names. A URL counts by its pathname only. */
function extensionFormat(name: string | undefined, isUrl: boolean): DocumentFormat | undefined {
  if (!name) return undefined;
  let path = name;
  if (isUrl) {
    try {
      path = new URL(name, "http://localhost/").pathname;
    } catch {
      path = name.replace(/[?#].*$/s, "");
    }
  }
  return formatNamed(/\.([A-Za-z]+)$/.exec(path)?.[1]);
}

/**
 * Decide the format. Explicit beats every signal; the script type beats the
 * URL, which beats the response URL, which beats the content type; text with
 * no signal is sniffed.
 */
function detectDocumentFormat(text: string, options: ParseDocumentTextOptions): DocumentFormat {
  const s = options.signals ?? {};
  return (
    formatNamed(options.format) ??
    mediaTypeFormat(s.scriptType) ??
    extensionFormat(s.url, true) ??
    extensionFormat(s.fileName, false) ??
    extensionFormat(s.responseUrl, true) ??
    mediaTypeFormat(s.contentType) ??
    sniffFormat(text)
  );
}

/** The first character that is not whitespace or a leading `//` or `/* *\/` comment. */
function firstSignificant(text: string): string {
  return /^(?:\s|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*(.)/.exec(text)?.[1] ?? "";
}

/** A TOML `key = value` line: bare, quoted or dotted keys, then `=` and a value. */
const TOML_ASSIGNMENT =
  /^[ \t]*(?:[\w-]+|"[^"\n]*"|'[^'\n]*')(?:[ \t]*\.[ \t]*(?:[\w-]+|"[^"\n]*"|'[^'\n]*'))*[ \t]*=[ \t]*\S/m;

/** A YAML `key:` line starting in column 0. */
const YAML_KEY_LINE = /^(?:[\w$][\w$.-]*|"[^"\n]*"|'[^'\n]*')[ \t]*:(?:[ \t]|$)/m;

/**
 * Whether text reads as TOML: a `key = value` line and no column-0 `key:`
 * line. A `[name]` line on its own is not enough, because it is also a YAML
 * flow sequence.
 */
function looksLikeToml(text: string): boolean {
  return TOML_ASSIGNMENT.test(text) && !YAML_KEY_LINE.test(text);
}

function sniffFormat(text: string): DocumentFormat {
  if (firstSignificant(text) === "{") return "json";
  return looksLikeToml(text) ? "toml" : "yaml";
}

// ---------------------------------------------------------------------------
// YAML and JSON
// ---------------------------------------------------------------------------

function readYamlOrJson(text: string, kind: DocumentKind, format: "yaml" | "json"): Outcome {
  const jsonShaped = format === "json" && /[{[]/.test(firstSignificant(text));
  const tokens = jsonShaped ? scanJson(text) : undefined;
  if (tokens?.problem) return failure(tokens.problem.message, tokens.problem.at);

  const outcome: Outcome =
    kind === "map"
      ? { blockType: "map", result: YAMLParser.safeParseMapBlock(text) }
      : kind === "story"
        ? { blockType: "scrollytelling", result: YAMLParser.safeParseScrollytellingBlock(text) }
        : YAMLParser.safeParseAny(text);
  if (outcome.result.success) return outcome;

  let errors = outcome.result.errors;
  if (format === "json") {
    errors = wordForJson(errors).map((err) => ({ ...err, message: spellForJson(err.message) }));
    const hint = tokens && unquotedHint(errors[0], tokens.words);
    if (hint) errors = withHint(errors, hint);
  } else if (looksLikeToml(text)) {
    errors = withHint(errors, mislabelHint("looks like", "TOML", "YAML"));
  }
  return { blockType: outcome.blockType, result: { ...outcome.result, errors } };
}

function withHint(errors: ParseError[], hint: string): ParseError[] {
  const [first, ...rest] = errors;
  return first ? [{ ...first, message: `${first.message}\n${hint}` }, ...rest] : errors;
}

const LABELS: Record<DocumentFormat, string> = {
  yaml: ".yaml or label it text/yaml",
  json: ".json or label it application/json",
  toml: ".toml or label it application/toml",
};

function mislabelHint(verb: string, is: "YAML" | "JSON" | "TOML", not: string): string {
  return `Hint: this ${verb} ${is}, not ${not}. If it is ${is}, name the file ${LABELS[is.toLowerCase() as DocumentFormat]}.`;
}

/**
 * Word a syntax error from JSON text as JSON: the parser (YAML, which reads
 * JSON) says "YAML syntax error", which would send a JSON author looking for
 * YAML. Positions are untouched.
 */
export function wordForJson(errors: ParseError[]): ParseError[] {
  return errors.map((err) =>
    err.code === "yaml-syntax"
      ? { ...err, message: err.message.replace(/^YAML (syntax|quoting|indentation) error:/, "JSON syntax error:") }
      : err
  );
}

/** What to add for a missing required key, spelled as JSON. */
const JSON_KEY_EXAMPLES: Record<string, string> = {
  center: '"center": [longitude, latitude]',
  zoom: '"zoom": 12 (a number from 0 to 24)',
  id: '"id": "a-short-name"',
  title: '"title": "…"',
  type: '"type": "…"',
  config: 'a "config" object with "center", "zoom" and "mapStyle"',
  chapters: 'a "chapters" list',
  layers: '"layers": [] (or a list of layers)',
  source: '"source": a source name or an inline source',
  pmtiles: '"pmtiles": "data/basemap.pmtiles" (the path or URL of a Protomaps basemap .pmtiles file)',
};

/** The YAML-spelled fixes (`add type: map`, `add center: […]`) rewritten for a JSON author. */
function spellForJson(message: string): string {
  for (const [kind, other, what] of [
    ["map", "scrollytelling", "story"],
    ["scrollytelling", "map", "single map"],
  ] as const) {
    if (message === missingTypeMessage(kind)) {
      return (
        `The document is missing "type" at the top — add "type": "${kind}" as its first ` +
        `key (or "type": "${other}", for a ${what}).`
      );
    }
  }
  if (message.startsWith("Unable to determine document type.")) {
    return (
      'Unable to determine document type. Expected an object with "type": "map" or ' +
      '"type": "scrollytelling", or a root document with a top-level "pages" array.'
    );
  }
  const missing = /^(.*) is missing ([^\s:]+): (?:— add .*\.|(\(required.*))$/s.exec(message);
  if (missing) {
    const [, owner, key, required] = missing;
    return required
      ? `${owner} is missing "${key}" ${required.replace("a block of keys", "an object")}`
      : `${owner} is missing "${key}" — add ${JSON_KEY_EXAMPLES[key!] ?? `"${key}": …`}.`;
  }
  return message;
}

interface JsonWord {
  token: string;
  line: number;
  column: number;
}

/**
 * Scan JSON text for what JSON rejects but the YAML parser reads quietly.
 * A comment or an unquoted `#…` value is an error (YAML would drop it as a
 * comment); other unquoted words are kept, as before, and only feed a hint
 * when the text fails to parse.
 */
function scanJson(text: string): { problem?: { message: string; at: Partial<ParseError> }; words: JsonWord[] } {
  const words: JsonWord[] = [];
  const token = /\s+|"(?:[^"\\\n]|\\.)*"?|'[^'\n]*'?|[{}[\]:,]|[^\s{}[\],]+/y;
  const value = /[^,\]}\n]*/y;
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < text.length; ) {
    token.lastIndex = i;
    const match = token.exec(text)![0];
    const at = { line, column: i - lineStart + 1 };
    const head = match[0]!;
    if (/\s/.test(head)) {
      for (let j = match.indexOf("\n"); j !== -1; j = match.indexOf("\n", j + 1)) {
        line++;
        lineStart = i + j + 1;
      }
    } else if (head === "/" && (match[1] === "/" || match[1] === "*")) {
      return {
        words,
        problem: {
          message:
            "JSON syntax error: comments are not allowed in JSON. Remove the comment, " +
            "or write the document in YAML, where # starts a comment.",
          at: { code: "yaml-syntax", ...at },
        },
      };
    } else if (head === "#") {
      return {
        words,
        problem: {
          message: `JSON syntax error: strings must be quoted in JSON. Write "${match}", not ${match}.`,
          at: { code: "yaml-syntax", ...at },
        },
      };
    } else if (
      !/["'{}[\]:,]/.test(head) &&
      !/^(?:true|false|null|[-+.\d])/.test(match) &&
      words.length < 100 &&
      words[words.length - 1]?.line !== line
    ) {
      // The first unquoted value on the line, as the author sees it: up to the next comma or bracket.
      value.lastIndex = i;
      words.push({ token: value.exec(text)![0].trim(), ...at });
    }
    i += match.length;
  }
  return { words };
}

/** A strings-must-be-quoted hint for a JSON syntax error at or just after an unquoted word. */
function unquotedHint(err: ParseError | undefined, words: JsonWord[]): string | undefined {
  if (err?.code !== "yaml-syntax" || err.line === undefined) return undefined;
  // The parser often reports the line after the unquoted value.
  const lines = [err.line, err.line - 1, err.line - 2];
  const word = lines.map((line) => words.find((w) => w.line === line)).find(Boolean);
  return word && `Hint: strings must be quoted in JSON. Write "${word.token}", not ${word.token} (line ${word.line}).`;
}

// ---------------------------------------------------------------------------
// TOML
// ---------------------------------------------------------------------------

/**
 * Read TOML text.
 *
 * TODO(U3): load the reader with `getDecoder("toml")` (the `toml` LOADERS
 * entry) and read the text through it. Until that chunk exists, TOML text
 * resolves as this one error.
 */
async function readToml(_text: string, _kind: DocumentKind): Promise<Outcome> {
  return failure("TOML support is not available in this build.");
}

/**
 * A TOML label on text that reads as YAML (or JSON) gets a hint to relabel
 * it. Checked only after the TOML read failed, with the YAML parser that is
 * already loaded.
 */
function withTomlLabelHint(text: string, outcome: Outcome): Outcome {
  if (outcome.result.success) return outcome;
  const doc = parseDocument(text, YAML_PARSE_OPTIONS);
  if (doc.errors.length > 0 || !isMap(doc.contents)) return outcome;
  const is = firstSignificant(text) === "{" ? "JSON" : "YAML";
  return {
    ...outcome,
    result: { ...outcome.result, errors: withHint(outcome.result.errors, mislabelHint("reads as", is, "TOML")) },
  };
}
