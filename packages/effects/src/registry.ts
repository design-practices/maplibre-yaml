/**
 * @file The effect registry
 * @module @maplibre-yaml/effects
 *
 * @description
 * The house registry pattern (`ExtensionRegistry`, `InteractionRegistry`,
 * `ExportClassRegistry`): instance-based, `Map`-backed, register throws on a
 * duplicate. Registration is also where the effect contract is enforced —
 * a missing `fallback` or a malformed definition fails loudly at the call
 * site, not at the first frame on some user's map.
 *
 * @experimental
 */

import type { EffectDefinition } from "./contract";

const TYPE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** A registry of named effects. @experimental */
export class EffectRegistry {
  private readonly definitions = new Map<string, EffectDefinition<unknown>>();

  /**
   * Register an effect.
   *
   * @throws on a duplicate `type`, a non-kebab-case `type`, a missing
   *   `backend`/`params`/`fragment`, or a missing `fallback`.
   */
  register<P>(definition: EffectDefinition<P>): void {
    const type = definition?.type;
    if (typeof type !== "string" || !TYPE_PATTERN.test(type)) {
      throw new Error(
        `[effects] effect type ${JSON.stringify(type)} must be kebab-case ` +
          '(e.g. "tonal-hatch") — it is the name documents write.'
      );
    }
    if (this.definitions.has(type)) {
      throw new Error(
        `[effects] effect "${type}" is already registered — re-registering would ` +
          "silently change what every document naming it draws."
      );
    }
    if (typeof definition.fallback !== "function") {
      throw new Error(
        `[effects] effect "${type}" has no fallback(): every effect must say what ` +
          "it exports to (return the layer to keep it, null if it doesn't export)."
      );
    }
    if (!definition.backend || typeof definition.backend.attach !== "function") {
      throw new Error(`[effects] effect "${type}" has no backend (e.g. backends.extrusions).`);
    }
    if (!definition.params || typeof definition.params.safeParse !== "function") {
      throw new Error(`[effects] effect "${type}" needs a zod \`params\` schema.`);
    }
    if (typeof definition.fragment !== "string" || !/\beffect_color\s*\(/.test(definition.fragment)) {
      throw new Error(
        `[effects] effect "${type}"'s fragment must define ` +
          "`vec4 effect_color(EffectInput i)`."
      );
    }
    this.definitions.set(type, definition as EffectDefinition<unknown>);
  }

  /** Look up an effect; undefined when unregistered. */
  get(type: string): EffectDefinition<unknown> | undefined {
    return this.definitions.get(type);
  }

  has(type: string): boolean {
    return this.definitions.has(type);
  }

  /** Registered types, in registration order. */
  types(): string[] {
    return [...this.definitions.keys()];
  }
}

/**
 * The default registry: what `registerEffect()` writes to and what the
 * `<ml-map>` integration reads.
 *
 * @experimental
 */
export const effectRegistry = new EffectRegistry();

/**
 * Register an effect in the default registry.
 *
 * @experimental The effects API may change in minor releases.
 *
 * @example
 * ```ts
 * import { registerEffect, backends, z } from "@maplibre-yaml/effects";
 *
 * registerEffect({
 *   type: "blueprint",
 *   backend: backends.extrusions,
 *   params: z.object({ line: z.string().default("#cfeeff"), grid: z.number().positive().default(4) }),
 *   uniforms: (p) => ({ u_line: p.line, u_grid: p.grid }),
 *   fragment: `vec4 effect_color(EffectInput i) { ... }`,
 *   fallback: (_p, layer) => layer,
 * });
 * ```
 */
export function registerEffect<P>(definition: EffectDefinition<P>): void {
  effectRegistry.register(definition);
  // Registering an effect means wanting documents to use it: make sure core
  // can see this registry (idempotent; set by host.ts to avoid a cycle).
  onRegister?.();
}

let onRegister: (() => void) | undefined;

/** @internal host.ts wires this so registerEffect() installs the core hook. */
export function setOnRegister(fn: () => void): void {
  onRegister = fn;
}
