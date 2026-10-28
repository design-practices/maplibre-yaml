/**
 * @file TOML's own traps, explained (R8)
 * @module @maplibre-yaml/core/parser/toml/hints
 *
 * @description
 * Two kinds of hint, both worded here so the text ships in the lazy `toml`
 * chunk and never in the entry:
 *
 * - **Syntax hints** ({@link syntaxHint}), added to a `toml-syntax` error:
 *   an unquoted `#` colour (TOML reads it as a comment, so the value is
 *   missing) and `null` (TOML has none: leave the key out).
 * - **Finding hints** ({@link hintsFor}), added after validation to the
 *   findings YAML would also give, where the TOML spelling explains them:
 *   - a dotted key that nested where one key was meant (`1.5 = "red"` is a
 *     table `1` holding `5`), only when the failing table came from that one
 *     dotted key, so `paint.circle-color = "red"` never draws one;
 *   - a key that landed under an already opened sub-table (`minzoom = 3`
 *     after `[layers.paint]`): move it above that header.
 *
 * Part of the lazy `toml` chunk: core is imported for types only.
 */

import { walkPath, type TomlNode, type TomlPositions } from "./index-positions";

/** A finding a hint can be added to: an error or a warning. */
interface Finding {
  path: string;
  message: string;
}

/**
 * Keys the entry knows from its schemas (KTD4): a layer's keys and the
 * `config` block's keys.
 */
export interface KnownKeys {
  layer: readonly string[];
  config: readonly string[];
}

/** A hint for the parser's error at `index`, and where it points, if one applies. */
export function syntaxHint(text: string, index: number): { text: string; at: number } | undefined {
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  // An unquoted colour: the parser stops after the comment it became, on
  // that line or the next. Look at the line it reports and the two before.
  let start = lineStart;
  let end = text.indexOf("\n", index);
  if (end === -1) end = text.length;
  for (let back = 0; back < 3; back++) {
    const line = text.slice(start, end);
    const colour = /(?:^|[={[,])[ \t]*(#[0-9a-fA-F]{3,8})\b/.exec(line);
    if (colour) {
      const key = /((?:[\w-]+|"[^"\n]*"|'[^'\n]*')(?:[ \t]*\.[ \t]*(?:[\w-]+|"[^"\n]*"|'[^'\n]*'))*)[ \t]*=[ \t]*#/.exec(line);
      const fix = key ? `${key[1]} = "${colour[1]}"` : `"${colour[1]}"`;
      return {
        text: `Hint: quote the colour: write ${fix}. In TOML an unquoted # starts a comment.`,
        at: start + colour.index + colour[0].indexOf("#"),
      };
    }
    if (start === 0) break;
    end = start - 1;
    start = text.lastIndexOf("\n", end - 1) + 1;
  }
  if (/^null\b/.test(text.slice(index, index + 5))) {
    const key = /((?:[\w-]+|"[^"\n]*"|'[^'\n]*')(?:[ \t]*\.[ \t]*(?:[\w-]+|"[^"\n]*"|'[^'\n]*'))*)[ \t]*=[ \t]*$/.exec(
      text.slice(lineStart, index)
    );
    return {
      text: key
        ? `Hint: TOML has no null. To leave a value unset, leave \`${key[1]}\` out: a key that isn't written is unset.`
        : "Hint: TOML has no null. To leave a value unset, leave its key out: a key that isn't written is unset.",
      at: index,
    };
  }
  return undefined;
}

/** A finding's dotted path as segments. Locale keys hold dots; they never need these hints. */
const segments = (path: string) => (path === "" ? [] : path.split("."));

const node = (entry: unknown): TomlNode | undefined =>
  entry !== undefined && typeof entry !== "number" ? (entry as TomlNode) : undefined;

/** What owns a sub-table: a layer (`layers.N`) or the `config` block. */
function ownerKind(owner: readonly string[]): keyof KnownKeys | undefined {
  const n = owner.length;
  if (n >= 2 && owner[n - 2] === "layers" && /^\d+$/.test(owner[n - 1]!)) return "layer";
  if (n === 1 && owner[0] === "config") return "config";
  return undefined;
}

/** The sub-table header under `owner` a key `key` was written beneath. */
function headerHolding(owner: TomlNode, key: string): TomlNode | undefined {
  if (Array.isArray(owner.kids)) return undefined;
  for (const kid of owner.kids.values()) {
    const sub = node(kid);
    if (sub?.header && sub.headerKeys?.has(key)) return sub;
  }
  return undefined;
}

function hintFor(facts: TomlPositions, finding: Finding, known: KnownKeys): string | undefined {
  const path = segments(finding.path);
  const { found } = walkPath(facts.root, path);
  const at = node(found);
  const slice = (span: readonly [number, number]) => facts.text.slice(span[0], span[1]);

  // A table one dotted key made, where the document fails.
  if (at?.dotted && at.dottedKeys === 1) {
    const key = slice(at.dotted);
    return `Hint: TOML reads the dots in ${key} as nesting, so this is a table. If you meant one key, quote it: "${key}" = …`;
  }

  if (path.length < 2) return undefined;
  const key = path[path.length - 1]!;
  const parentPath = path.slice(0, -1);
  const parent = node(walkPath(facts.root, parentPath).found);
  if (!parent) return undefined;
  const moveAbove = (header: TomlNode, what: string) => {
    const name = slice(header.header!);
    return `Hint: in TOML every key after ${name} belongs to it, until the next header. ${what}: move it above ${name}.`;
  };

  // A known key of the owner, written under its sub-table's header.
  const kind = ownerKind(path.slice(0, -2));
  if (
    kind &&
    found !== undefined &&
    parent.header &&
    parent.headerKeys?.has(key) &&
    known[kind].includes(key) &&
    /^Unknown key "/.test(finding.message)
  ) {
    return moveAbove(parent, `"${key}" is a ${kind} key`);
  }

  // A key the owner misses, written under one of its sub-tables instead.
  if (found === undefined && ownerKind(parentPath)) {
    const header = headerHolding(parent, key);
    if (header) return moveAbove(header, `"${key}" was written there`);
  }
  return undefined;
}

/**
 * The findings, with a TOML hint added where the document's spelling
 * explains one. Pure: returns new findings and changes nothing.
 */
export function hintsFor<F extends Finding>(facts: TomlPositions, findings: readonly F[], known: KnownKeys): F[] {
  return findings.map((finding) => {
    const hint = hintFor(facts, finding, known);
    return hint ? { ...finding, message: `${finding.message}\n${hint}` } : finding;
  });
}
