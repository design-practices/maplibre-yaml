/**
 * @file The eject-class registry — every construct declares its eject behavior
 * @module @maplibre-yaml/core/eject
 *
 * @description
 * The 0.7 doctrine (R4/R5): fallback-where-honest, format-wide. Every
 * construct in the format carries a declared *eject class* — what `mlym emit`
 * does with it — so the three-way split that grew by accident (style ejects,
 * effects eject via fallback, experience chrome silently vanishes) becomes a
 * declared, testable contract instead of an undocumented one.
 *
 * The three classes:
 *
 * - **`ejects`** — the construct has an honest style.json representation and
 *   compiles to it (camera keys, `state`, layer `before` via ordering).
 * - **`fallback`** — the construct compiles to a documented approximation
 *   (markers → symbol layers + sprites; animated effects → static presets).
 *   Its definition carries an `eject()` that produces the lowered form.
 * - **`declared-absence`** — the construct is interactive-only and has no
 *   honest style.json form (popups, hover, controls, live-data polling). It
 *   is *reported* on emit, never silently dropped.
 *
 * The registry follows the house registry pattern (`ExtensionRegistry`):
 * instance-based, Map-backed, register-throws-on-duplicate, closed-world.
 * Closed-world is the load-bearing property — a runtime construct that
 * reaches the emitter without a registration is a thrown error, not a silent
 * drop, so the construct list and the emit report can never drift apart
 * (the same schema/renderer-contract lesson the gallery census taught).
 */

import type { EmitAsset } from "../emitter/assets";
import type { EmitWarning } from "../emitter/project";

/** What `mlym emit` does with a construct. */
export type EjectClass = "ejects" | "fallback" | "declared-absence";

/** The lowered output of a `fallback`-class construct. */
export interface EjectLowering {
  layers?: Record<string, unknown>[];
  sources?: Record<string, Record<string, unknown>>;
  /** Sprite descriptors, in the emitter's shared vocabulary (U4's pipeline). */
  assets?: EmitAsset[];
  warnings?: EmitWarning[];
}

/** Context handed to a `fallback` construct's `eject()`. */
export interface EjectContext {
  /** The construct's authored value. */
  value: unknown;
  /** Dotted path of the node carrying it (for warning paths). */
  path: string;
}

/** A construct's declared eject behavior. */
export interface EjectClassDefinition {
  class: EjectClass;
  /**
   * One author-facing sentence: what emit does with this construct. Used
   * verbatim in `mlym emit`'s report and the docs' eject-class table, so it
   * is written for the person reading a warning, not for the source.
   */
  onEmit: string;
  /**
   * Produce the lowered form — required exactly for `fallback`-class
   * constructs (registration enforces both directions).
   */
  eject?: (ctx: EjectContext) => EjectLowering;
}

/**
 * The registry. Keys are construct names, namespaced by where the construct
 * lives: `layer.interactive`, `source.refresh`, `map.options`, `controls`,
 * `state`, `x-*`.
 */
export class EjectClassRegistry {
  private definitions = new Map<string, EjectClassDefinition>();

  /** Register a construct. Throws on duplicates and on class/eject mismatch. */
  register(construct: string, definition: EjectClassDefinition): void {
    if (this.definitions.has(construct)) {
      throw new Error(
        `[eject] construct "${construct}" is already registered — the registry is ` +
          "closed-world and a second registration would make the emit report ambiguous."
      );
    }
    if (definition.class === "fallback" && typeof definition.eject !== "function") {
      throw new Error(
        `[eject] construct "${construct}" declares class "fallback" without an eject() — ` +
          "a fallback with no lowering is a silent drop wearing a different name."
      );
    }
    if (definition.class !== "fallback" && definition.eject) {
      throw new Error(
        `[eject] construct "${construct}" declares class "${definition.class}" with an ` +
          'eject() — only "fallback" constructs lower; reclassify or remove the hook.'
      );
    }
    this.definitions.set(construct, definition);
  }

  /** Look up a construct; undefined when unregistered. */
  get(construct: string): EjectClassDefinition | undefined {
    return this.definitions.get(construct);
  }

  /**
   * Look up a construct the emitter is about to act on. Unregistered is a
   * thrown error — the loud-failure half of the closed world.
   */
  require(construct: string): EjectClassDefinition {
    const definition = this.definitions.get(construct);
    if (!definition) {
      throw new Error(
        `[eject] construct "${construct}" reached the emitter with no registered eject ` +
          "class. Every runtime construct must declare one (ejects / fallback / " +
          "declared-absence) in packages/core/src/eject/registrations.ts — an " +
          "unregistered construct would otherwise vanish from emitted styles silently."
      );
    }
    return definition;
  }

  /** Whether a construct is registered. */
  has(construct: string): boolean {
    return this.definitions.has(construct);
  }

  /** All registrations, for docs tables and exhaustiveness tests. */
  entries(): [string, EjectClassDefinition][] {
    return [...this.definitions.entries()];
  }
}
