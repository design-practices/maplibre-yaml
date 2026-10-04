import { describe, it, expect } from "vitest";
import { liftPopup, POPUP_Z_INDEX } from "../../src/renderer/chrome-layout";

/** A popup double: an element only once "opened", like MapLibre's. */
function fakePopup(openNow = false) {
  let el: HTMLElement | undefined = openNow ? document.createElement("div") : undefined;
  const listeners: Array<() => void> = [];
  return {
    getElement: () => el,
    on: (_t: "open", fn: () => void) => listeners.push(fn),
    open() {
      el = el ?? document.createElement("div");
      for (const fn of listeners) fn();
    },
  };
}

describe("liftPopup (ml-3d0)", () => {
  it("raises an already-open popup above the chrome corners", () => {
    const p = liftPopup(fakePopup(true));
    expect(p.getElement()!.style.zIndex).toBe(POPUP_Z_INDEX);
  });

  it("raises a popup whose element only exists once it opens (marker popups)", () => {
    const p = liftPopup(fakePopup(false));
    expect(p.getElement()).toBeUndefined();
    p.open();
    expect(p.getElement()!.style.zIndex).toBe(POPUP_Z_INDEX);
  });

  it("sits above both chrome corners (1) and MapLibre's control corners (2)", () => {
    expect(Number(POPUP_Z_INDEX)).toBeGreaterThan(2);
  });

  it("tolerates a partial popup (no element accessor, no events)", () => {
    expect(() => liftPopup({} as never)).not.toThrow();
  });
});
