/**
 * @file Capability policy — what a document may do, where it is being compiled
 * @module @maplibre-yaml/core
 *
 * @description
 * Two facts decide what a document is allowed to produce, and neither is a
 * property of the document itself:
 *
 * - **What runtime will render it.** `state:` needs maplibre-gl 5.6.0; below
 *   that it has to be compiled away rather than emitted.
 * - **Who authored it.** A developer writing YAML in their own repository and a
 *   collaborator typing into a shared editor are the same document format and
 *   completely different trust situations.
 *
 * Keeping both out of the schema is deliberate. A document validates identically
 * everywhere; only its *projection* differs. That is what lets one artifact be
 * checked once in CI and then compiled differently for a trusted build and an
 * untrusted room, and it is why `--with-fallbacks` can degrade rather than fail.
 *
 * This lives at the package root rather than inside the emitter because the
 * same policy gates parse, render, and emit — the `!html` escape and the URL
 * scheme allowlist are enforced at render time in a browser, not at compile
 * time. Two copies would let default-deny hold on one path and not the other.
 */

/**
 * Where a document came from, and therefore how much it is trusted.
 *
 * @remarks
 * Named after the authoring situation rather than a permission level, because
 * the situation is what a host actually knows. A host wiring this up asks "is
 * this document from my repo or from a user?", not "should this be level 2".
 */
export type TrustContext =
  /** Authored in the host's own codebase, by someone who could edit the host. */
  | "trusted"
  /** Authored by someone other than whoever renders it. Treat as hostile. */
  | "untrusted";

/** The maplibre-gl release that introduced `state` and `global-state`. */
export const STATE_RUNTIME_FLOOR = "5.6.0";

export interface CapabilityPolicy {
  /**
   * Target maplibre-gl version, as a semver string.
   *
   * @remarks
   * Undefined means "assume the floor is not met" rather than "assume it is".
   * A caller who has not said which runtime they target is not making a claim
   * about it, and guessing generously produces a style that validates in CI
   * and renders blank in production.
   */
  target?: string;
  trust: TrustContext;
  /**
   * Raw markup via the `!html` tag. Denied by default in untrusted contexts.
   */
  allowHtml?: boolean;
  /** Origins live-data endpoints may point at. Undefined means unrestricted. */
  allowedOrigins?: string[];
  /**
   * Force `state:` to compile away even when the target runtime supports it.
   *
   * @remarks
   * `state` and `global-state` are maplibre-gl JS only — as of style-spec
   * 24.8.5, Android and iOS are still open issues — so a style emitted with
   * `state` intact does not render on maplibre-native at any version. A caller
   * who needs the emitted artifact to be portable across renderers sets this,
   * and the runtime gate inlines the defaults as it would for an old JS target.
   * Default is off: keeping `state` is right for the common JS case, and this
   * makes full portability reachable without making it the default.
   */
  inlineState?: boolean;
}

/** The policy that applies when a host has not supplied one. */
export const DEFAULT_POLICY: CapabilityPolicy = { trust: "untrusted" };

/** Compare dotted numeric versions. Returns true when `version` >= `floor`. */
export function meetsVersion(version: string | undefined, floor: string): boolean {
  if (!version) return false;
  const clean = version.replace(/^[^\d]*/, "");
  const parse = (v: string) => v.split(".").map((p) => Number.parseInt(p, 10) || 0);
  const [a, b, c] = parse(clean);
  const [x, y, z] = parse(floor);
  if ((a ?? 0) !== (x ?? 0)) return (a ?? 0) > (x ?? 0);
  if ((b ?? 0) !== (y ?? 0)) return (b ?? 0) > (y ?? 0);
  return (c ?? 0) >= (z ?? 0);
}

/** Whether the target runtime can carry `state:` through to the emitted style. */
export function supportsState(policy: CapabilityPolicy): boolean {
  if (policy.inlineState) return false;
  return meetsVersion(policy.target, STATE_RUNTIME_FLOOR);
}

/**
 * Whether raw markup is permitted.
 *
 * @remarks
 * Default-deny in untrusted contexts, and an explicit `allowHtml: true` is
 * honored there — a host that has its own sanitizer is entitled to say so. The
 * default is what matters: a host that has thought about none of this gets the
 * safe behavior rather than the convenient one.
 */
export function allowsHtml(policy: CapabilityPolicy): boolean {
  if (policy.allowHtml !== undefined) return policy.allowHtml;
  return policy.trust === "trusted";
}

/**
 * Whether the document may dispatch a named event to a host-supplied handler
 * (the `emit` interaction's host hook).
 *
 * @remarks
 * Default-deny, and — unlike {@link allowsHtml} — with no per-policy override
 * field. A host hook hands control to code the host wrote; the only situation in
 * which that is safe is one where the document author *is* the host, which is
 * exactly `trust: "trusted"`. An untrusted document that names an event finds
 * the gate shut and the interaction inert, so a projected-for-an-untrusted-room
 * artifact carries no live callback into the page. There is no `allowHostHook`
 * escape hatch on purpose: an author who could set it could also set
 * `trust: "trusted"`, and collapsing the two keeps one dial instead of two that
 * can disagree.
 */
export function allowsHostHook(policy: CapabilityPolicy): boolean {
  return policy.trust === "trusted";
}

/** Whether a live-data endpoint may point at this URL. */
export function allowsOrigin(policy: CapabilityPolicy, url: string): boolean {
  if (!policy.allowedOrigins) return true;
  try {
    const origin = new URL(url).origin;
    return policy.allowedOrigins.includes(origin);
  } catch {
    // A relative URL resolves against the host's own page, so it is same-origin
    // by construction and needs no allowlist entry.
    return !/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(url);
  }
}
