/**
 * @file Where each key and value of a TOML document was written
 * @module @maplibre-yaml/core/parser/toml/index-positions
 *
 * @description
 * The reader builds one {@link TomlNode} tree beside the value: a table or an
 * array is a node, a scalar is just its source offset. {@link TomlPositions}
 * answers the two questions the validation pipeline asks (KTD5): where the
 * value at a path starts, else its nearest ancestor that exists, and where
 * the key at a path is written. Offsets turn into lines and columns only when
 * asked, so a large document pays for a tree of numbers, not of positions.
 *
 * The tree also keeps what the hints need: the dotted key that made a table,
 * and the header that opened one with the keys written under it.
 *
 * Part of the lazy `toml` chunk: core is imported for types only.
 */

import type { PositionIndex, SourcePosition } from "../validation-utils";

/** A scalar's source offset, or a table's or array's node. */
export type TomlEntry = number | TomlNode;

/** A source range: `[start, end)` offsets. */
export type Span = readonly [number, number];

export interface TomlNode {
  /** Where the value starts: its header, its `{` or `[`, or the dotted key segment that made it. */
  at: number;
  /** A table's entries in the order written, or an array's elements. */
  kids: Map<string, TomlEntry> | TomlEntry[];
  /** Where each of a table's keys is written. A key a header names is at the header. */
  keys?: Map<string, number>;
  /** The header (`[layers.paint]`, `[[layers]]`) that opened this table. */
  header?: Span;
  /** The keys written directly under {@link header}, before the next one. */
  headerKeys?: Set<string>;
  /**
   * The dotted key that made this table (`1.5 = …` makes the table `1`),
   * while that is all there is to it: one dotted key, and no header or
   * inline table of its own.
   */
  dotted?: Span;
  /** How many dotted keys wrote into this table. */
  dottedKeys?: number;
}

/** A path segment as the pipeline gives it: array indices may be numbers or digit strings. */
type Segment = string | number;

/** The node at `path`, and the deepest node on the way that exists. */
export function walkPath(root: TomlNode, path: readonly Segment[]): { found: TomlEntry | undefined; nearest: TomlEntry } {
  let node: TomlEntry = root;
  for (const segment of path) {
    if (typeof node === "number") return { found: undefined, nearest: node };
    const next: TomlEntry | undefined = Array.isArray(node.kids)
      ? /^\d+$/.test(String(segment))
        ? node.kids[Number(segment)]
        : undefined
      : node.kids.get(String(segment));
    if (next === undefined) return { found: undefined, nearest: node };
    node = next;
  }
  return { found: node, nearest: node };
}

/** The positions of one TOML document (KTD5), registered for its synthetic YAML. */
export class TomlPositions implements PositionIndex {
  private lineStarts: number[] | undefined;

  constructor(
    readonly root: TomlNode,
    readonly text: string
  ) {}

  /** 1-based line and column of a source offset. */
  position(offset: number): SourcePosition {
    const starts = (this.lineStarts ??= lineStartsOf(this.text));
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - starts[lo]! + 1 };
  }

  valueAt(path: readonly Segment[]): SourcePosition {
    const { nearest } = walkPath(this.root, path);
    return this.position(typeof nearest === "number" ? nearest : nearest.at);
  }

  keyAt(path: readonly Segment[]): SourcePosition | undefined {
    if (path.length === 0) return undefined;
    const { found } = walkPath(this.root, path.slice(0, -1));
    const at = found !== undefined && typeof found !== "number" ? found.keys?.get(String(path[path.length - 1])) : undefined;
    return at === undefined ? undefined : this.position(at);
  }

  /** The keys of the table at `path`, in the order written. */
  keyOrder(path: readonly Segment[]): string[] | undefined {
    const { found } = walkPath(this.root, path);
    return found !== undefined && typeof found !== "number" && !Array.isArray(found.kids) ? [...found.kids.keys()] : undefined;
  }
}

function lineStartsOf(text: string): number[] {
  const starts = [0];
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
  return starts;
}
