/**
 * @file The one-popup slot both interaction hosts share (U7, KTD8)
 * @module @maplibre-yaml/core/interactions
 *
 * @description
 * Popup lifecycle used to be host-owned prose ("mirror the other file"); U7's
 * pinned-vs-hover coexistence quadrupled that duplicated block, so the state
 * machine now lives here once and both hosts (`attachInteractions` and the
 * renderer's `EventHandler`) delegate to it.
 *
 * The contract: ONE popup at a time. A `pinned` popup (click, the default
 * kind) owns the slot until the *user* dismisses it — close button or
 * `closeOnClick` — which frees the slot via the popup's `close` event. A
 * `hover` popup never displaces a pinned one ({@link show} returns `false`)
 * and is itself replaced freely. {@link hideHover} dismisses only a hover
 * popup; a pinned popup's dismissal belongs to the user, never to
 * mouseleave.
 *
 * Ordering note (pinned with a unit test here): maplibre's `Popup.remove()`
 * fires `close` SYNCHRONOUSLY, so the old popup's close handler runs while
 * `active` still points at it — the `active === popup` guard makes that a
 * correct null, and the new popup is assigned afterwards. Reordering the
 * assignment above the `remove()` would let the old handler null the fresh
 * popup.
 */

import type { Map as MapLibreMap, LngLat } from "maplibre-gl";
import { Popup } from "../renderer/maplibre-interop";
import type { PopupBuilder } from "../renderer/popup-builder";
import type { PopupContent } from "./types";
import type { ShowPopupOptions } from "./types";

export class PopupSlot {
  private active: Popup | null = null;
  private kind: "pinned" | "hover" = "pinned";

  constructor(
    private readonly map: MapLibreMap,
    private readonly popupBuilder: PopupBuilder
  ) {}

  /**
   * Show a popup, subject to the slot contract.
   *
   * @returns `false` when suppressed (a hover popup while a pinned one is
   * open), `true` when the popup was actually shown — callers deduping "have
   * I shown this feature" must only record on `true`.
   */
  show(
    content: PopupContent,
    feature: any,
    lngLat: LngLat,
    options?: ShowPopupOptions
  ): boolean {
    const kind = options?.kind ?? "pinned";
    if (kind === "hover" && this.active && this.kind === "pinned") return false;

    this.active?.remove();
    const html = this.popupBuilder.build(content, feature?.properties ?? {});
    const popup = new Popup({
      ...(options?.closeButton !== undefined ? { closeButton: options.closeButton } : {}),
      ...(options?.closeOnClick !== undefined ? { closeOnClick: options.closeOnClick } : {}),
    })
      .setLngLat(lngLat)
      .setHTML(html)
      .addTo(this.map);
    // User dismissal frees the slot — what lets hover popups resume after a
    // pin. The identity guard also makes the synchronous close fired by the
    // remove() above a correct no-op for the popup replacing it.
    popup.on("close", () => {
      if (this.active === popup) this.active = null;
    });
    this.active = popup;
    this.kind = kind;
    return true;
  }

  /** Dismiss the current HOVER popup only. */
  hideHover(): void {
    if (this.active && this.kind === "hover") {
      this.active.remove();
      this.active = null;
    }
  }

  /** Tear down whatever occupies the slot (host destroy/reload). */
  destroy(): void {
    this.active?.remove();
    this.active = null;
  }
}
