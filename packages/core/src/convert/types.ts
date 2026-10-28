/**
 * @file The shapes the converter's two halves share
 * @module @maplibre-yaml/core/convert/types
 *
 * @description
 * `convertDocument` (the entry, convert/index.ts) reads the author's text into
 * an {@link AuthoredDocument}; the lazy `convert` chunk (convert/chunk.ts)
 * prints it in the target format and decides what is lost. Types only: both
 * halves import this file, and neither may import the other's code.
 */

import type { DocumentFormat } from "../parser/yaml-parser";

/** A 1-based line and column in the input text. */
export interface SourceAt {
  line: number;
  column: number;
}

/**
 * One value of the authored document. A table is a list of entries, never a
 * plain object: JavaScript would move integer-like keys (`categories: {10: …,
 * 2: …}`) to the front, and an object key named `__proto__` is not data.
 */
export type AuthoredNode =
  | { kind: "map"; entries: AuthoredEntry[]; at?: SourceAt }
  | { kind: "seq"; items: AuthoredNode[]; at?: SourceAt }
  | { kind: "string"; value: string; at?: SourceAt }
  | {
      kind: "number";
      value: number;
      /** A whole number written as a float (`1.0`), so it prints as one. */
      float?: boolean;
      /** An integer literal past 2^53, as written: the parsed value has already lost digits. */
      unsafe?: string;
      at?: SourceAt;
    }
  | { kind: "boolean"; value: boolean; at?: SourceAt }
  | { kind: "null"; at?: SourceAt }
  /** `!html "…"` in YAML, `{"$html": "…"}` in JSON and TOML. */
  | { kind: "html"; value: string; at?: SourceAt };

export interface AuthoredEntry {
  key: string;
  value: AuthoredNode;
  /** Where the key is written. */
  at?: SourceAt;
}

/** An anchor reuse that reading the document expanded. */
export interface AuthoredExpansion {
  /** `alias` for `*name`, `merge` for `<<: *name`. */
  kind: "alias" | "merge";
  /** The anchor's name. */
  name: string;
  at: SourceAt;
}

/** What the entry read from the author's text. */
export interface AuthoredDocument {
  from: DocumentFormat;
  root: AuthoredNode;
  /**
   * The schema the document names, from any of its spellings: a root
   * `$schema` key, a `# yaml-language-server: $schema=…` modeline, or a TOML
   * `#:schema …` directive. It is not part of {@link root}.
   */
  schema?: string;
  /** The comments, in order. A schema modeline or directive is not one of them. */
  comments: Array<{ at: SourceAt; text: string }>;
  /** Every alias and merge key, where it is written. */
  expansions: AuthoredExpansion[];
}

/** Something the conversion could not keep. Reported, never fatal (unless `--strict`). */
export interface ConvertLoss {
  kind: "comment" | "anchor" | "merge" | "null";
  message: string;
  /** The value's path, as validation errors name it (`layers[0].paint`). */
  path?: string;
  line?: number;
  column?: number;
}

/** Why the conversion failed: a value the target format cannot hold. */
export interface ConvertError {
  path: string;
  message: string;
  code: "convert-null" | "convert-number" | "convert-shape";
  line?: number;
  column?: number;
}

/** What the `convert` chunk returns. */
export type ConvertOutcome =
  | { ok: true; text: string; losses: ConvertLoss[] }
  | { ok: false; errors: ConvertError[]; losses: ConvertLoss[] };
