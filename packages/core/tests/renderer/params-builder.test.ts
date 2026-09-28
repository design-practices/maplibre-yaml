/**
 * @file Params/toggle panel — controls, writes, degradation (U8, R11)
 */

import { describe, it, expect, vi } from "vitest";
import {
  ParamsBuilder,
  hasPanelContent,
  type ParamsPanelConfig,
} from "../../src/renderer/params-builder";
import { ChromeLayout } from "../../src/renderer/chrome-layout";

const build = (
  config: Partial<ParamsPanelConfig>,
  callbacks: Parameters<ParamsBuilder["build"]>[2] = {}
) => {
  const container = document.createElement("div");
  new ParamsBuilder().build(
    container,
    { stateSupported: true, ...config },
    callbacks
  );
  return container;
};

describe("ParamsBuilder", () => {
  it("renders nothing when neither parameters nor toggleable layers exist", () => {
    expect(hasPanelContent({ stateSupported: true })).toBe(false);
    expect(build({}).children).toHaveLength(0);
  });

  it("a range parameter renders a slider seeded from the state default, writes numbers", () => {
    const writes: Array<[string, unknown]> = [];
    const container = build(
      {
        parameters: { minPop: { label: "Min population", type: "range", min: 0, max: 20, step: 1 } },
        state: { minPop: { default: 5 } },
      },
      { onStateChange: (k, v) => writes.push([k, v]) }
    );

    const input = container.querySelector("input[type=range]") as HTMLInputElement;
    expect(input.value).toBe("5");
    expect(container.textContent).toContain("Min population");

    input.value = "12";
    input.dispatchEvent(new Event("input"));
    expect(writes).toEqual([["minPop", 12]]); // number, not "12"
    expect(container.querySelector(".ml-map-params-value")!.textContent).toBe("12");
  });

  it("select (and its enum alias) renders options and writes the ORIGINAL value type", () => {
    const writes: Array<[string, unknown]> = [];
    const container = build(
      {
        parameters: { year: { type: "enum", values: [2000, 2010, 2020] } },
        state: { year: { default: 2010 } },
      },
      { onStateChange: (k, v) => writes.push([k, v]) }
    );

    const select = container.querySelector("select") as HTMLSelectElement;
    expect(select.selectedIndex).toBe(1); // seeded from the state default
    select.value = "2";
    select.dispatchEvent(new Event("change"));
    expect(writes).toEqual([["year", 2020]]); // numeric value survives
  });

  it("toggle parameters render a checkbox writing booleans", () => {
    const writes: Array<[string, unknown]> = [];
    const container = build(
      {
        parameters: { labels: { type: "toggle" } },
        state: { labels: { default: true } },
      },
      { onStateChange: (k, v) => writes.push([k, v]) }
    );
    const input = container.querySelector("input[type=checkbox]") as HTMLInputElement;
    expect(input.checked).toBe(true);
    input.checked = false;
    input.dispatchEvent(new Event("change"));
    expect(writes).toEqual([["labels", false]]);
  });

  it("absent types infer from shape: values → select, boolean default → toggle", () => {
    const container = build({
      parameters: { scenario: { values: ["built", "zoned"] }, night: {} },
      state: { scenario: { default: "built" }, night: { default: false } },
    });
    expect(container.querySelector("select")).not.toBeNull();
    expect(container.querySelector("input[type=checkbox]")).not.toBeNull();
  });

  it("an unrecognized type degrades to a labeled read-only row, never a dead control", () => {
    const container = build({
      parameters: { magic: { label: "Magic", type: "quaternion" } },
      state: { magic: { default: 7 } },
    });
    expect(container.querySelector("input, select")).toBeNull();
    expect(container.textContent).toContain("Magic");
    expect(container.textContent).toContain("7");
  });

  it("a range without min/max degrades read-only instead of guessing bounds", () => {
    const container = build({
      parameters: { loose: { type: "range" } },
      state: { loose: { default: 3 } },
    });
    expect(container.querySelector("input")).toBeNull();
    expect(container.textContent).toContain("3");
  });

  it("below the state floor, parameter controls become one declared-absence notice", () => {
    const container = build({
      stateSupported: false,
      parameters: { minPop: { type: "range", min: 0, max: 20 } },
      state: { minPop: { default: 5 } },
    });
    expect(container.querySelector("input, select")).toBeNull();
    const notice = container.querySelector(".ml-map-params-notice")!;
    expect(notice.textContent).toContain("5.6");
  });

  it("layer toggles keep working below the state floor — they are plain visibility", () => {
    const toggles: Array<[string, boolean]> = [];
    const container = build(
      {
        stateSupported: false,
        toggleableLayers: [{ id: "roads", label: "Roads", visible: true }],
      },
      { onToggleLayer: (id, visible) => toggles.push([id, visible]) }
    );
    const input = container.querySelector("input[type=checkbox]") as HTMLInputElement;
    expect(input.checked).toBe(true);
    input.checked = false;
    input.dispatchEvent(new Event("change"));
    expect(toggles).toEqual([["roads", false]]);
  });

  it("layer rows honor the document's initial visibility", () => {
    const container = build({
      toggleableLayers: [{ id: "hidden", label: "Hidden", visible: false }],
    });
    const input = container.querySelector("input[type=checkbox]") as HTMLInputElement;
    expect(input.checked).toBe(false);
  });
});

describe("ParamsBuilder edge semantics", () => {
  it("bare non-object state entries seed controls — the value the renderer applied", () => {
    const container = build({
      parameters: { year: { type: "range", min: 1900, max: 2100 }, night: {} },
      state: { year: 1980, night: false } as any,
    });
    const slider = container.querySelector("input[type=range]") as HTMLInputElement;
    expect(slider.value).toBe("1980");
    // The bare boolean still infers a toggle.
    expect(container.querySelector("input[type=checkbox]")).not.toBeNull();
  });

  it("a select whose state default matches no value shows the APPLIED default, disabled", () => {
    const container = build({
      parameters: { year: { type: "select", values: [2000, 2010] } },
      state: { year: { default: "2010" } }, // string vs numeric values
    });
    const select = container.querySelector("select") as HTMLSelectElement;
    const selected = select.selectedOptions[0]!;
    expect(selected.disabled).toBe(true);
    expect(selected.textContent).toBe("2010");
    // The authored values remain pickable.
    expect(select.options).toHaveLength(3);
  });

  it("no type, no values, non-boolean default → read-only row (inference exhaustion)", () => {
    const container = build({
      parameters: { radius: {} },
      state: { radius: { default: 6 } },
    });
    expect(container.querySelector("input, select")).toBeNull();
    expect(container.textContent).toContain("6");
  });

  it("a parameter with no state entry renders its label with an em-dash value", () => {
    const container = build({ parameters: { ghost: { label: "Ghost" } } });
    expect(container.textContent).toContain("Ghost");
    expect(container.textContent).toContain("—");
  });

  it("hostile markup in labels and values stays inert text", () => {
    const XSS = '<img src=x onerror="window.__pwned=1">';
    const container = build({
      parameters: { evil: { label: XSS, type: "select", values: [XSS] } },
      state: { evil: { default: XSS } },
      toggleableLayers: [{ id: "l", label: XSS, visible: true }],
    });
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain(XSS);
    expect((window as any).__pwned).toBeUndefined();
  });
});

describe("ChromeLayout (KTD10)", () => {
  it("same-corner occupants stack in registration order, opting into pointer events", () => {
    const host = document.createElement("div");
    const chrome = new ChromeLayout(host);
    const legend = document.createElement("div");
    const panel = document.createElement("div");
    chrome.mount("top-right", legend);
    chrome.mount("top-right", panel);

    const corners = host.querySelectorAll(".ml-map-chrome");
    expect(corners).toHaveLength(1); // one container per corner, reused
    const corner = corners[0] as HTMLElement;
    expect([...corner.children]).toEqual([legend, panel]);
    expect(corner.style.pointerEvents).toBe("none");
    expect(legend.style.pointerEvents).toBe("auto");
  });

  it("bottom corners grow upward so the first occupant hugs the edge", () => {
    const host = document.createElement("div");
    const corner = new ChromeLayout(host).corner("bottom-left");
    expect(corner.style.flexDirection).toBe("column-reverse");
    expect(corner.style.bottom).toBe("10px");
    expect(corner.style.left).toBe("10px");
  });

  it("destroy removes every corner container", () => {
    const host = document.createElement("div");
    const chrome = new ChromeLayout(host);
    chrome.mount("top-left", document.createElement("div"));
    chrome.mount("bottom-right", document.createElement("div"));
    chrome.destroy();
    expect(host.querySelectorAll(".ml-map-chrome")).toHaveLength(0);
  });
});
