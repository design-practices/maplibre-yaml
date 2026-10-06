/**
 * @file Export lowering for `effect:` — an effect exports to its static layer
 * @module @maplibre-yaml/core/emitter
 *
 * @description
 * **Experimental** (0.7). An effect is an exports-with-fallback construct whose
 * fallback is, by construction, the layer it sits on: the author wrote a
 * complete static layer and the effect enhances it at runtime. So the
 * lowering is usually "ship the layer as authored", with one `lossy`
 * warning — the exported map is not the map the effect draws, which is
 * exactly what `--strict` exists to refuse.
 *
 * A registered effect may refine that through its `fallback(params, layer)`
 * (exposed to core as {@link EffectsHost.lower}): return an adjusted layer,
 * or `null` when the layer doesn't export (it is dropped from the emitted
 * style, still reported as lossy). The hook only runs where the effects
 * package is loaded — `mlym emit` does not load it, so the CLI always ships
 * the layer as authored; built-in effects' fallbacks are the identity, so
 * both paths agree for them.
 *
 * Both the projection and the `layer.effect` export-class registration call
 * {@link lowerEffectLayer}, so the two cannot drift (the markers precedent).
 */

import { getEffectsHost, type EffectBlock } from "../effects-host";
import type { EmitWarning } from "./project";

/** The result of lowering one effect-bearing layer. */
export interface EffectLowering {
  /** The layer the emitted style carries, or `null` when declared absent. */
  layer: Record<string, unknown> | null;
  warning: EmitWarning;
}

/** The registration's author-facing sentence (also used in the warning). */
export const EFFECT_ON_EMIT =
  "Effects are runtime shaders with no style.json form, so the layer exports " +
  "with a fallback: the emitted style carries its own static style instead — lossy, so " +
  "--strict refuses it.";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Lower one layer's effect.
 *
 * @param layer - the layer's style-half spec (the static fallback)
 * @param effect - the authored `effect:` block
 */
export function lowerEffectLayer(
  layer: Record<string, unknown>,
  effect: unknown
): EffectLowering {
  const id = String(layer["id"] ?? "");
  const type =
    isPlainObject(effect) && typeof effect["type"] === "string"
      ? effect["type"]
      : "(untyped)";
  const path = `layers.${id}.effect`;
  const base = {
    path,
    kind: "lossy" as const,
    construct: "layer.effect",
    exportClass: "exports-with-fallback" as const,
  };

  const host = getEffectsHost();
  const lowered =
    host && isPlainObject(effect) ? host.lower(effect as EffectBlock, { ...layer }) : undefined;

  if (lowered === null) {
    return {
      layer: null,
      warning: {
        ...base,
        message:
          `effect "${type}" on \`${id}\` declares no static form: the layer is ` +
          "absent from the emitted style.",
      },
    };
  }

  return {
    layer: lowered ?? layer,
    warning: {
      ...base,
      message: `effect "${type}" on \`${id}\` — ${EFFECT_ON_EMIT}`,
    },
  };
}
