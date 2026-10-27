/**
 * @file FullPageMap's zoom/reset buttons, wired once per page
 * @module @maplibre-yaml/astro/client/fullpage-controls
 *
 * @description
 * The browser half of `FullPageMap`: the reset target ("home") per map and
 * the zoom buttons' state, kept in step with the map's document through the
 * element's events. Lives here rather than in the component's `<script>` so
 * it can be exercised in a DOM without rendering the component.
 *
 * Event delegation, not per-element wiring: Astro runs the component's
 * script ONCE per full page load, and with `<ClientRouter />` a soft
 * navigation swaps in new `.ml-fullpage-map` elements without re-running
 * it. Listeners bound to the first page's buttons left zoom/reset dead on
 * every later visit (ml-aot.22). `document` survives the swap, so listening
 * there serves whichever FullPageMap is on the page now, however it got
 * there. The buttons live inside `<ml-map>` (`slot="top-right"`), so
 * `closest()` finds their map even after the element adopts them into its
 * corner container.
 *
 * Since core 0.10 a changed `config`/`src` is applied in place (live
 * documents): the map is not rebuilt, so `ml-map:load` no longer fires for a
 * camera or controls edit. Those arrive as `ml-map:update-applied`, which is
 * listened to as well; `ml-map:load` stays for the first load and for the
 * fallback rebuild a basemap change still does.
 */

import type { MLMap, UpdateSummary } from "@maplibre-yaml/core/components";

type Camera = { center: [number, number]; zoom: number; bearing: number; pitch: number };
type ControlsState = { homes: WeakMap<Element, Camera> };

const KEY = "__mlYamlFullPageControls";

/** Zoom/reset buttons in the document's language, keyed as the server render keys them. */
const LABEL_KEYS = {
  "zoom-in": "NavigationControl.ZoomIn",
  "zoom-out": "NavigationControl.ZoomOut",
  reset: "maplibre-yaml.FullPageMap.ResetView",
} as const;

/** The `<ml-map>` a node inside a FullPageMap belongs to, if any. */
const mapOf = (node: Element): MLMap | null =>
  node.closest(".ml-fullpage-map")?.querySelector<MLMap>("ml-map") ?? null;

/** Whether `event` was dispatched by a FullPageMap's own `<ml-map>`. */
const ownMap = (event: Event): MLMap | null => {
  const target = event.target;
  return target instanceof Element && mapOf(target) === target ? (target as MLMap) : null;
};

/**
 * Wire the page's FullPageMap buttons. Idempotent per window: the document
 * listeners are bound on the first call only; every call wires the maps
 * already on the page (a map that finished loading before this ran -- on a
 * soft navigation into the first page with a FullPageMap -- still gets its
 * home).
 */
export function installFullPageControls(): void {
  const win = window as unknown as Record<string, ControlsState | undefined>;
  const firstRun = !win[KEY];
  const state: ControlsState = (win[KEY] ??= { homes: new WeakMap() });

  const captureHome = (mapEl: MLMap) => {
    const map = mapEl.getMap();
    if (!map) return;
    state.homes.set(mapEl, {
      center: map.getCenter().toArray() as [number, number],
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch(),
    });
  };

  // An in-place camera change eases the map there (core's `cameraSet`), and
  // `ml-map:update-applied` fires as soon as the ease has STARTED: reading
  // the camera then would make the old view the reset target. Wait for the
  // move to settle; a map that is not moving (duration 0, reduced motion, a
  // jump) is read right away, since its `moveend` has already passed.
  const captureHomeWhenSettled = (mapEl: MLMap) => {
    const map = mapEl.getMap();
    if (!map) return;
    if (map.isMoving()) map.once("moveend", () => captureHome(mapEl));
    else captureHome(mapEl);
  };

  // A document with its own navigation control (`controls: { navigation:
  // true }`) already has MapLibre's +/- in the corner; a second stack of
  // zoom buttons under it looks like a bug (ml-aot.40). Keep only reset.
  // Re-checked on every load and every applied update, since a new document
  // may add or drop the control. Idempotent: it toggles an attribute on the
  // one server-rendered button set and never creates buttons.
  const syncZoomButtons = (mapEl: Element) => {
    const buttons = mapEl.querySelector<HTMLElement>(".ml-map-controls");
    if (!buttons) return;
    const documentZoom = mapEl.querySelector(".maplibregl-ctrl-zoom-in") !== null;
    buttons.toggleAttribute("data-document-zoom", documentZoom);
    // The buttons in the document's language (its `locale:`): a `src`
    // document is only read in the browser, so the server render could not
    // label them. Same keys as the server render.
    const uiString = (mapEl as Partial<MLMap>).uiString?.bind(mapEl);
    if (!uiString) return;
    for (const [action, key] of Object.entries(LABEL_KEYS)) {
      const button = buttons.querySelector<HTMLElement>(`[data-action="${action}"]`);
      if (!button) continue;
      const text = uiString(key);
      button.setAttribute("aria-label", text);
      button.title = text;
    }
  };

  if (firstRun) {
    // The reset target is the view the page opened with, re-captured on
    // every (re)load so reload() or a fallback rebuild resets to the new
    // camera. `ml-map:load` bubbles, so this also sees maps on pages
    // swapped in later.
    document.addEventListener("ml-map:load", (event) => {
      const mapEl = ownMap(event);
      if (!mapEl) return;
      captureHome(mapEl);
      syncZoomButtons(mapEl);
    });

    // A changed document applied in place (core 0.10). The summary says
    // whether the camera moved; it has no flag for the controls block, and
    // the check is two queries on the element, so the buttons are re-synced
    // on every applied update (rebuilds included -- their `ml-map:load`
    // already did it, and doing it twice is harmless).
    document.addEventListener("ml-map:update-applied", (event) => {
      const mapEl = ownMap(event);
      if (!mapEl) return;
      const summary = (event as CustomEvent<{ summary?: UpdateSummary }>).detail?.summary;
      syncZoomButtons(mapEl);
      if (summary?.cameraMoved) captureHomeWhenSettled(mapEl);
    });

    // A `fitTo` on a fetched source frames the map AFTER load, once its data
    // arrives: that framing is the view the page opened with, so it becomes
    // the reset target, not the YAML's center/zoom (ml-aot.60). The fit is
    // applied without animation before the event fires.
    document.addEventListener("ml-map:camera-fit", (event) => {
      const mapEl = ownMap(event);
      if (mapEl) captureHome(mapEl);
    });

    document.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest<HTMLElement>(".ml-map-controls [data-action]");
      const mapEl = button ? mapOf(button) : null;
      const map = mapEl?.getMap();
      if (!button || !mapEl || !map) return;
      switch (button.dataset.action) {
        case "zoom-in":
          map.zoomIn();
          break;
        case "zoom-out":
          map.zoomOut();
          break;
        case "reset": {
          const home = state.homes.get(mapEl);
          if (home) map.flyTo(home);
          break;
        }
      }
    });
  }

  // A map that finished loading before this module ran (possible on a soft
  // navigation into the first page with a FullPageMap) still gets its home.
  for (const mapEl of document.querySelectorAll<MLMap>(".ml-fullpage-map ml-map")) {
    customElements
      .whenDefined("ml-map")
      .then(() => mapEl.mapReady())
      .then(() => {
        if (!state.homes.has(mapEl)) captureHome(mapEl);
        syncZoomButtons(mapEl);
      })
      // A failed document shows <ml-map>'s own error card; nothing to wire.
      .catch(() => {});
  }
}
