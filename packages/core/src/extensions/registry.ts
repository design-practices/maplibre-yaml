/**
 * @file The extension registry for `x-*` namespaces
 * @module @maplibre-yaml/core/extensions
 *
 * @description
 * The format's answer to "how does a host add its own keys without forking the
 * schema", and the boundary that makes those keys safe.
 *
 * Extensibility resolves as: closed erasable half, claimably-open runtime half.
 * The erasable schema stays closed — it must compile to spec, so there is no
 * plugin mechanism for it. Everything else rides `x-*` keys, which the schema
 * admits as passthrough. That is convenient and, on its own, dangerous: today a
 * consumer reads those blocks with no validation and strips them by hand, which
 * is exactly the state map-party is in and the reason its panel surface rides
 * unvalidated passthrough.
 *
 * The registry closes that gap without closing the schema. A host registers a
 * namespace with a Zod schema and optional normalization; the registry then
 * validates every block in that namespace *before any consumer sees it*, so an
 * `x-*` block is a trust boundary rather than a hole. A block whose namespace
 * is not registered, or that fails its schema, is dropped — never partially
 * delivered.
 *
 * The registry does **not** strip on emit. It does not need to: the emitter is
 * an allowlist projection, so `x-*` keys never reach the emitted style in the
 * first place, and the projection's own invariant check would throw if one did.
 * One mechanism, not two — the alternative is two implementations of "remove
 * the extensions" that drift.
 */

import type { z } from "zod";

/**
 * How a registered namespace is validated and shaped.
 */
export interface ExtensionDefinition<T = unknown> {
  /** Validates a block in this namespace. A block that fails is dropped. */
  schema: z.ZodType<T>;
  /**
   * Reshape a validated block before a consumer receives it.
   *
   * @remarks
   * This is where an authoring shorthand becomes the canonical form the rest of
   * the host expects — map-party's `filterableProperties: [boro, dba]`
   * expanding to `[{property, label}]` is the concrete case. Runs only after
   * validation, so it always sees a well-typed block. Declaring it here rather
   * than leaving each consumer to normalize is the point: one rule, stated
   * once, applied everywhere the block is read.
   */
  normalize?: (value: T) => unknown;
}

/** A validated extension block and where it was found. */
export interface ExtensionBlock {
  /** The `x-*` namespace, e.g. `x-map-party`. */
  namespace: string;
  /** Dotted path to the node carrying it, `""` for the document root. */
  path: string;
  /** The validated, normalized value. */
  value: unknown;
}

export interface ExtensionWarning {
  path: string;
  namespace: string;
  message: string;
}

export interface ExtractResult {
  blocks: ExtensionBlock[];
  warnings: ExtensionWarning[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A key is an extension namespace when it begins with `x-`. */
function isExtensionKey(key: string): boolean {
  return key.startsWith("x-");
}

/**
 * A registry of `x-*` extension namespaces.
 *
 * @remarks
 * Deliberately an instance rather than a module singleton: a host embedding two
 * documents from different trust domains may want different registries, and a
 * test wants a fresh one. The library ships no global registrations.
 */
export class ExtensionRegistry {
  private readonly definitions = new Map<string, ExtensionDefinition>();

  /**
   * Register a namespace.
   *
   * @throws if the namespace is already registered — a silent last-wins would
   *   let one registration quietly shadow another, and the whole point is that
   *   the trust contract for a namespace is unambiguous.
   * @throws if the namespace does not begin with `x-`, since only `x-*` keys
   *   are passthrough; a non-`x-` namespace names a key the schema would reject.
   */
  register<T>(namespace: string, definition: ExtensionDefinition<T>): void {
    if (!isExtensionKey(namespace)) {
      throw new Error(
        `Extension namespace "${namespace}" must begin with "x-". ` +
          "Only x-* keys are admitted as extensions."
      );
    }
    if (this.definitions.has(namespace)) {
      throw new Error(
        `Extension namespace "${namespace}" is already registered. ` +
          "Re-registering would silently shadow the existing schema."
      );
    }
    this.definitions.set(namespace, definition as ExtensionDefinition);
  }

  /** Whether a namespace has a registered schema. */
  has(namespace: string): boolean {
    return this.definitions.has(namespace);
  }

  /**
   * Extract every extension block from a parsed document.
   *
   * @remarks
   * Walks schema-known object nodes — the document root, layers, sources — and
   * never descends into an opaque data payload, so a GeoJSON feature property
   * named `x-anything` is author data, not an extension block. This mirrors the
   * boundary the emitter's projection uses; the two agree on where document
   * structure ends.
   *
   * Every extension key is accounted for: a registered one is validated,
   * normalized, and returned; an unregistered one is dropped with a warning; an
   * invalid one is dropped with a warning naming the failure. Nothing is
   * partially delivered.
   */
  extract(document: unknown): ExtractResult {
    const blocks: ExtensionBlock[] = [];
    const warnings: ExtensionWarning[] = [];
    this.walk(document, "", blocks, warnings);
    return { blocks, warnings };
  }

  private walk(
    node: unknown,
    path: string,
    blocks: ExtensionBlock[],
    warnings: ExtensionWarning[]
  ): void {
    if (Array.isArray(node)) {
      node.forEach((item, i) => this.walk(item, `${path}[${i}]`, blocks, warnings));
      return;
    }
    if (!isPlainObject(node)) return;

    for (const key of Object.keys(node)) {
      const childPath = path ? `${path}.${key}` : key;

      if (isExtensionKey(key)) {
        this.resolveBlock(key, path, node[key], blocks, warnings);
        continue;
      }

      // `data`/`properties` carry author payloads that may themselves contain
      // `x-`-prefixed keys; those are data, not extension blocks.
      if (key === "data" || key === "properties") continue;

      this.walk(node[key], childPath, blocks, warnings);
    }
  }

  private resolveBlock(
    namespace: string,
    path: string,
    raw: unknown,
    blocks: ExtensionBlock[],
    warnings: ExtensionWarning[]
  ): void {
    const definition = this.definitions.get(namespace);
    if (!definition) {
      warnings.push({
        path,
        namespace,
        message:
          `"${namespace}" has no registered schema; it is dropped and reaches ` +
          "neither a consumer nor the emitted style.",
      });
      return;
    }

    const result = definition.schema.safeParse(raw);
    if (!result.success) {
      warnings.push({
        path,
        namespace,
        message:
          `"${namespace}" failed its registered schema and is dropped: ` +
          result.error.issues.map((i) => i.message).join("; "),
      });
      return;
    }

    const value = definition.normalize ? definition.normalize(result.data) : result.data;
    blocks.push({ namespace, path, value });
  }
}
