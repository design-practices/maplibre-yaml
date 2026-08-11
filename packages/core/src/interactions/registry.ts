/**
 * @file The interaction registry — closed-world resolution by name
 * @module @maplibre-yaml/core/interactions
 *
 * @description
 * The set of named interactions core ships, held keyed by `name` and resolved
 * against a fixed allowlist. Its job is the by-name surface the emit
 * host-handler resolution and the compiled-map attach path build on: a name is
 * either a built-in on the allowlist or it is denied, never anything in
 * between.
 *
 * Resolution is closed-world, default-deny — the same discipline as
 * {@link ExtensionRegistry}. An unknown name yields a denial carrying a
 * warning, not a thrown error and not a silent miss, so a by-name caller drops
 * the unrecognized interaction and keeps going with a diagnostic rather than
 * crashing on author or host input. In the live renderer this is
 * defense-in-depth: `EventHandler` binds the whole built-in set and dispatches
 * by `select`, and the config keys it reads are already schema-constrained.
 *
 * Order is behavior and it lives here too: the registry hands back the *ordered*
 * click set and hover set — popup before flyTo — so dispatch order survives the
 * registry rather than depending on a separate array staying in sync with it.
 */

import { CLICK_INTERACTIONS, HOVER_INTERACTIONS } from "./built-ins";
import type { Interaction } from "./types";

/**
 * The result of resolving a name that is not on the allowlist.
 *
 * @remarks
 * The `denied` discriminant is what a caller narrows on: a successful resolve
 * returns the {@link Interaction} itself (which has no `denied` key), a failed
 * one returns this. Default-deny means a caller that forgets to check gets an
 * object with no `create`/`select`, not a usable handler.
 */
export interface InteractionDenial {
  denied: true;
  /** Human-readable reason, naming the rejected interaction. */
  warning: string;
}

/**
 * A registry of the named interactions core ships.
 *
 * @remarks
 * Deliberately an instance rather than a module singleton, mirroring
 * {@link ExtensionRegistry}: two documents from different trust domains, or two
 * tests, each get their own registry with no shared state. The allowlist is
 * seeded once at construction — the built-in click and hover sets by default —
 * and never mutated after: there is no `register`/`add` method, so the
 * vocabulary a given registry resolves is fixed for its lifetime.
 *
 * The closed-world guarantee is about the *document* trust boundary: an
 * untrusted document can never introduce a handler, because a document only
 * *names* interactions and an unknown name is denied — it cannot pass a
 * function in. Host JS can, of course, construct a registry seeded with its own
 * interaction sets; that is host code writing host code, outside the document
 * trust boundary, and is not a path a document can reach.
 */
export class InteractionRegistry {
  private readonly click: readonly Interaction[];
  private readonly hover: readonly Interaction[];
  private readonly byName: ReadonlyMap<string, Interaction>;

  /**
   * Seed the registry from the click and hover interaction sets.
   *
   * @param click - Click interactions in dispatch order (default: the built-in
   *   {@link CLICK_INTERACTIONS} — popup before flyTo).
   * @param hover - Hover interactions in dispatch order (default: the built-in
   *   {@link HOVER_INTERACTIONS}).
   * @throws if two interactions share a `name` **within one trigger list** — a
   *   name must resolve to exactly one handler per trigger, and a silent
   *   last-wins would let one shadow another. A name that appears once in the
   *   click list AND once in the hover list is **not** a duplicate: it is one
   *   logical interaction key (e.g. `emit`) valid on both triggers, each with
   *   its own runtime. Such a name is deduped into {@link byName} — the
   *   trigger-agnostic allowlist — as a single membership.
   */
  constructor(
    click: readonly Interaction[] = CLICK_INTERACTIONS,
    hover: readonly Interaction[] = HOVER_INTERACTIONS
  ) {
    this.click = click;
    this.hover = hover;

    // Uniqueness is enforced per trigger list, not across the union: an intra-
    // list duplicate is a genuine collision (two handlers, one name, one
    // trigger) and throws; the same name across the two lists is the legitimate
    // both-triggers case and is allowed. `byName` is the closed-world validation
    // allowlist `validateTrigger` checks keys against — trigger-agnostic, so a
    // cross-trigger name is present there exactly once (first writer wins; which
    // runtime seeds it is inert, since `has`/`resolve` test membership only).
    const byName = new Map<string, Interaction>();
    for (const [list, trigger] of [
      [click, "click"],
      [hover, "hover"],
    ] as const) {
      const seen = new Set<string>();
      for (const interaction of list) {
        if (seen.has(interaction.name)) {
          throw new Error(
            `Interaction name "${interaction.name}" is registered twice in ` +
              `the ${trigger} set. A name must resolve to exactly one handler ` +
              "per trigger."
          );
        }
        seen.add(interaction.name);
        if (!byName.has(interaction.name)) byName.set(interaction.name, interaction);
      }
    }
    this.byName = byName;
  }

  /**
   * Resolve an interaction name to its handler, or deny it.
   *
   * @returns the {@link Interaction} when `name` is on the allowlist, otherwise
   *   an {@link InteractionDenial} carrying a warning. Default-deny: an unknown
   *   name is never a handler, so a by-name caller drops it with a diagnostic
   *   rather than throwing or running something unintended.
   */
  resolve(name: string): Interaction | InteractionDenial {
    const interaction = this.byName.get(name);
    if (!interaction) {
      return {
        denied: true,
        warning:
          `Interaction "${name}" is not a recognized interaction; it is ` +
          "denied and no handler runs.",
      };
    }
    return interaction;
  }

  /** Whether a name is on the allowlist. */
  has(name: string): boolean {
    return this.byName.has(name);
  }

  /**
   * The click interactions in dispatch order.
   *
   * @remarks
   * The ordered set `EventHandler`/`attachInteractions` iterate for a click
   * trigger. Order is behavior — popup dispatches before flyTo so the popup
   * opens at the clicked point and then travels with the camera.
   */
  clickInteractions(): readonly Interaction[] {
    return this.click;
  }

  /** The hover interactions in dispatch order. */
  hoverInteractions(): readonly Interaction[] {
    return this.hover;
  }
}

/**
 * The default interaction registry, seeded with the built-in allowlist.
 *
 * @remarks
 * A factory rather than a shared constant, so each caller gets an independent
 * instance — the same non-singleton decision `ExtensionRegistry` makes.
 */
export const createInteractionRegistry = (): InteractionRegistry =>
  new InteractionRegistry();
