/**
 * @file The export-class registry — every construct declares its export behavior
 * @module @maplibre-yaml/core/export
 *
 * @description
 * The 0.7 doctrine (R4/R5): fallback-where-honest, format-wide. Every
 * construct in the format carries a declared *export class* — what `mlym emit`
 * does with it when exporting to style.json — so the three-way split that grew
 * by accident (style exports, effects export with a fallback, experience chrome
 * silently vanishes) becomes a
 * declared, testable contract instead of an undocumented one.
 *
 * The three classes:
 *
 * - **`exports`** — the construct has an honest style.json representation and
 *   compiles to it (camera keys, `state`, layer `before` via ordering).
 * - **`exports-with-fallback`** — the construct compiles to a documented approximation
 *   (markers → symbol layers + sprites; animated effects → static presets).
 *   Its definition carries an `export()` that produces the lowered form.
 * - **`no-export`** — the construct is interactive-only and has no
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

import type { EmitAsset, EmitImageRef } from "../emitter/assets";
import type { EmitWarning } from "../emitter/project";
import type { MapModel } from "../model/types";

/** What `mlym emit` does with a construct. */
export type ExportClass = "exports" | "exports-with-fallback" | "no-export";

/** The lowered output of an `exports-with-fallback` construct. */
export interface ExportLowering {
  layers?: Record<string, unknown>[];
  sources?: Record<string, Record<string, unknown>>;
  /** Sprite descriptors, in the emitter's shared vocabulary (U4's pipeline). */
  assets?: EmitAsset[];
  /** Fetch-at-emit image refs the lowering references (marker icons). */
  images?: EmitImageRef[];
  /**
   * A replacement root camera, for constructs that lower to one (`fitTo` →
   * the computed `center`/`zoom`).
   */
  camera?: { center: [number, number]; zoom: number };
  warnings?: EmitWarning[];
}

/** Context handed to an `exports-with-fallback` construct's `export()`. */
export interface ExportContext {
  /** The construct's authored value. */
  value: unknown;
  /** Dotted path of the node carrying it (for warning paths). */
  path: string;
  /**
   * The whole document, for constructs whose lowering reads beyond their own
   * value (`fitTo` reads the source it names). Optional: a lowering that
   * needs it must keep the authored value and warn when it is missing.
   */
  model?: MapModel;
}

/** A construct's declared export behavior. */
export interface ExportClassDefinition {
  class: ExportClass;
  /**
   * One author-facing sentence: what emit does with this construct. Used
   * verbatim in `mlym emit`'s report and the docs' export-class table, so it
   * is written for the person reading a warning, not for the source.
   */
  onEmit: string;
  /**
   * Produce the lowered form — required exactly for `exports-with-fallback`
   * constructs (registration enforces both directions).
   */
  export?: (ctx: ExportContext) => ExportLowering;
}

/**
 * The registry. Keys are construct names, namespaced by where the construct
 * lives: `layer.interactive`, `source.refresh`, `map.options`, `controls`,
 * `state`, `x-*`.
 */
export class ExportClassRegistry {
  private definitions = new Map<string, ExportClassDefinition>();

  /** Register a construct. Throws on duplicates and on class/export-hook mismatch. */
  register(construct: string, definition: ExportClassDefinition): void {
    if (this.definitions.has(construct)) {
      throw new Error(
        `[export] construct "${construct}" is already registered — the registry is ` +
          "closed-world and a second registration would make the emit report ambiguous."
      );
    }
    if (definition.class === "exports-with-fallback" && typeof definition.export !== "function") {
      throw new Error(
        `[export] construct "${construct}" declares class "exports-with-fallback" without an export() — ` +
          "a fallback with no lowering is a silent drop wearing a different name."
      );
    }
    if (definition.class !== "exports-with-fallback" && definition.export) {
      throw new Error(
        `[export] construct "${construct}" declares class "${definition.class}" with an ` +
          'export() — only "exports-with-fallback" constructs lower; reclassify or remove the hook.'
      );
    }
    this.definitions.set(construct, definition);
  }

  /** Look up a construct; undefined when unregistered. */
  get(construct: string): ExportClassDefinition | undefined {
    return this.definitions.get(construct);
  }

  /**
   * Look up a construct the emitter is about to act on. Unregistered is a
   * thrown error — the loud-failure half of the closed world.
   */
  require(construct: string): ExportClassDefinition {
    const definition = this.definitions.get(construct);
    if (!definition) {
      throw new Error(
        `[export] construct "${construct}" reached the emitter with no registered export ` +
          "class. Every runtime construct must declare one (exports / exports-with-fallback / " +
          "no-export) in packages/core/src/export/registrations.ts — an " +
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
  entries(): [string, ExportClassDefinition][] {
    return [...this.definitions.entries()];
  }
}
