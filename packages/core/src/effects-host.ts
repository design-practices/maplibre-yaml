/**
 * @file The effects-host hook — how `@maplibre-yaml/effects` plugs into core
 * @module @maplibre-yaml/core
 *
 * @description
 * **Experimental** (0.7). Core owns the `effect:` layer key — its schema, its
 * export class, its emit lowering, and `<ml-map>`'s auto-attach — but it never
 * imports the effects package. The effects package registers a *host* here
 * instead, so a document without effects pays zero bytes and core keeps no
 * WebGL code.
 *
 * The slot lives on `globalThis` under a `Symbol.for` key rather than in a
 * module variable. Core ships several bundles (`index.js`, the browser
 * `register.browser.js`, `index.browser.js`), and a page can easily load two
 * of them; a module-level slot would then exist twice and a host registered
 * through one copy would be invisible to the `<ml-map>` built from the other.
 * A registry-symbol slot is one slot per realm, whatever the bundling.
 *
 * Without a host, an `effect:` block validates as an open object, the layer
 * renders as its own static self (the effect's fallback, by construction),
 * and validation reports one `unimplemented` warning saying so.
 */

import type { Map as MapLibreMap } from "maplibre-gl";

/** An authored `effect:` block: `type` plus flat params (KTD6). */
export interface EffectBlock {
  type: string;
  [param: string]: unknown;
}

/** One problem with an effect block, path relative to the block. */
export interface EffectIssue {
  path: (string | number)[];
  message: string;
}

/** A layer carrying an effect, as handed to {@link EffectsHost.attach}. */
export interface EffectLayerRef {
  /** The id of the (static) layer the effect enhances. */
  layerId: string;
  effect: EffectBlock;
}

/** What {@link EffectsHost.attach} returns. */
export interface EffectsAttachment {
  /** Remove every effect this attachment added and restore the static layers. */
  detach(): void;
}

/**
 * The contract between core and an effects implementation.
 *
 * @experimental The effects API may change in minor releases (D-A3).
 */
export interface EffectsHost {
  /** Protocol version; bumped on a breaking change to this interface. */
  readonly apiVersion: 1;
  /** Registered effect types, for messages. */
  types(): string[];
  /** Validate a block's type and params. An empty array means valid. */
  validate(effect: EffectBlock): EffectIssue[];
  /**
   * Attach effects to a live map whose style already contains the static
   * layers. Must never throw for an unsupported environment: it declares
   * absence (warns once, leaves the static layer visible) instead.
   */
  attach(map: MapLibreMap, layers: EffectLayerRef[]): EffectsAttachment;
  /**
   * The export lowering for one effect: the layer spec the emitted style
   * should carry, or `null` when the layer doesn't export (it is
   * dropped). `undefined` means "unknown type — ship the layer as authored".
   */
  lower(
    effect: EffectBlock,
    layer: Record<string, unknown>
  ): Record<string, unknown> | null | undefined;
}

const SLOT = Symbol.for("@maplibre-yaml/effects-host");

interface Slot {
  host?: EffectsHost;
  listeners: Set<(host: EffectsHost) => void>;
}

function slot(): Slot {
  const g = globalThis as unknown as Record<symbol, Slot | undefined>;
  let s = g[SLOT];
  if (!s) {
    s = { listeners: new Set() };
    g[SLOT] = s;
  }
  return s;
}

/**
 * Register the effects host. Called by `@maplibre-yaml/effects/register`;
 * hosts never need to call it themselves.
 *
 * @experimental
 * @throws when a different host is already registered — two effect runtimes
 *   on one page would race for the same layers.
 */
export function registerEffectsHost(host: EffectsHost): void {
  const s = slot();
  if (s.host && s.host !== host) {
    throw new Error(
      "[maplibre-yaml] an effects host is already registered — load " +
        "@maplibre-yaml/effects once per page."
    );
  }
  if (s.host === host) return;
  s.host = host;
  for (const listener of [...s.listeners]) listener(host);
}

/** The registered effects host, if any. @experimental */
export function getEffectsHost(): EffectsHost | undefined {
  return slot().host;
}

/**
 * Call `listener` once a host is registered (immediately when one already
 * is). Returns an unsubscribe function.
 *
 * @experimental
 */
export function onEffectsHost(listener: (host: EffectsHost) => void): () => void {
  const s = slot();
  if (s.host) {
    listener(s.host);
    return () => {};
  }
  s.listeners.add(listener);
  return () => s.listeners.delete(listener);
}

/** Test seam: forget the registered host and listeners. @internal */
export function resetEffectsHostForTests(): void {
  const s = slot();
  s.host = undefined;
  s.listeners.clear();
}
