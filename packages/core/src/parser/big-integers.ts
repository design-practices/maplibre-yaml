/**
 * @file Integers past 2^53 in YAML or JSON text, for tooling (ml-4cn.12).
 *
 * A JavaScript number holds integers exactly only up to 2^53: past that, a
 * feature id written `12345678901234567890` reads as `12345678901234567000`,
 * and two ids that differ only in their last digits become one.
 * {@link bigIntegerWarnings} finds each such integer in YAML or JSON text and
 * warns where it is written.
 *
 * Tooling only: `mlym validate` calls it. Nothing on the elements' path
 * imports this module, so the CDN entry (`register.browser.js`) carries none
 * of it (tests/lazy-chunks.test.ts). TOML is different: its reader knows the
 * digits as written and warns in every parse, browser included.
 */

import { LineCounter, isMap, isScalar, isSeq, parseDocument, type Node } from "yaml";
import { YAML_PARSE_OPTIONS } from "./yaml-parser";
import { bigIntegerMessage, type ValidationWarning } from "./validation-utils";

/**
 * An integer literal: decimal (signed), `0x`, `0o` or `0b`, with TOML's `_`
 * separators. Without its sign and separators, always one `BigInt` reads.
 */
const INTEGER_LITERAL = /^[-+]?(?:\d[\d_]*|0x[\da-fA-F][\da-fA-F_]*|0o[0-7][0-7_]*|0b[01][01_]*)$/;

/** An integer literal's magnitude (its sign dropped), else undefined. */
const magnitude = (literal: string): bigint | undefined =>
  INTEGER_LITERAL.test(literal) ? BigInt(literal.replace(/^[-+]|_/g, "")) : undefined;

const SAFE_LIMIT = 2n ** 53n;

/**
 * Whether an integer literal is past 2^53, where a number stops keeping
 * every integer exactly. `mlym convert` refuses these.
 */
export function pastSafeInteger(literal: string): boolean {
  return (magnitude(literal) ?? 0n) > SAFE_LIMIT;
}

/**
 * Whether `literal`, an integer as written, read as `value` lost digits: not
 * the same integer (only past 2^53 can it differ). `9007199254740992` (2^53)
 * and `18014398509481984` read back exactly, so they don't warn.
 */
function lostDigits(literal: string, value: number): boolean {
  const exact = Number.isSafeInteger(value) ? undefined : magnitude(literal);
  return exact !== undefined && String(exact) !== String(Math.abs(value));
}

/**
 * A warning for every integer in YAML or JSON text that reads as a number
 * with fewer digits, at its key (at the element, inside a list), with the
 * dotted path findings use (`layers.0.source.data.features.0.id`).
 *
 * The parse never throws: text that isn't YAML gives the integers it could
 * read, or none. TOML text isn't read here; `parseDocumentText` already
 * warns for it.
 *
 * @example
 * ```ts
 * bigIntegerWarnings("id: 12345678901234567890\n");
 * // [{ path: "id", line: 1, column: 1,
 * //    message: '12345678901234567890 is beyond the integers a number keeps exactly (2^53), …' }]
 * ```
 */
export function bigIntegerWarnings(text: string): ValidationWarning[] {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text, {
    ...YAML_PARSE_OPTIONS,
    lineCounter,
  });
  const found: ValidationWarning[] = [];
  const visit = (node: unknown, path: unknown[], at: Node | undefined): void => {
    if (isMap(node)) {
      for (const pair of node.items) {
        const key = isScalar(pair.key) ? pair.key.value : pair.key;
        visit(pair.value, [...path, key], isScalar(pair.key) ? pair.key : undefined);
      }
    } else if (isSeq(node)) {
      // An element has no key: the warning points at the element itself.
      node.items.forEach((item, index) => visit(item, [...path, index], undefined));
    } else if (isScalar(node) && typeof node.value === "number" && node.source !== undefined && lostDigits(node.source, node.value)) {
      const start = (at ?? node).range?.[0];
      const position = start === undefined ? undefined : lineCounter.linePos(start);
      found.push({
        path: path.join("."),
        message: bigIntegerMessage(node.source, node.value),
        ...(position ? { line: position.line, column: position.col } : {}),
      });
    }
  };
  visit(doc.contents, [], undefined);
  return found;
}
