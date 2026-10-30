/**
 * @file Read the author's text into an order-keeping tree
 * @module @maplibre-yaml/core/convert/tree
 *
 * @description
 * The converter prints what the author wrote, not the validated result
 * (which has defaults filled in and sugar expanded), so it reads the text
 * itself:
 *
 * - **YAML and JSON** through the yaml `Document`, with the library's parse
 *   options (merge keys, `!html`). Aliases and merge keys are expanded the
 *   way `toJS()` expands them, and each one is recorded where it is written.
 *   Comments come from the lexer, with their lines.
 * - **TOML** from the TOML reader's value and its node tree, whose tables
 *   list their keys in the order written.
 *
 * Tables become lists of entries, so integer-like keys keep their order and
 * `__proto__` is a key like any other. The schema hint, in whichever
 * spelling, is lifted out of the tree. Entry side: never loaded by the
 * elements, only by `convertDocument`.
 */

import { CST, Lexer, LineCounter, isAlias, isMap, isScalar, isSeq, parseDocument, type Document, type Node } from "yaml";
import { YAML_PARSE_OPTIONS } from "../parser/yaml-parser";
import { pastSafeInteger as pastSafe } from "../parser/big-integers";
import { normalizeDates } from "../parser/normalize";
import type { TomlRead } from "../parser/toml/reader";
import type { TomlEntry, TomlNode } from "../parser/toml/index-positions";
import type { AuthoredDocument, AuthoredEntry, AuthoredExpansion, AuthoredNode, SourceAt } from "./types";

type TomlReadOk = Extract<TomlRead, { ok: true }>;

/** `# yaml-language-server: $schema=<url>`. */
const MODELINE = /^#\s*yaml-language-server\s*:\s*\$schema=(\S+)/;
/** Taplo's `#:schema <url>` directive. */
const TOML_DIRECTIVE = /^#:schema\s+(\S+)/;

/** The value of `key` on `obj`, own properties only (a `__proto__` key is data). */
const own = (obj: object, key: string): unknown => Object.getOwnPropertyDescriptor(obj, key)?.value;

/** A `{ $html: "…" }` marker: the one key, a string. */
function htmlOf(entries: AuthoredEntry[]): string | undefined {
  const only = entries.length === 1 ? entries[0]! : undefined;
  return only?.key === "$html" && only.value.kind === "string" ? only.value.value : undefined;
}

/**
 * A schema hint the printers can write as a one-line comment: one token, no
 * whitespace or control character (the shape the modeline and directive
 * readers above accept). print-yaml.ts and print-toml.ts check the same
 * shape again; the two halves of the converter share no code.
 */
// eslint-disable-next-line no-control-regex -- a hint with a control character must never reach a comment line
const HINT = /^[^\s\x00-\x1f\x7f-\x9f]+$/;

/**
 * A root map's string `$schema` entry, taken out of the tree. One that is not
 * a single token stays an entry, printed as quoted data: written into the
 * comment, a line break in it would start lines of document.
 */
function liftSchema(root: AuthoredNode): string | undefined {
  if (root.kind !== "map") return undefined;
  const i = root.entries.findIndex((e) => e.key === "$schema" && e.value.kind === "string" && HINT.test(e.value.value));
  if (i === -1) return undefined;
  const [entry] = root.entries.splice(i, 1);
  return (entry!.value as { value: string }).value;
}

/** A plain JavaScript value as a tree: for what the yaml library resolves to an object (`!!binary`, `!!set`). */
function fromValue(value: unknown, at?: SourceAt): AuthoredNode {
  const v = normalizeDates(value);
  if (v === null || v === undefined) return { kind: "null", at };
  if (typeof v === "string") return { kind: "string", value: v, at };
  if (typeof v === "number") return { kind: "number", value: v, at };
  if (typeof v === "boolean") return { kind: "boolean", value: v, at };
  if (Array.isArray(v)) return { kind: "seq", items: v.map((x) => fromValue(x, at)), at };
  if (typeof v === "object") {
    const entries = Object.keys(v).map((key) => ({ key, value: fromValue(own(v, key), at), at }));
    const html = htmlOf(entries);
    return html === undefined ? { kind: "map", entries, at } : { kind: "html", value: html, at };
  }
  return { kind: "string", value: String(v), at };
}

/**
 * Read YAML or JSON text. `undefined` when the text does not parse or holds
 * nothing (the caller already has the syntax error from validation).
 */
export function yamlTree(text: string, from: "yaml" | "json"): AuthoredDocument | undefined {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { ...YAML_PARSE_OPTIONS, lineCounter });
  if (doc.errors.length > 0 || doc.contents === null || doc.contents === undefined) return undefined;
  const at = (offset: number | undefined): SourceAt | undefined => {
    if (offset === undefined) return undefined;
    const { line, col } = lineCounter.linePos(offset);
    return { line, column: col };
  };

  const expansions: AuthoredExpansion[] = [];
  /** Offsets already recorded: an alias inside an anchored node is expanded once per use of that node. */
  const recorded = new Set<number>();
  const record = (kind: AuthoredExpansion["kind"], name: string, offset: number | undefined) => {
    if (offset === undefined || recorded.has(offset)) return;
    recorded.add(offset);
    expansions.push({ kind, name, at: at(offset)! });
  };

  const resolveAlias = (node: unknown): unknown => (isAlias(node) ? node.resolve(doc as Document) : node);

  const mapEntries = (node: Node): AuthoredEntry[] => {
    if (!isMap(node)) throw new Error("merge sources must be maps");
    const entries: AuthoredEntry[] = [];
    const index = new Map<string, number>();
    // As `toJS()` does: an explicit key always sets, a merged key only fills a gap.
    const set = (entry: AuthoredEntry, override: boolean) => {
      const i = index.get(entry.key);
      if (i === undefined) {
        index.set(entry.key, entries.length);
        entries.push(entry);
      } else if (override) {
        entries[i] = entry;
      }
    };
    for (const pair of node.items) {
      const key = pair.key as Node | null;
      if (isMergeKey(key)) {
        const sources = isSeq(pair.value) ? pair.value.items : [pair.value];
        for (const source of sources) {
          if (isAlias(source)) record("merge", source.source, key!.range?.[0]);
          for (const entry of mapEntries(resolveAlias(source) as Node)) set(entry, false);
        }
        continue;
      }
      const name = keyName(key);
      const value = pair.value === null ? ({ kind: "null", at: at(key?.range?.[1]) } as const) : build(pair.value as Node);
      set({ key: name, value, at: at(key?.range?.[0]) }, true);
    }
    return entries;
  };

  const build = (node: Node | null): AuthoredNode => {
    if (node === null) return { kind: "null" };
    const where = at(node.range?.[0]);
    if (isAlias(node)) {
      record("alias", node.source, node.range?.[0]);
      const target = node.resolve(doc as Document);
      if (!target) throw new Error(`the alias *${node.source} names no anchor`);
      return build(target);
    }
    if (isScalar(node)) {
      const v: unknown = node.value;
      if (v === null || v === undefined) return { kind: "null", at: where };
      if (typeof v === "string") return { kind: "string", value: v, at: where };
      if (typeof v === "boolean") return { kind: "boolean", value: v, at: where };
      if (typeof v === "number") {
        const source = typeof node.source === "string" ? node.source : "";
        const integerLiteral = /^[-+]?(?:\d+|0x[\da-fA-F]+|0o[0-7]+)$/.test(source);
        return {
          kind: "number",
          value: v,
          at: where,
          ...(Number.isInteger(v) && /^[-+]?[\d.]*[.eE]/.test(source) ? { float: true } : {}),
          ...(integerLiteral && pastSafe(source) ? { unsafe: source } : {}),
        };
      }
      if (typeof v === "object" && typeof (v as { $html?: unknown }).$html === "string") {
        return { kind: "html", value: (v as { $html: string }).$html, at: where };
      }
      return fromValue(node.toJS(doc as Document), where);
    }
    if (isSeq(node)) return { kind: "seq", items: node.items.map((item) => build(item as Node)), at: where };
    if (isMap(node)) {
      const entries = mapEntries(node);
      const html = htmlOf(entries);
      return html === undefined ? { kind: "map", entries, at: where } : { kind: "html", value: html, at: where };
    }
    return fromValue((node as { toJS(doc: Document): unknown }).toJS(doc as Document), where);
  };

  const root = build(doc.contents as Node);
  let schema = liftSchema(root);
  const comments: AuthoredDocument["comments"] = [];
  if (from === "yaml") {
    for (const comment of lexComments(text)) {
      const modeline = MODELINE.exec(comment.text);
      if (modeline) {
        schema ??= modeline[1];
        continue;
      }
      comments.push({ at: at(comment.offset)!, text: comment.text });
    }
  }
  return { from, root, ...(schema === undefined ? {} : { schema }), comments, expansions };
}

/** With `merge: true` the library reads the `<<` key as a Symbol named `<<`. */
function isMergeKey(key: unknown): boolean {
  if (!isScalar(key)) return false;
  const v: unknown = key.value;
  return typeof v === "symbol" ? v.description === "<<" : false;
}

/** A key as `toJS()` names it: a string as is, other scalars as text, `null` as "". */
function keyName(key: Node | null): string {
  if (key === null) return "";
  if (isScalar(key)) {
    const v: unknown = key.value;
    return v === null || v === undefined ? "" : String(v);
  }
  return String(key);
}

/** Every comment in YAML text with its offset, from the lexer (a `#` inside a block scalar is not one). */
function lexComments(text: string): Array<{ offset: number; text: string }> {
  const found: Array<{ offset: number; text: string }> = [];
  let offset = 0;
  for (const token of new Lexer().lex(text)) {
    const type = CST.tokenType(token);
    // The lexer's markers are not source text.
    if (type === "doc-mode" || type === "flow-error-end" || type === "scalar") continue;
    if (type === "comment") found.push({ offset, text: token });
    offset += token.length;
  }
  return found;
}

/** Read TOML through the reader's value and node tree (the order each table was written in). */
export function tomlTree(text: string, read: TomlReadOk): AuthoredDocument {
  const { positions } = read;
  const at = (offset: number | undefined): SourceAt | undefined =>
    offset === undefined ? undefined : positions.position(offset);

  const build = (value: unknown, entry: TomlEntry | undefined): AuthoredNode => {
    const offset = entry === undefined ? undefined : typeof entry === "number" ? entry : entry.at;
    const where = at(offset);
    if (Array.isArray(value)) {
      const kids = entry !== undefined && typeof entry !== "number" && Array.isArray(entry.kids) ? entry.kids : [];
      return { kind: "seq", items: value.map((item, i) => build(item, kids[i])), at: where };
    }
    if (value !== null && typeof value === "object") {
      const node = entry !== undefined && typeof entry !== "number" ? (entry as TomlNode) : undefined;
      const kids = node && !Array.isArray(node.kids) ? node.kids : undefined;
      const keys = kids ? [...kids.keys()] : Object.keys(value);
      const entries = keys.map((key) => ({
        key,
        value: build(own(value, key), kids?.get(key)),
        at: at(node?.keys?.get(key)),
      }));
      const html = htmlOf(entries);
      return html === undefined ? { kind: "map", entries, at: where } : { kind: "html", value: html, at: where };
    }
    if (typeof value === "number") {
      const source = offset === undefined ? "" : text.slice(offset, offset + 64);
      const integer = /^[-+]?(?:0x[\da-fA-F_]+|0o[0-7_]+|0b[01_]+|\d[\d_]*)(?![\d_.eE])/.exec(source)?.[0];
      return {
        kind: "number",
        value,
        at: where,
        ...(Number.isInteger(value) && integer === undefined && /^[-+]?\d/.test(source) ? { float: true } : {}),
        ...(integer !== undefined && pastSafe(integer) ? { unsafe: integer } : {}),
      };
    }
    if (typeof value === "boolean") return { kind: "boolean", value, at: where };
    if (typeof value === "string") return { kind: "string", value, at: where };
    return fromValue(value, where);
  };

  const root = build(read.value, positions.root);
  let schema = liftSchema(root);
  const comments: AuthoredDocument["comments"] = [];
  for (const [start, end] of read.comments) {
    const comment = text.slice(start, end);
    const directive = TOML_DIRECTIVE.exec(comment);
    if (directive) {
      schema ??= directive[1];
      continue;
    }
    comments.push({ at: at(start)!, text: comment });
  }
  return { from: "toml", root, ...(schema === undefined ? {} : { schema }), comments, expansions: [] };
}
