/**
 * @file Read TOML text into a document value and its positions
 * @module @maplibre-yaml/core/parser/toml/reader
 *
 * @description
 * One walk over toml-eslint-parser's tree builds, together:
 *
 * - **the value**, a plain object the value entry points validate. Dates,
 *   datetimes and times become the text as written (R12): `2024-01-02` is
 *   the string `"2024-01-02"`.
 * - **the positions** ({@link TomlPositions}): every key, value, array
 *   element and inline-table entry, so findings land at the TOML line and
 *   column (KTD5).
 * - **the key order** of each table (the node tree's `Map`s), which the
 *   `categories` order rule reads (R9).
 * - **key origins** (a dotted key, a header and what was written under it),
 *   which the hints read.
 * - **the comments' ranges**, which `convertDocument` reports as losses.
 *
 * Every table is built by defining own properties, never by assignment, so a
 * `__proto__` key is data like any other (KTD4). Nothing here throws: a
 * syntax error, a document nested deeper than {@link MAX_DEPTH}, or anything
 * unexpected comes back as one `toml-syntax` error.
 *
 * Part of the lazy `toml` chunk: core is imported for types only.
 */

import { parseTOML, type AST } from "toml-eslint-parser";
import type { AuthoredOrder } from "../../classify/category-order";
import type { ParseError } from "../yaml-parser";
import { TomlPositions, type TomlEntry, type TomlNode } from "./index-positions";
import { syntaxHint } from "./hints";

/** Deeper than this, a document is refused, the same way on every engine. */
export const MAX_DEPTH = 512;

type Rec = Record<string, unknown>;

/** What {@link readToml} returns. */
export type TomlRead =
  | {
      ok: true;
      /** The document, ready for the value entry points. */
      value: Rec;
      /** Where each key and value was written. Also the facts the hints read. */
      positions: TomlPositions;
      /** Tables whose integer-like keys JavaScript would reorder, as written (R9). */
      authoredOrder: AuthoredOrder;
      /** Each comment's source range, `#` included (the converter reports them). */
      comments: Array<readonly [number, number]>;
    }
  | { ok: false; error: ParseError };

class TooDeep extends Error {
  constructor(readonly at: number) {
    super("too deep");
  }
}

const define = (target: object, key: string | number, value: unknown) =>
  Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });

const INTEGER_KEY = /^(?:0|[1-9]\d*)$/;

/** Read TOML text. Never throws. */
export function readToml(text: string): TomlRead {
  try {
    const deep = nestingTooDeep(text);
    if (deep !== undefined) throw new TooDeep(deep);
    return build(text, parseTOML(text));
  } catch (error) {
    return { ok: false, error: toSyntaxError(text, error) };
  }
}

function toSyntaxError(text: string, error: unknown): ParseError {
  const fail = (message: string, at?: number): ParseError => {
    const where = at === undefined ? {} : new TomlPositions({ at: 0, kids: [] }, text).position(at);
    return { path: "", code: "toml-syntax", message: `TOML syntax error: ${message}`, ...where };
  };
  if (error instanceof TooDeep) {
    return fail(`the document nests more than ${MAX_DEPTH} levels deep, which this reader does not accept.`, error.at);
  }
  const e = error as { message?: unknown; index?: unknown };
  if (typeof e?.index === "number") {
    const hint = syntaxHint(text, e.index);
    const message = `${String(e.message)}${hint ? `\n${hint.text}` : ""}`;
    return fail(message, hint?.at ?? e.index);
  }
  // Not the parser's own error (a stack overflow on some engine, a bug).
  return fail(error instanceof Error ? error.message : String(error));
}

/**
 * Where bracket nesting (arrays and inline tables) first passes
 * {@link MAX_DEPTH}, outside strings and comments, else undefined. Checked
 * before parsing: the parser recurses, and its limit depends on the engine.
 */
function nestingTooDeep(text: string): number | undefined {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "#") {
      const end = text.indexOf("\n", i);
      if (end === -1) return undefined;
      i = end;
    } else if (c === '"' || c === "'") {
      const delimiter = text.startsWith(c.repeat(3), i) ? c.repeat(3) : c;
      let j = i + delimiter.length;
      for (; j < text.length; j++) {
        if (c === '"' && text[j] === "\\") j++;
        else if (text.startsWith(delimiter, j)) break;
        else if (delimiter.length === 1 && text[j] === "\n") break;
      }
      if (j >= text.length) return undefined;
      i = j + delimiter.length - 1;
    } else if (c === "[" || c === "{") {
      if (++depth > MAX_DEPTH) return i;
    } else if ((c === "]" || c === "}") && depth > 0) {
      depth--;
    }
  }
  return undefined;
}

/** A key segment's name. */
const nameOf = (key: AST.TOMLBare | AST.TOMLQuoted) => (key.type === "TOMLBare" ? key.name : key.value);

const isTable = (entry: TomlEntry | undefined): entry is TomlNode & { kids: Map<string, TomlEntry> } =>
  entry !== undefined && typeof entry !== "number" && !Array.isArray(entry.kids);

function build(text: string, program: AST.TOMLProgram): TomlRead {
  const top = program.body[0];
  const value: Rec = {};
  const root: TomlNode = { at: top.body[0]?.range[0] ?? 0, kids: new Map(), keys: new Map() };
  /** Each table's node → its object. */
  const objects = new WeakMap<TomlNode, Rec | unknown[]>([[root, value]]);
  /** Tables holding an integer-like key, named by their key (`categories`). */
  const numbered = new Map<TomlNode, string>();

  const table = (at: number): TomlNode => ({ at, kids: new Map(), keys: new Map() });

  /** The table `name` in `parent`, made (as `made`) when missing. */
  const child = (parent: TomlNode, name: string, made: () => TomlNode, keyAt: number): TomlNode => {
    const kids = parent.kids as Map<string, TomlEntry>;
    const existing = kids.get(name);
    if (existing !== undefined) return existing as TomlNode;
    const node = made();
    const obj = Array.isArray(node.kids) ? [] : {};
    define(objects.get(parent) as Rec, name, obj);
    objects.set(node, obj);
    kids.set(name, node);
    parent.keys!.set(name, keyAt);
    return node;
  };

  /** Write one `key = value` (a dotted key makes its tables) into `node`. */
  const assign = (node: TomlNode, name: string | undefined, kv: AST.TOMLKeyValue, depth: number) => {
    const keys = kv.key.keys;
    if (depth + keys.length > MAX_DEPTH) throw new TooDeep(kv.range[0]);
    let target = node;
    let targetName = name;
    for (const key of keys.slice(0, -1)) {
      const k = nameOf(key);
      target = child(target, k, () => ({ ...table(key.range[0]), dotted: kv.key.range }), key.range[0]);
      target.dottedKeys = (target.dottedKeys ?? 0) + 1;
      targetName = k;
    }
    const last = keys[keys.length - 1]!;
    const k = nameOf(last);
    const [v, entry] = content(kv.value, k, depth + keys.length);
    define(objects.get(target) as Rec, k, v);
    (target.kids as Map<string, TomlEntry>).set(k, entry);
    target.keys!.set(k, last.range[0]);
    if (INTEGER_KEY.test(k) && targetName !== undefined) numbered.set(target, targetName);
    node.headerKeys?.add(nameOf(keys[0]!));
  };

  const content = (node: AST.TOMLContentNode, name: string, depth: number): [unknown, TomlEntry] => {
    switch (node.type) {
      case "TOMLValue":
        return [
          node.kind === "offset-date-time" ||
          node.kind === "local-date-time" ||
          node.kind === "local-date" ||
          node.kind === "local-time"
            ? text.slice(node.range[0], node.range[1])
            : node.value,
          node.range[0],
        ];
      case "TOMLArray": {
        const values: unknown[] = [];
        const kids: TomlEntry[] = [];
        for (const element of node.elements) {
          const [v, entry] = content(element, name, depth + 1);
          values.push(v);
          kids.push(entry);
        }
        return [values, { at: node.range[0], kids }];
      }
      case "TOMLInlineTable": {
        const inline = table(node.range[0]);
        const obj: Rec = {};
        objects.set(inline, obj);
        for (const kv of node.body) assign(inline, name, kv, depth);
        return [obj, inline];
      }
    }
  };

  /** Open `[a.b]` or `[[a.b]]`: walk to it, making what is missing, then write its body. */
  const open = (t: AST.TOMLTable) => {
    const path = t.resolvedKey;
    if (path.length > MAX_DEPTH) throw new TooDeep(t.range[0]);
    const close = text.indexOf("]", t.key.range[1]);
    const header = [t.range[0], close === -1 ? t.key.range[1] : close + (t.kind === "array" ? 2 : 1)] as const;
    const at = t.range[0];
    let node = root;
    let name: string | undefined;
    for (let i = 0; i < path.length; i++) {
      const segment = path[i]!;
      if (typeof segment === "number") {
        const array = node.kids as TomlEntry[];
        if (array[segment] === undefined) {
          // A new `[[…]]` element.
          const element = table(at);
          const obj: Rec = {};
          (objects.get(node) as unknown[]).push(obj);
          objects.set(element, obj);
          array.push(element);
        }
        node = array[segment] as TomlNode;
        continue;
      }
      const arrayNext = t.kind === "array" && i === path.length - 2;
      node = child(node, segment, () => (arrayNext ? { at, kids: [] } : table(at)), at);
      name = segment;
    }
    if (t.kind === "standard") {
      // An explicit header: the table is its own now, not a dotted key's.
      node.at = at;
      delete node.dotted;
    }
    node.header = header;
    node.headerKeys = new Set();
    for (const kv of t.body) assign(node, name, kv, path.length);
  };

  for (const item of top.body) {
    if (item.type === "TOMLKeyValue") assign(root, undefined, item, 0);
    else open(item);
  }

  const positions = new TomlPositions(root, text);
  const ordered: Array<{ name: string; node: TomlNode }> = [];
  for (const [node, name] of numbered) {
    if (!name || !isTable(node)) continue;
    const written = [...node.kids.keys()];
    const js = Object.keys(objects.get(node) as Rec);
    if (js.some((key, i) => key !== written[i])) ordered.push({ name, node });
  }
  const authoredOrder: AuthoredOrder = (key) =>
    ordered
      .filter((o) => o.name === key)
      .map(({ node }) => {
        const obj = objects.get(node) as Rec;
        return [...(node.kids as Map<string, TomlEntry>).keys()].map((k): [string, unknown] => {
          const v = obj[k];
          return [k, v !== null && typeof v === "object" ? undefined : v];
        });
      });
  const comments = program.comments.map((c) => [c.range[0], c.range[1]] as const);
  return { ok: true, value, positions, authoredOrder, comments };
}
