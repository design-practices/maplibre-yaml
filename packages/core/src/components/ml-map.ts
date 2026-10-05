/**
 * @file Unified MLMap web component for maplibre-yaml
 * @module @maplibre-yaml/core/components/ml-map
 *
 * @description
 * The `<ml-map>` component is the primary way to embed MapLibre maps configured
 * with YAML. It supports multiple configuration methods to fit any use case.
 *
 * ## Configuration Methods (in priority order)
 *
 * ### 1. External YAML File (Recommended)
 * ```html
 * <ml-map src="/configs/my-map.yaml"></ml-map>
 * ```
 *
 * ### 2. Inline YAML via Script Tag
 * ```html
 * <ml-map>
 *   <script type="text/yaml">
 * type: map
 * id: my-map
 * config:
 *   center: [-74.006, 40.7128]
 *   zoom: 12
 *   mapStyle: "https://demotiles.maplibre.org/style.json"
 * layers: []
 *   </script>
 * </ml-map>
 * ```
 *
 * ### 3. JSON Config Attribute (Programmatic)
 * ```html
 * <ml-map config='{"type":"map",...}'></ml-map>
 * ```
 */

import type { Map as MapLibreMap } from "maplibre-gl";
import {
  YAMLParser,
  type MapBlock,
  type ParseError,
  type ValidationWarning,
} from "../parser/yaml-parser.js";
import { MapRenderer } from "../renderer/map-renderer.js";
import {
  toModel,
  denormalizeConfig,
  denormalizeLayers,
  denormalizeSources,
  denormalizeOptions,
} from "../model/index.js";
import type { MapModel } from "../model/types.js";
import { escapeHtml } from "../utils/html.js";
import {
  getEffectsHost,
  onEffectsHost,
  type EffectBlock,
  type EffectLayerRef,
  type EffectsAttachment,
} from "../effects-host.js";
import type { ChromeMount, MapRendererEvents } from "../renderer/map-renderer.js";
import { CHROME_CORNERS, type ChromeCorner } from "../renderer/chrome-layout.js";

/**
 * Named slots v1 (KTD9): the four chrome corners plus `legend`, which
 * replaces the built-in legend. Light-DOM named containers, not shadow slots
 * — `<ml-map>` has no shadow root; a direct child carrying one of these
 * `slot` values is adopted into the renderer's corner system on load.
 */
export const ML_MAP_SLOTS: readonly string[] = [...CHROME_CORNERS, "legend"];

/**
 * `detail` of `ml-map:error`. Two shapes: a document that failed to load
 * (parse, validation, fetch, or a missing config) carries the structured
 * `errors`; a MapLibre error at runtime carries the `error` and whether it was
 * `fatal` (load-aborting) or not (a 404'd tile, for example).
 */
export type MLMapErrorDetail =
  | { errors: ParseError[]; error?: undefined; fatal?: undefined }
  | { error: Error; fatal: boolean; errors?: undefined };

/**
 * Every event `<ml-map>` dispatches, by name, typed with its `detail`. All of
 * them bubble.
 *
 * @remarks
 * Drives the typed `addEventListener` overloads on {@link MLMap} and the
 * React 19 `onml-map:*` props in `@maplibre-yaml/core/react`. A test pins its
 * keys to the `new CustomEvent("ml-map:…")` calls in this file, so the map
 * cannot drift from what the element actually fires.
 */
export interface MLMapEventMap {
  "ml-map:load": CustomEvent<Record<string, never>>;
  "ml-map:error": CustomEvent<MLMapErrorDetail>;
  "ml-map:loading": CustomEvent<{ url: string }>;
  "ml-map:layer-added": CustomEvent<MapRendererEvents["layer:added"]>;
  "ml-map:layer-removed": CustomEvent<MapRendererEvents["layer:removed"]>;
  "ml-map:layer-data-loading": CustomEvent<MapRendererEvents["layer:data-loading"]>;
  "ml-map:layer-data-loaded": CustomEvent<MapRendererEvents["layer:data-loaded"]>;
  "ml-map:layer-data-error": CustomEvent<MapRendererEvents["layer:data-error"]>;
  "ml-map:layer-click": CustomEvent<MapRendererEvents["layer:click"]>;
  "ml-map:layer-hover": CustomEvent<MapRendererEvents["layer:hover"]>;
  "ml-map:markers-added": CustomEvent<MapRendererEvents["markers:added"]>;
  "ml-map:marker-click": CustomEvent<MapRendererEvents["marker:click"]>;
  "ml-map:marker-icon-error": CustomEvent<MapRendererEvents["marker:icon-error"]>;
  "ml-map:image-error": CustomEvent<MapRendererEvents["image:error"]>;
  "ml-map:parameter-change": CustomEvent<MapRendererEvents["parameter:change"]>;
  "ml-map:layer-visibility": CustomEvent<MapRendererEvents["layer:visibility"]>;
  "ml-map:camera-fit": CustomEvent<MapRendererEvents["camera:fit"]>;
}

/**
 * A serialisation of a config candidate, used to skip re-renders when an
 * equal config is assigned again (ml-i10). `JSON.stringify` is the structural
 * compare: linear in the document's size, which is noise next to rebuilding a
 * WebGL map, and it is exactly the equality the documents themselves have
 * (they are JSON/YAML data). Key order counts, so `{a, b}` and `{b, a}` are
 * "different" and re-render, the safe direction. `null` when the value cannot
 * be serialised (a cycle, a BigInt): such a value never compares equal, so it
 * always renders, as before.
 */
function configKey(value: unknown): string | null {
  try {
    return JSON.stringify(value) ?? null;
  } catch {
    return null;
  }
}

/** Class on the element's own map container — the only child it owns while a map renders. */
const MAP_CONTAINER_CLASS = "ml-map-container";

/**
 * MLMap custom element for rendering MapLibre maps from YAML/JSON configuration.
 *
 * @fires ml-map:load - Map loaded and ready for interaction
 * @fires ml-map:error - Error during initialization or runtime
 * @fires ml-map:loading - Loading configuration from URL
 * @fires ml-map:layer-added - Layer was added to the map
 * @fires ml-map:layer-removed - Layer was removed from the map
 * @fires ml-map:layer-data-loading - Layer data is being fetched
 * @fires ml-map:layer-data-loaded - Layer data loaded successfully
 * @fires ml-map:layer-data-error - Layer data failed to load
 * @fires ml-map:layer-click - User clicked on a layer feature
 * @fires ml-map:layer-hover - User hovered over a layer feature
 * @fires ml-map:markers-added - Standalone `markers:` pins were added
 * @fires ml-map:marker-click - User clicked a standalone marker
 * @fires ml-map:marker-icon-error - A marker icon failed (unsafe scheme or load error); the default pin was substituted
 * @fires ml-map:image-error - A declared `images:` entry failed (unsafe scheme, load or register error)
 * @fires ml-map:parameter-change - A params-panel control wrote a state key
 * @fires ml-map:layer-visibility - A params-panel checkbox toggled a layer
 * @fires ml-map:camera-fit - The `fitTo` camera framed its source's data (detail: source, bounds)
 */
export class MLMap extends HTMLElement {
  /** Internal MapRenderer instance */
  private renderer: MapRenderer | null = null;

  /** Whether the component has been initialized */
  private initialized = false;

  /**
   * Whether the DOCUMENT finished loading — set when the renderer's `load`
   * fires (basemap ready AND every document layer added), not MapLibre's
   * earlier map-`load`. `mapReady()`'s fast path keys on this so it resolves
   * on exactly the condition `ml-map:load` announces.
   */
  private documentLoaded = false;

  /**
   * Terminal document failure, kept so a `mapReady()` call arriving AFTER
   * `ml-map:error` fired rejects instead of waiting forever for events that
   * will never recur. Cleared on every re-render. Runtime maplibre errors
   * (non-fatal — the map still loads) do not land here.
   */
  private lastError: Error | null = null;

  /** Container element for the map */
  private mapContainer: HTMLDivElement | null = null;

  /** Parsed and validated configuration */
  private _config: MapBlock | null = null;

  /**
   * JSON serialisation of the last config handed to the element through the
   * `config` property or attribute and rendered (or rejected). An assignment
   * that serialises identically is a no-op (ml-i10): frameworks reassign the
   * property whenever the bound object's identity changes, and tearing the
   * map down for an equal document would reset the camera on every parent
   * re-render. Cleared whenever the map is rendered from another source.
   */
  private appliedConfigKey: string | null = null;

  /**
   * Cancels the pending "No configuration provided" check (ml-mpm), or
   * `null` when none is pending. See {@link scheduleEmptyConfigCheck}.
   */
  private cancelPendingEmptyCheck: (() => void) | null = null;

  /**
   * The effects attached to the current map (experimental, 0.7), and the
   * subscription waiting for an effects host that registers late. Both are
   * torn down with the renderer, so a reload never leaks a custom layer.
   */
  private effectsAttachment: EffectsAttachment | null = null;
  private effectsWait: (() => void) | null = null;

  /**
   * Whether the one-time dev diagnostics have already run for this element.
   * Repeated `config`/`src` updates and `reload()` re-render the map but must
   * not re-spam the same console warnings.
   */
  private diagnosticsRun = false;

  /**
   * Observed attributes that trigger attributeChangedCallback
   */
  static get observedAttributes(): string[] {
    return ["src", "config"];
  }

  /**
   * Get the current map configuration
   */
  get config(): MapBlock | null {
    return this._config;
  }

  /**
   * Set the map configuration programmatically.
   *
   * @remarks
   * Accepts a `MapBlock` object or its JSON string; both are validated like
   * every other config path, whether assigned before or after the element
   * connects. Assigning a value that is JSON-equal to the config currently
   * applied is a no-op, so a framework re-binding an equal object does not
   * rebuild the map. Assigning `null` clears the stored config without
   * touching a rendered map.
   */
  set config(value: MapBlock | string | null) {
    if (value === null) {
      this._config = null;
      this.appliedConfigKey = null;
      return;
    }

    let parsed: unknown;

    if (typeof value === "string") {
      try {
        parsed = JSON.parse(value);
      } catch (e) {
        this.cancelEmptyConfigCheck();
        this.appliedConfigKey = null;
        this.handleError([
          { path: "", message: "Invalid JSON in config property" },
        ]);
        return;
      }
    } else {
      parsed = value;
    }

    // Before connect: store the candidate; initialize() validates it.
    if (!this.initialized) {
      this._config = parsed as MapBlock;
      return;
    }

    this.cancelEmptyConfigCheck();
    const key = configKey(parsed);
    if (key !== null && key === this.appliedConfigKey) return;

    this._config = parsed as MapBlock;
    this.applyValidatedConfig(parsed, key);
  }

  /**
   * Validate a config object, then render it or show the error card.
   *
   * @remarks
   * The shared tail for the non-YAML entry points, so a JSON attribute and a
   * programmatic assignment get the same errors, unknown-key suggestions and
   * deprecation warnings the YAML paths have always produced.
   */
  private applyValidatedConfig(
    candidate: unknown,
    key: string | null = configKey(candidate)
  ): void {
    this.appliedConfigKey = key;
    const result = YAMLParser.safeParseMapBlockValue(candidate);

    // Advisory, never in the error card (decision D11) — same as YAML.
    this.logWarnings(result.warnings);

    if (result.success && result.data) {
      this._config = result.data;
      this.renderMap(result.data);
    } else {
      this.handleError(result.errors);
    }
  }

  /**
   * Called when the element is added to the DOM
   */
  connectedCallback(): void {
    // A `config` assigned while the tag was still undefined (before the
    // element class was registered) is an own data property that shadows the
    // accessor and would be silently ignored. Re-route it through the setter
    // (the standard custom-element `_upgradeProperty` pattern).
    this.upgradeProperty("config");

    // Create internal map container
    this.mapContainer = this.createMapContainer();

    // Ensure the component has display: block (custom elements default to inline)
    if (!this.style.display || this.style.display === "inline") {
      this.style.display = "block";
    }

    // Initialize configuration loading
    this.initialize();
  }

  /**
   * Re-apply an own property set on the element before it was upgraded, so
   * it reaches the class accessor instead of shadowing it.
   */
  private upgradeProperty(name: "config"): void {
    if (Object.prototype.hasOwnProperty.call(this, name)) {
      const self = this as unknown as Record<string, unknown>;
      const value = self[name];
      delete self[name];
      self[name] = value;
    }
  }

  /**
   * Called when the element is removed from the DOM
   */
  disconnectedCallback(): void {
    this.destroy();
  }

  /**
   * Called when an observed attribute changes
   */
  attributeChangedCallback(
    name: string,
    oldValue: string | null,
    newValue: string | null
  ): void {
    // Skip if value hasn't actually changed
    if (oldValue === newValue) return;

    // Only process changes after initialization
    if (!this.initialized) return;

    if (name === "src" && newValue) {
      this.loadFromURL(newValue);
    } else if (name === "config" && newValue) {
      this.loadFromJSONAttribute(newValue);
    }
  }

  /**
   * Initialize the component by detecting and loading configuration
   */
  private async initialize(): Promise<void> {
    this.initialized = true;

    // Priority 1: Programmatically set config property. Frameworks that set
    // properties at creation (React 19, Vue, Svelte) land here, so it is
    // validated and defaulted exactly like the attribute and YAML paths
    // (ml-jh6), never handed to the renderer raw.
    if (this._config) {
      this.applyValidatedConfig(this._config);
      return;
    }

    // Priority 2: Script tag with YAML
    const yamlScript = this.querySelector('script[type="text/yaml"]');
    if (yamlScript?.textContent) {
      this.loadFromScriptTag(yamlScript.textContent);
      return;
    }

    // Priority 3: External YAML file
    const srcAttr = this.getAttribute("src");
    if (srcAttr) {
      await this.loadFromURL(srcAttr);
      return;
    }

    // Priority 4: JSON config attribute
    const configAttr = this.getAttribute("config");
    if (configAttr) {
      this.loadFromJSONAttribute(configAttr);
      return;
    }

    // No configuration yet. A `config` property may still be on its way
    // (ml-mpm); the setter cancels the check. A mapReady() called meanwhile
    // simply waits.
    this.scheduleEmptyConfigCheck();
  }

  /**
   * Report "No configuration provided" only if no config arrived by the end
   * of the next frame.
   *
   * @remarks
   * An element can connect empty and receive `.config` moments later: a
   * module script assigns it right after importing `register` (which upgrades
   * the element synchronously), and React 18 can only assign it from an
   * effect, which runs after the browser paints. A plain `setTimeout(0)`
   * loses that race in practice (measured: the effect landed after it), so
   * the check waits for the next animation frame and then one more task. A
   * background tab runs no frames, so a 500 ms timer bounds the wait there.
   */
  private scheduleEmptyConfigCheck(): void {
    this.cancelEmptyConfigCheck();

    const run = () => {
      this.cancelEmptyConfigCheck();
      if (!this.initialized || this._config || this.renderer) return;
      this.handleError(
        [
          {
            path: "",
            message: "No configuration provided.",
          },
        ],
        true
      );
    };

    let frame: number | undefined;
    let afterFrame: ReturnType<typeof setTimeout> | undefined;
    let fallback: ReturnType<typeof setTimeout> | undefined;
    if (typeof requestAnimationFrame === "function") {
      frame = requestAnimationFrame(() => {
        afterFrame = setTimeout(run, 0);
      });
      fallback = setTimeout(run, 500);
    } else {
      afterFrame = setTimeout(run, 0);
    }

    this.cancelPendingEmptyCheck = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      clearTimeout(afterFrame);
      clearTimeout(fallback);
      this.cancelPendingEmptyCheck = null;
    };
  }

  private cancelEmptyConfigCheck(): void {
    this.cancelPendingEmptyCheck?.();
  }

  /**
   * Load and parse YAML from a script tag's text content
   */
  private loadFromScriptTag(yamlContent: string): void {
    this.cancelEmptyConfigCheck();
    this.appliedConfigKey = null;
    const result = YAMLParser.safeParseMapBlock(yamlContent);

    // Warnings are advisory (unknown keys, deprecations, expression hints):
    // surface them on the console, never in the error card (per decision D11).
    this.logWarnings(result.warnings);

    if (result.success && result.data) {
      this._config = result.data;
      this.renderMap(result.data);
    } else {
      this.handleError(result.errors);
    }
  }

  /**
   * Load and parse YAML from an external URL
   */
  private async loadFromURL(url: string): Promise<void> {
    this.cancelEmptyConfigCheck();
    this.appliedConfigKey = null;

    // Emit loading event
    this.dispatchEvent(
      new CustomEvent("ml-map:loading", {
        bubbles: true,
        detail: { url },
      })
    );

    try {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(
          `Failed to fetch ${url}: ${response.status} ${response.statusText}`
        );
      }

      const yamlContent = await response.text();
      const result = YAMLParser.safeParseMapBlock(yamlContent);

      this.logWarnings(result.warnings);

      if (result.success && result.data) {
        this._config = result.data;
        this.renderMap(result.data);
      } else {
        this.handleError(result.errors);
      }
    } catch (error) {
      this.handleError([
        {
          path: "",
          message: error instanceof Error ? error.message : String(error),
        },
      ]);
    }
  }

  /**
   * Parse and validate JSON from the config attribute
   */
  private loadFromJSONAttribute(jsonString: string): void {
    this.cancelEmptyConfigCheck();
    try {
      const parsed = JSON.parse(jsonString);
      // Validated like the YAML paths. Well-formed JSON that fails the schema
      // used to go straight to the renderer, producing a broken map with no
      // diagnostic — the same "accepted but does not work" shape this release
      // is closing, on the entry path least likely to be noticed.
      this.applyValidatedConfig(parsed);
    } catch (error) {
      this.handleError([
        {
          path: "",
          message: `Invalid JSON in config attribute: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      ]);
    }
  }

  /**
   * Render the map with the given configuration
   */
  private renderMap(mapBlock: MapBlock): void {
    // Standalone <ml-map> has no global config to inherit defaultMapStyle from,
    // so a missing basemap would die inside MapLibre with an opaque error.
    // Surface a friendly error card instead. (Schema keeps it optional because
    // the Astro builders legitimately resolve it from globalConfig.) The base
    // style is `config.mapStyle` in v1 and `style.basemap` in v2, so the guard
    // reads whichever the document's version puts it under.
    const isV2 = (mapBlock as { version?: number }).version === 2;
    const basemap = isV2
      ? (mapBlock as unknown as { style?: { basemap?: unknown } }).style?.basemap
      : mapBlock.config?.mapStyle;
    if (!basemap) {
      const path = isV2 ? "style.basemap" : "config.mapStyle";
      const key = isV2 ? "basemap" : "mapStyle";
      const where = isV2 ? "your style:" : "your config";
      this.handleError([
        {
          path,
          message:
            `${key} is required for standalone maps. Add it to ${where}, for example: ` +
            `${key}: "https://demotiles.maplibre.org/style.json" ` +
            "(inheriting a defaultMapStyle is a feature of the Astro builders, not the standalone <ml-map> element).",
        },
      ]);
      return;
    }

    // Destroy existing renderer (slot children parked first — the renderer
    // only borrows them, and its teardown removes their corner containers).
    this.teardownRenderer();

    // A fresh render resets the readiness state a pending or future
    // mapReady() reads.
    this.documentLoaded = false;
    this.lastError = null;

    // Targeted teardown (KTD9): remove only what this element owns — a
    // previous error card — never author children (the inline YAML script a
    // later reload() re-reads, slot children, anything else).
    this.removeErrorCards();

    if (!this.mapContainer) {
      this.mapContainer = this.createMapContainer();
    }

    this.appendChild(this.mapContainer);
    const slots = this.collectSlots();

    try {
      // Normalize the v1 document into the v2 internal model, then render from
      // it. The model is what the emitter is written against (R30); routing the
      // production path through it here is what proves the normalization loses
      // nothing — every component and renderer test now exercises the round
      // trip, so a dropped or invented key fails the suite rather than shipping.
      const model = toModel(mapBlock as never);

      this.renderer = new MapRenderer(
        this.mapContainer,
        denormalizeConfig(model),
        denormalizeLayers(model),
        {
          ...denormalizeOptions(model),
          chrome: slots.chrome,
          legendElement: slots.legendElement,
        onLoad: () => {
          // Load event is also emitted via the event system
        },
        onError: (error, fatal) => {
          // Loud by default: with no `ml-map:error` listener attached, a
          // dispatched event is invisible and the document fails silently
          // (ml-tfd.8 contract audit). Hosts still get the event.
          console.error("[maplibre-yaml] map error:", error);
          // Only load-aborting failures are terminal for mapReady();
          // runtime maplibre errors (a 404'd tile) precede a successful
          // load all the time and must not poison readiness.
          if (fatal !== false) this.lastError = error;
          this.dispatchEvent(
            new CustomEvent("ml-map:error", {
              bubbles: true,
              detail: { error, fatal: fatal !== false },
            })
          );
        },
        },
        denormalizeSources(model)
      );

      // Set up event forwarding
      this.setupEventForwarding();

      // Experimental effects (`effect:` layers) attach once the map loads.
      this.setupEffects(model);

      // Surface the classic silent-blank-map failure modes on the console.
      this.checkEnvironment();
    } catch (error) {
      this.handleError([
        {
          path: "",
          message: `Failed to create map: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      ]);
    }
  }

  /**
   * Log parser warnings to the console.
   *
   * @remarks
   * Warnings (unknown keys, deprecated fields, expression hints) are advisory
   * and console-only per decision D11 — they never appear in the on-map error
   * card, which is reserved for hard failures.
   */
  private logWarnings(warnings: ValidationWarning[] | undefined): void {
    if (!warnings || warnings.length === 0) return;
    for (const warning of warnings) {
      const location =
        warning.line !== undefined
          ? ` (line ${warning.line}${
              warning.column !== undefined ? `, column ${warning.column}` : ""
            })`
          : "";
      const path = warning.path ? `${warning.path}: ` : "";
      console.warn(`[ml-map] ${path}${warning.message}${location}`);
    }
  }

  /**
   * Detect the two classic silent-blank-map failures and warn (console-only,
   * no on-map badge per decision D11):
   *
   * 1. The host element has zero height, so the map is invisible.
   * 2. A map was created but MapLibre's CSS is not loaded.
   */
  private checkEnvironment(): void {
    if (typeof window === "undefined") return;

    // Run at most once per element: re-renders (config/src updates, reload())
    // must not re-emit identical warnings.
    if (this.diagnosticsRun) return;
    this.diagnosticsRun = true;

    // (a) Zero-height host: the single most common "blank map" cause. Only
    // flag it when the element is actually laid out and visible — a hidden or
    // not-yet-mounted map (`offsetParent === null`, e.g. an ancestor is
    // `display: none`) legitimately has zero height and must not warn.
    const isLaidOut = this.offsetParent !== null;
    const rect = this.getBoundingClientRect();
    if (isLaidOut && rect.height === 0) {
      console.warn(
        "[ml-map] The <ml-map> host element has zero height, so the map will " +
          "not be visible. Give it a height, for example: `ml-map { height: 400px; }`."
      );
    }

    // (b) A map was created but MapLibre's stylesheet is missing.
    if (this.renderer && !MLMap.isMapLibreCssLoaded()) {
      console.warn(
        "[ml-map] MapLibre GL CSS does not appear to be loaded, so the map " +
          "canvas and controls may render incorrectly. Load it, for example: " +
          '`<link rel="stylesheet" href="https://unpkg.com/maplibre-gl/dist/maplibre-gl.css">`.'
      );
    }
  }

  /**
   * Probe whether MapLibre's CSS is loaded.
   *
   * @remarks
   * Two signatures, either one counts. maplibre-gl up to 4.x paints a
   * `.maplibregl-canary` salmon (`rgb(250, 128, 114)`), the check MapLibre
   * itself used. 5.x dropped the canary rule, so the probe also carries the
   * `.maplibregl-map` class, which every version's stylesheet makes
   * `position: relative; overflow: hidden`. Checking only the canary warned
   * "CSS not loaded" on every maplibre-gl 5 page, CSS or not.
   */
  private static isMapLibreCssLoaded(): boolean {
    try {
      const probe = document.createElement("div");
      probe.className = "maplibregl-canary maplibregl-map";
      probe.style.display = "none";
      document.body.appendChild(probe);
      const style = window.getComputedStyle(probe);
      const loaded =
        style.backgroundColor === "rgb(250, 128, 114)" ||
        (style.position === "relative" && style.overflow === "hidden");
      document.body.removeChild(probe);
      return loaded;
    } catch {
      // If we cannot probe (unusual DOM), do not nag.
      return true;
    }
  }

  /**
   * Forward MapRenderer events to custom element events
   */
  private setupEventForwarding(): void {
    if (!this.renderer) return;

    // Map load event — the renderer emits this after the basemap is ready
    // AND every document layer was added, so it is the document-level
    // readiness signal mapReady()'s fast path keys on.
    this.renderer.on("load", () => {
      this.documentLoaded = true;
      this.dispatchEvent(
        new CustomEvent("ml-map:load", {
          bubbles: true,
          detail: {},
        })
      );
    });

    // Layer added
    this.renderer.on("layer:added", ({ layerId }) => {
      this.dispatchEvent(
        new CustomEvent("ml-map:layer-added", {
          bubbles: true,
          detail: { layerId },
        })
      );
    });

    // Layer removed
    this.renderer.on("layer:removed", ({ layerId }) => {
      this.dispatchEvent(
        new CustomEvent("ml-map:layer-removed", {
          bubbles: true,
          detail: { layerId },
        })
      );
    });

    // Layer data loading
    this.renderer.on("layer:data-loading", ({ layerId }) => {
      this.dispatchEvent(
        new CustomEvent("ml-map:layer-data-loading", {
          bubbles: true,
          detail: { layerId },
        })
      );
    });

    // Layer data loaded
    this.renderer.on("layer:data-loaded", ({ layerId, featureCount }) => {
      this.dispatchEvent(
        new CustomEvent("ml-map:layer-data-loaded", {
          bubbles: true,
          detail: { layerId, featureCount },
        })
      );
    });

    // Layer data error
    this.renderer.on("layer:data-error", ({ layerId, error }) => {
      this.dispatchEvent(
        new CustomEvent("ml-map:layer-data-error", {
          bubbles: true,
          detail: { layerId, error },
        })
      );
    });

    // Layer click
    this.renderer.on("layer:click", ({ layerId, feature, lngLat }) => {
      this.dispatchEvent(
        new CustomEvent("ml-map:layer-click", {
          bubbles: true,
          detail: { layerId, feature, lngLat },
        })
      );
    });

    // Layer hover
    this.renderer.on("layer:hover", ({ layerId, feature, lngLat }) => {
      this.dispatchEvent(
        new CustomEvent("ml-map:layer-hover", {
          bubbles: true,
          detail: { layerId, feature, lngLat },
        })
      );
    });

    // Standalone markers (U5): added / clicked / icon fell back to the pin
    this.renderer.on("markers:added", ({ count }) => {
      this.dispatchEvent(
        new CustomEvent("ml-map:markers-added", {
          bubbles: true,
          detail: { count },
        })
      );
    });
    this.renderer.on("marker:click", ({ index, at }) => {
      this.dispatchEvent(
        new CustomEvent("ml-map:marker-click", {
          bubbles: true,
          detail: { index, at },
        })
      );
    });
    this.renderer.on("marker:icon-error", ({ index, icon }) => {
      this.dispatchEvent(
        new CustomEvent("ml-map:marker-icon-error", {
          bubbles: true,
          detail: { index, icon },
        })
      );
    });

    // fitTo (U14): the initial camera framed its source's data
    this.renderer.on("camera:fit", ({ source, bounds }) => {
      this.dispatchEvent(
        new CustomEvent("ml-map:camera-fit", {
          bubbles: true,
          detail: { source, bounds },
        })
      );
    });

    // Declared images (U6): a failed entry — the document keeps rendering
    this.renderer.on("image:error", ({ name, url }) => {
      this.dispatchEvent(
        new CustomEvent("ml-map:image-error", {
          bubbles: true,
          detail: { name, url },
        })
      );
    });

    // Params panel (U8): control writes, observable like every other action
    this.renderer.on("parameter:change", ({ key, value }) => {
      this.dispatchEvent(
        new CustomEvent("ml-map:parameter-change", {
          bubbles: true,
          detail: { key, value },
        })
      );
    });
    this.renderer.on("layer:visibility", ({ layerId, visible }) => {
      this.dispatchEvent(
        new CustomEvent("ml-map:layer-visibility", {
          bubbles: true,
          detail: { layerId, visible },
        })
      );
    });
  }

  /**
   * Handle and display errors
   */
  private createMapContainer(): HTMLDivElement {
    const el = document.createElement("div");
    el.className = MAP_CONTAINER_CLASS;
    el.style.cssText = "width: 100%; height: 100%;";
    return el;
  }

  /**
   * The direct children carrying a v1 slot name, split into corner mounts
   * and the legend override. Parked slot children are direct children again,
   * so every render (including `reload()`) re-collects them — and picks up
   * slot children added since the last render.
   */
  private collectSlots(): { chrome: ChromeMount[]; legendElement?: HTMLElement } {
    const chrome: ChromeMount[] = [];
    let legendElement: HTMLElement | undefined;
    for (const child of Array.from(this.children)) {
      if (!(child instanceof HTMLElement)) continue;
      const name = child.getAttribute("slot");
      if (name === null) continue;
      if (name === "legend") {
        if (legendElement) {
          console.warn(
            '[ml-map] more than one slot="legend" child; only the first replaces the legend.'
          );
          continue;
        }
        legendElement = child;
      } else if ((CHROME_CORNERS as readonly string[]).includes(name)) {
        chrome.push({ position: name as ChromeCorner, element: child });
      } else {
        console.warn(
          `[ml-map] unknown slot "${name}" — expected one of: ${ML_MAP_SLOTS.join(", ")}. ` +
            "The child is left where it is."
        );
      }
    }
    return { chrome, legendElement };
  }

  /**
   * Move slot children the renderer borrowed back onto this element (where
   * the stylesheet hides them until the next mount), so tearing the map down
   * — re-render, error card, disconnect — never destroys author markup.
   */
  private parkSlots(): void {
    for (const el of Array.from(
      this.querySelectorAll<HTMLElement>(`.${MAP_CONTAINER_CLASS} [slot]`)
    )) {
      if (ML_MAP_SLOTS.includes(el.getAttribute("slot") ?? "")) {
        this.appendChild(el);
      }
    }
  }

  /** Park slot children, then destroy the renderer (if any). */
  /**
   * Every path that drops the map — re-render, error card, disconnect —
   * comes through here: effects detach first (they live on the renderer's
   * map), then slot children are parked (the renderer only borrows them),
   * then the renderer is destroyed.
   */
  private teardownRenderer(): void {
    this.teardownEffects();
    this.parkSlots();
    if (this.renderer) {
      this.renderer.destroy();
      this.renderer = null;
    }
  }

  private removeErrorCards(): void {
    for (const el of Array.from(this.children)) {
      if (el.classList.contains("ml-map-error")) el.remove();
    }
  }

  private handleError(errors: ParseError[], showHelp = false): void {
    // Persist the failure so a mapReady() call arriving after this event
    // rejects with the structured errors instead of waiting forever.
    this.lastError = Object.assign(
      new Error(
        `[ml-map] ${errors
          .map((e) => (e.path ? `${e.path}: ${e.message}` : e.message))
          .join("; ")}`
      ),
      { errors }
    );

    // Dispatch error event
    this.dispatchEvent(
      new CustomEvent("ml-map:error", {
        bubbles: true,
        detail: { errors },
      })
    );

    // Build error UI
    const helpSection = showHelp
      ? `
        <div style="margin-top: 16px; padding: 16px; background: #fef3c7; border-radius: 6px; color: #92400e;">
          <strong style="display: block; margin-bottom: 8px;">How to configure:</strong>
          <div style="font-family: monospace; font-size: 12px; line-height: 1.6;">
            <div style="margin-bottom: 8px;">
              <strong>1. External file (recommended):</strong><br>
              &lt;ml-map src="/path/to/config.yaml"&gt;&lt;/ml-map&gt;
            </div>
            <div style="margin-bottom: 8px;">
              <strong>2. Inline YAML:</strong><br>
              &lt;ml-map&gt;<br>
              &nbsp;&nbsp;&lt;script type="text/yaml"&gt;<br>
              &nbsp;&nbsp;type: map<br>
              &nbsp;&nbsp;id: my-map<br>
              &nbsp;&nbsp;...<br>
              &nbsp;&nbsp;&lt;/script&gt;<br>
              &lt;/ml-map&gt;
            </div>
            <div>
              <strong>3. JSON attribute:</strong><br>
              &lt;ml-map config='{"type":"map",...}'&gt;&lt;/ml-map&gt;
            </div>
          </div>
        </div>
      `
      : "";

    const errorItems = errors
      .map(
        (err) => `
          <div style="margin-bottom: 8px; padding: 8px; background: #fee2e2; border-radius: 4px;">
            ${
              err.path
                ? `<strong style="color: #991b1b;">${escapeHtml(
                    err.path
                  )}</strong>: `
                : ""
            }
            ${escapeHtml(err.message)}
          </div>
        `
      )
      .join("");

    // Targeted replacement (KTD9): the error card takes the map container's
    // place; author children (inline YAML, parked slot children) survive so
    // a fixed document can reload() into the same element.
    this.teardownRenderer();
    this.removeErrorCards();
    this.mapContainer?.remove();

    const template = document.createElement("template");
    template.innerHTML = `
      <div class="ml-map-error" style="
        padding: 20px;
        background: #fef2f2;
        border: 1px solid #fecaca;
        border-radius: 8px;
        color: #dc2626;
        font-family: system-ui, -apple-system, sans-serif;
        height: 100%;
        box-sizing: border-box;
        overflow: auto;
      ">
        <div style="font-weight: 600; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
          </svg>
          Configuration Error
        </div>
        <div style="font-size: 14px;">
          ${errorItems}
        </div>
        ${helpSection}
      </div>
    `;
    const card = template.content.firstElementChild;
    if (card) this.appendChild(card);
  }


  /**
   * Attach the document's experimental effects once the map has loaded.
   *
   * @remarks
   * Core never imports `@maplibre-yaml/effects`: the package registers an
   * effects host (see `effects-host.ts`) and this reads it. A document
   * without `effect:` layers returns immediately — no host lookup, no
   * listener. When the host registers after the map loads (a dynamic
   * import), the effects attach then; without a host at all the layers
   * stay static and say so once.
   */
  private setupEffects(model: MapModel): void {
    const refs: EffectLayerRef[] = [];
    for (const layer of model.style.layers) {
      const effect = layer.runtime["effect"];
      const id = layer.spec["id"];
      if (effect && typeof effect === "object" && typeof id === "string") {
        refs.push({ layerId: id, effect: effect as EffectBlock });
      }
    }
    if (refs.length === 0 || !this.renderer) return;

    const renderer = this.renderer;
    const attach = () => {
      if (this.renderer !== renderer || this.effectsAttachment) return;
      const map = renderer.getMap();
      const host = getEffectsHost();
      if (!map || !host) return;
      try {
        this.effectsAttachment = host.attach(map, refs);
      } catch (error) {
        // A host must declare absence rather than throw; if one throws
        // anyway, the static layers are still on the map — say so, don't
        // kill the document.
        console.error("[maplibre-yaml] effects failed to attach:", error);
      }
    };

    renderer.on("load", () => {
      if (getEffectsHost()) {
        attach();
        return;
      }
      console.warn(
        `[maplibre-yaml] ${refs.length} layer(s) declare an effect ` +
          `(${[...new Set(refs.map((r) => r.effect.type))].join(", ")}) but ` +
          "@maplibre-yaml/effects is not loaded — they render as their static " +
          'fallback. Import "@maplibre-yaml/effects/register" to enable them.'
      );
      this.effectsWait = onEffectsHost(() => {
        this.effectsWait = null;
        attach();
      });
    });
  }

  /** Detach effects and drop any pending host subscription. */
  private teardownEffects(): void {
    this.effectsWait?.();
    this.effectsWait = null;
    const attachment = this.effectsAttachment;
    this.effectsAttachment = null;
    if (attachment) {
      try {
        attachment.detach();
      } catch (error) {
        console.warn("[maplibre-yaml] effects failed to detach cleanly:", error);
      }
    }
  }

  /**
   * Clean up resources when component is removed
   */
  private destroy(): void {
    this.cancelEmptyConfigCheck();
    this.teardownRenderer();
    this.appliedConfigKey = null;
    this._config = null;
    this.initialized = false;
  }

  // ============================================================
  // Public API
  // ============================================================

  /**
   * Get the underlying MapLibre GL map instance
   *
   * @returns The MapLibre GL map instance, or null if not initialized
   *
   * @see {@link MLMap.mapReady} — the promise form; resolves once loaded and
   * removes the need for the load-listener + null-guard shown below.
   *
   * @example
   * ```javascript
   * const mapEl = document.querySelector('ml-map');
   *
   * mapEl.addEventListener('ml-map:load', () => {
   *   const map = mapEl.getMap();
   *   map.flyTo({ center: [-122.4, 37.8], zoom: 14 });
   * });
   * ```
   */
  getMap(): MapLibreMap | null {
    return this.renderer?.getMap() ?? null;
  }

  /**
   * Resolve with the underlying MapLibre map once the document has loaded.
   *
   * @remarks
   * The readiness idiom (R3): replaces the `ml-map:load` listener +
   * `getMap()` null-guard boilerplate every escape-hatch snippet needed.
   * Resolves immediately when the map is already loaded; otherwise resolves
   * on the next `ml-map:load` and rejects on `ml-map:error` (config parse
   * failure, renderer construction failure, or a runtime map error).
   *
   * @example
   * ```javascript
   * const map = await document.querySelector('ml-map').mapReady();
   * map.flyTo({ center: [-122.4, 37.8], zoom: 14 });
   * ```
   */
  mapReady(): Promise<MapLibreMap> {
    // Fast paths mirror the event contract exactly: resolve on the same
    // condition ml-map:load announces (document loaded — basemap AND every
    // layer), reject when a terminal failure already fired (its ml-map:error
    // will never recur for a late subscriber).
    if (this.documentLoaded) {
      const map = this.getMap();
      if (map) return Promise.resolve(map);
    }
    if (this.lastError) return Promise.reject(this.lastError);

    return new Promise<MapLibreMap>((resolve, reject) => {
      const onLoad = () => {
        cleanup();
        const map = this.getMap();
        if (map) resolve(map);
        else reject(new Error("[ml-map] loaded without a map instance"));
      };
      const onError = (event: Event) => {
        const detail = (event as CustomEvent).detail;
        // Non-fatal runtime errors (a 404'd tile before load) don't decide
        // readiness — the map still loads after them. Keep waiting.
        if (detail?.fatal === false) return;
        cleanup();
        if (detail?.error instanceof Error) {
          reject(detail.error);
        } else if (Array.isArray(detail?.errors)) {
          // handleError's shape: structured ParseError[] — keep it readable
          // and attach the array for programmatic consumers.
          reject(
            Object.assign(
              new Error(
                `[ml-map] ${detail.errors
                  .map((e: { path?: string; message: string }) =>
                    e.path ? `${e.path}: ${e.message}` : e.message
                  )
                  .join("; ")}`
              ),
              { errors: detail.errors }
            )
          );
        } else {
          reject(new Error(`[ml-map] failed to load: ${JSON.stringify(detail ?? {})}`));
        }
      };
      const cleanup = () => {
        this.removeEventListener("ml-map:load", onLoad);
        this.removeEventListener("ml-map:error", onError);
      };
      this.addEventListener("ml-map:load", onLoad);
      this.addEventListener("ml-map:error", onError);
    });
  }

  /**
   * Get the MapRenderer instance
   *
   * @returns The MapRenderer instance, or null if not initialized
   */
  getRenderer(): MapRenderer | null {
    return this.renderer;
  }

  /**
   * Check if the map is loaded
   *
   * @returns True if the map has finished loading
   */
  isLoaded(): boolean {
    return this.renderer?.isMapLoaded() ?? false;
  }

  /**
   * Add a layer to the map
   *
   * @param layer - Layer configuration object
   * @returns Promise that resolves when the layer is added
   *
   * @example
   * ```javascript
   * await mapEl.addLayer({
   *   id: 'new-layer',
   *   type: 'circle',
   *   source: {
   *     type: 'geojson',
   *     data: { type: 'FeatureCollection', features: [] }
   *   },
   *   paint: { 'circle-radius': 6, 'circle-color': '#ff0000' }
   * });
   * ```
   */
  async addLayer(layer: any): Promise<void> {
    await this.renderer?.addLayer(layer);
  }

  /**
   * Remove a layer from the map
   *
   * @param layerId - ID of the layer to remove
   */
  removeLayer(layerId: string): void {
    this.renderer?.removeLayer(layerId);
  }

  /**
   * Set layer visibility
   *
   * @param layerId - ID of the layer
   * @param visible - Whether the layer should be visible
   */
  setLayerVisibility(layerId: string, visible: boolean): void {
    this.renderer?.setLayerVisibility(layerId, visible);
  }

  /**
   * Update layer data
   *
   * @param layerId - ID of the layer
   * @param data - New GeoJSON data
   */
  updateLayerData(layerId: string, data: GeoJSON.GeoJSON): void {
    this.renderer?.updateLayerData(layerId, data);
  }

  /**
   * Reload configuration from the current source
   *
   * @returns Promise that resolves when reload is complete
   */
  async reload(): Promise<void> {
    const src = this.getAttribute("src");

    if (src) {
      await this.loadFromURL(src);
    } else {
      const yamlScript = this.querySelector('script[type="text/yaml"]');
      if (yamlScript?.textContent) {
        this.loadFromScriptTag(yamlScript.textContent);
      }
    }
  }
}

/**
 * Typed listener overloads: `el.addEventListener("ml-map:layer-click", (e) =>
 * e.detail.layerId)` type-checks without a cast. Declaration merging adds
 * overloads only; there is no runtime code.
 */
export interface MLMap {
  addEventListener<K extends keyof MLMapEventMap>(
    type: K,
    listener: (this: MLMap, event: MLMapEventMap[K]) => unknown,
    options?: boolean | AddEventListenerOptions
  ): void;
  addEventListener<K extends keyof HTMLElementEventMap>(
    type: K,
    listener: (this: MLMap, event: HTMLElementEventMap[K]) => unknown,
    options?: boolean | AddEventListenerOptions
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void;
  removeEventListener<K extends keyof MLMapEventMap>(
    type: K,
    listener: (this: MLMap, event: MLMapEventMap[K]) => unknown,
    options?: boolean | EventListenerOptions
  ): void;
  removeEventListener<K extends keyof HTMLElementEventMap>(
    type: K,
    listener: (this: MLMap, event: HTMLElementEventMap[K]) => unknown,
    options?: boolean | EventListenerOptions
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions
  ): void;
}

declare global {
  /**
   * Types `document.querySelector("ml-map")` and
   * `document.createElement("ml-map")` as {@link MLMap}, so `mapReady()` /
   * `getMap()` type-check without a cast.
   */
  interface HTMLElementTagNameMap {
    "ml-map": MLMap;
  }
}

/**
 * Register the ml-map custom element
 */
export function registerMLMap(): void {
  if (typeof window !== "undefined" && !customElements.get("ml-map")) {
    customElements.define("ml-map", MLMap);
  }
}
