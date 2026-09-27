/**
 * @file Params/toggle panel — the first reader of `parameters:` (U8, R11)
 * @module @maplibre-yaml/core/renderer
 *
 * @description
 * Renders a control panel from `parameters:` presentation metadata joined
 * with `state:` defaults (the value lives in `state:`, by design — the
 * metadata carries no `default`), plus visibility checkboxes for layers the
 * author labeled. Control writes go through callbacks, so this module stays
 * DOM-pure and testable: the renderer wires them to
 * `map.setGlobalStateProperty` and `LayerManager.setVisibility`.
 *
 * Honored `type` vocabulary v1: `range`, `select` (alias `enum`, options
 * from `values`), `toggle`. Absent types are inferred conservatively —
 * `values` present → select, boolean default → toggle — and anything else
 * degrades to a labeled read-only row rather than a dead control.
 *
 * Layer toggles list layers with an authored `label:` whose `toggleable` is
 * not `false`. The label gate is deliberate: `toggleable` defaults to true
 * on every layer, so "all toggleable layers" would put chrome on every map
 * ever written — an authored display label is the document saying "this
 * layer is user-facing".
 *
 * Below the state runtime floor (maplibre-gl < 5.6, no
 * `setGlobalStateProperty`) the parameter controls degrade to one
 * declared-absence notice instead of dead inputs; layer toggles use plain
 * layout visibility and keep working on every supported runtime.
 */

/** One `parameters:` entry's presentation metadata (schema-validated). */
export interface ParameterMeta {
  label?: string;
  type?: string;
  values?: unknown[];
  min?: number;
  max?: number;
  step?: number;
  [key: string]: unknown;
}

/** One layer the panel offers a visibility checkbox for. */
export interface ToggleableLayer {
  id: string;
  label: string;
  visible: boolean;
}

export interface ParamsPanelConfig {
  /** `parameters:` metadata, keyed by state key. */
  parameters?: Record<string, ParameterMeta>;
  /** `state:` block — `{ key: { default } }`; supplies each control's value. */
  state?: Record<string, unknown>;
  /** Labeled, toggleable layers, in document order. */
  toggleableLayers?: ToggleableLayer[];
  /**
   * Whether the runtime supports `setGlobalStateProperty` (≥ 5.6). False
   * renders the declared-absence notice in place of parameter controls.
   */
  stateSupported: boolean;
}

export interface ParamsPanelCallbacks {
  onStateChange?: (key: string, value: unknown) => void;
  onToggleLayer?: (layerId: string, visible: boolean) => void;
}

/** True when the config yields any panel content at all. */
export function hasPanelContent(config: ParamsPanelConfig): boolean {
  return (
    Object.keys(config.parameters ?? {}).length > 0 ||
    (config.toggleableLayers ?? []).length > 0
  );
}

export class ParamsBuilder {
  /** Build the panel into `container`. No content → container left empty. */
  build(
    container: HTMLElement,
    config: ParamsPanelConfig,
    callbacks: ParamsPanelCallbacks = {}
  ): void {
    if (!hasPanelContent(config)) return;

    const panel = document.createElement("div");
    panel.className = "ml-map-params";
    panel.style.cssText =
      "background:rgba(255,255,255,0.95);border-radius:4px;" +
      "box-shadow:0 1px 4px rgba(0,0,0,0.3);padding:10px 12px;" +
      "font:12px/1.5 system-ui,sans-serif;color:#333;min-width:160px;";

    const parameters = Object.entries(config.parameters ?? {});
    if (parameters.length > 0 && !config.stateSupported) {
      // Declared absence, not dead controls: the document asked for
      // parameter controls the runtime cannot drive.
      const notice = document.createElement("div");
      notice.className = "ml-map-params-notice";
      notice.textContent =
        "Parameter controls need maplibre-gl ≥ 5.6 (global state); " +
        "this map renders with the document's defaults.";
      notice.style.cssText = "max-width:200px;color:#666;";
      panel.appendChild(notice);
    } else {
      for (const [key, meta] of parameters) {
        panel.appendChild(this.controlRow(key, meta ?? {}, config, callbacks));
      }
    }

    for (const layer of config.toggleableLayers ?? []) {
      panel.appendChild(this.layerToggleRow(layer, callbacks));
    }

    container.appendChild(panel);
  }

  /** The state default for a key — `state: { key: { default } }`. */
  private stateDefault(config: ParamsPanelConfig, key: string): unknown {
    const entry = config.state?.[key];
    if (typeof entry === "object" && entry !== null && "default" in entry) {
      return (entry as { default?: unknown }).default;
    }
    return undefined;
  }

  /** Resolve the control kind: explicit type wins, then shape inference. */
  private controlKind(meta: ParameterMeta, current: unknown): string {
    const declared = meta.type?.toLowerCase();
    if (declared === "enum" || declared === "select") return "select";
    if (declared === "range") return "range";
    if (declared === "toggle") return "toggle";
    if (declared !== undefined) return "unknown";
    if (Array.isArray(meta.values)) return "select";
    if (typeof current === "boolean") return "toggle";
    return "unknown";
  }

  private controlRow(
    key: string,
    meta: ParameterMeta,
    config: ParamsPanelConfig,
    callbacks: ParamsPanelCallbacks
  ): HTMLElement {
    const current = this.stateDefault(config, key);
    const row = document.createElement("label");
    row.className = "ml-map-params-row";
    row.style.cssText = "display:block;margin:4px 0;";

    const caption = document.createElement("span");
    caption.className = "ml-map-params-label";
    caption.textContent = meta.label ?? key;
    caption.style.cssText = "display:block;font-weight:600;";
    row.appendChild(caption);

    switch (this.controlKind(meta, current)) {
      case "range": {
        if (meta.min === undefined || meta.max === undefined) {
          row.appendChild(this.readOnlyValue(current));
          break;
        }
        const input = document.createElement("input");
        input.type = "range";
        input.min = String(meta.min);
        input.max = String(meta.max);
        if (meta.step !== undefined) input.step = String(meta.step);
        if (typeof current === "number") input.value = String(current);
        input.style.cssText = "width:100%;display:block;";
        const value = document.createElement("span");
        value.className = "ml-map-params-value";
        value.textContent = input.value;
        input.addEventListener("input", () => {
          value.textContent = input.value;
          callbacks.onStateChange?.(key, Number(input.value));
        });
        row.appendChild(input);
        row.appendChild(value);
        break;
      }
      case "select": {
        const values = meta.values ?? [];
        const select = document.createElement("select");
        select.style.cssText = "width:100%;display:block;";
        values.forEach((v, i) => {
          const option = document.createElement("option");
          option.value = String(i);
          option.textContent = String(v);
          if (v === current) option.selected = true;
          select.appendChild(option);
        });
        // Values keep their authored TYPE (a numeric enum stays numeric):
        // options carry indexes and the change handler writes the original.
        select.addEventListener("change", () => {
          callbacks.onStateChange?.(key, values[Number(select.value)]);
        });
        row.appendChild(select);
        break;
      }
      case "toggle": {
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = current === true;
        input.addEventListener("change", () => {
          callbacks.onStateChange?.(key, input.checked);
        });
        row.appendChild(input);
        break;
      }
      default:
        // Unrecognized type: a labeled read-only row, never a dead control.
        row.appendChild(this.readOnlyValue(current));
    }
    return row;
  }

  private readOnlyValue(current: unknown): HTMLElement {
    const value = document.createElement("span");
    value.className = "ml-map-params-value";
    value.textContent = current === undefined ? "—" : String(current);
    return value;
  }

  private layerToggleRow(
    layer: ToggleableLayer,
    callbacks: ParamsPanelCallbacks
  ): HTMLElement {
    const row = document.createElement("label");
    row.className = "ml-map-params-row ml-map-params-layer";
    row.style.cssText = "display:flex;gap:6px;align-items:center;margin:4px 0;";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = layer.visible;
    input.addEventListener("change", () => {
      callbacks.onToggleLayer?.(layer.id, input.checked);
    });
    const caption = document.createElement("span");
    caption.textContent = layer.label;

    row.appendChild(input);
    row.appendChild(caption);
    return row;
  }
}
