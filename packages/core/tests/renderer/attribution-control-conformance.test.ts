/**
 * Conformance: `controls.attribution` builds a real MapLibre control.
 *
 * @remarks
 * The controls-manager suite mocks maplibre-gl, so it proves we called
 * `addControl` with an object our own mock produced — it would pass just as
 * happily if the real `AttributionControl` export did not exist, or if
 * `compact`/`customAttribution` never reached it. This file deliberately does
 * NOT mock maplibre-gl: it constructs the genuine control and renders it, so
 * "one attribution control at the configured position" is verified against
 * MapLibre rather than against our stand-in for it.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// Real maplibre-gl touches browser APIs jsdom does not implement. Hoisted so
// the polyfills exist before the module is imported and evaluated.
vi.hoisted(() => {
  const w = globalThis as any;
  w.URL.createObjectURL ??= () => "blob:conformance";
  w.URL.revokeObjectURL ??= () => {};
  w.Worker ??= class {
    postMessage() {}
    terminate() {}
    addEventListener() {}
  };
});

import { AttributionControl } from "maplibre-gl";
import { ControlsManager } from "../../src/renderer/controls-manager";

describe("attribution control is a real MapLibre control", () => {
  let addControl: ReturnType<typeof vi.fn>;
  let map: any;
  let manager: ControlsManager;

  beforeEach(() => {
    addControl = vi.fn();
    // Only the map is stubbed — the controls themselves are real. These are
    // the internals AttributionControl.onAdd actually reaches for; a real map
    // needs WebGL, which jsdom has no answer for.
    map = {
      addControl,
      removeControl: vi.fn(),
      getContainer: () => document.createElement("div"),
      getCanvasContainer: () => document.createElement("div"),
      on: vi.fn(),
      off: vi.fn(),
      _getUIString: (key: string) => key,
      style: { stylesheet: {}, sourceCaches: {} },
      getStyle: () => ({ sources: {} }),
      _controls: [],
    };
    manager = new ControlsManager(map);
  });

  it("adds a genuine AttributionControl at bottom-right", () => {
    manager.addControls({ attribution: true } as any);

    expect(addControl).toHaveBeenCalledTimes(1);
    const [control, position] = addControl.mock.calls[0];
    expect(control).toBeInstanceOf(AttributionControl);
    expect(position).toBe("bottom-right");
  });

  it("renders an attribution element into the DOM", () => {
    manager.addControls({
      attribution: { customAttribution: "© Example Data" },
    } as any);

    const [control] = addControl.mock.calls[0];
    const element = control.onAdd(map);

    // The actual product claim: something attributable appears on the map.
    expect(element).toBeInstanceOf(HTMLElement);
    expect(element.className).toContain("maplibregl-ctrl");
    expect(element.innerHTML).toContain("Example Data");

    control.onRemove();
  });

  it("honors compact on the real control", () => {
    // Needs attribution content: MapLibre skips compact mode entirely when the
    // control is empty, so a contentless case would pass whatever we asserted.
    manager.addControls({
      attribution: { compact: true, customAttribution: "© Example Data" },
    } as any);

    const [control] = addControl.mock.calls[0];
    const element = control.onAdd(map);

    // Asserting the option reached the constructor is not enough — a key the
    // control ignores would still be "passed". This is the rendered effect.
    expect(element.className).toContain("maplibregl-compact");

    control.onRemove();
  });

  it("matches MapLibre's own default position", () => {
    manager.addControls({ attribution: true } as any);
    const [control, position] = addControl.mock.calls[0];

    // Our default is hardcoded; this pins it to the control's own answer so the
    // two cannot silently diverge across a maplibre-gl upgrade.
    expect(position).toBe(control.getDefaultPosition());
  });
});
