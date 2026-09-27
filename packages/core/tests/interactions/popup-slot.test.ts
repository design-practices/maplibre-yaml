/**
 * @file The shared one-popup slot (U7, KTD8) — the single implementation
 * both hosts delegate to, so this file is where the coexistence contract
 * and its close-event ordering are pinned.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const popupInstances: any[] = [];

vi.mock("maplibre-gl", () => {
  const Popup = vi.fn((options?: unknown) => {
    const handlers = new Map<string, Function[]>();
    const instance = {
      options,
      html: "",
      setLngLat: vi.fn().mockReturnThis(),
      setHTML: vi.fn(function (this: any, html: string) {
        this.html = html;
        return this;
      }),
      addTo: vi.fn().mockReturnThis(),
      // Real maplibre fires 'close' SYNCHRONOUSLY on remove().
      remove: vi.fn(() => {
        for (const cb of handlers.get("close") ?? []) cb();
      }),
      on: vi.fn((event: string, cb: Function) => {
        handlers.set(event, [...(handlers.get(event) ?? []), cb]);
      }),
    };
    popupInstances.push(instance);
    return instance;
  });
  return { default: { Popup }, Popup };
});

import { PopupSlot } from "../../src/interactions/popup-slot";
import { PopupBuilder } from "../../src/renderer/popup-builder";

const LNGLAT = { lng: 1, lat: 2 } as any;
const MAP = {} as any;
const CONTENT = [{ p: [{ text: "hello" }] }] as any;
const HOVER = { closeButton: false, closeOnClick: false, kind: "hover" as const };

describe("PopupSlot", () => {
  beforeEach(() => {
    popupInstances.length = 0;
    vi.clearAllMocks();
  });

  const makeSlot = () => new PopupSlot(MAP, new PopupBuilder({ trust: "untrusted" }));

  it("pinned replaces pinned; the synchronous close from remove() never nulls the new popup", () => {
    const slot = makeSlot();
    expect(slot.show(CONTENT, { properties: {} }, LNGLAT)).toBe(true);
    expect(slot.show(CONTENT, { properties: {} }, LNGLAT)).toBe(true);
    expect(popupInstances[0].remove).toHaveBeenCalled();

    // If the old popup's synchronous close had nulled the NEW popup's slot
    // tracking, a hover popup would now wrongly display; it must still be
    // suppressed by the live pinned popup.
    expect(slot.show(CONTENT, { properties: {} }, LNGLAT, HOVER)).toBe(false);
  });

  it("hover never displaces pinned; user dismissal frees the slot", () => {
    const slot = makeSlot();
    slot.show(CONTENT, { properties: {} }, LNGLAT); // pinned
    expect(slot.show(CONTENT, { properties: {} }, LNGLAT, HOVER)).toBe(false);

    popupInstances[0].remove(); // user dismissal fires close → slot freed
    expect(slot.show(CONTENT, { properties: {} }, LNGLAT, HOVER)).toBe(true);
  });

  it("hover replaces hover freely; hideHover removes only hover popups", () => {
    const slot = makeSlot();
    expect(slot.show(CONTENT, { properties: {} }, LNGLAT, HOVER)).toBe(true);
    expect(slot.show(CONTENT, { properties: {} }, LNGLAT, HOVER)).toBe(true);
    expect(popupInstances[0].remove).toHaveBeenCalled();

    slot.hideHover();
    expect(popupInstances[1].remove).toHaveBeenCalled();

    slot.show(CONTENT, { properties: {} }, LNGLAT); // pinned
    slot.hideHover(); // must NOT touch the pinned popup
    expect(popupInstances[2].remove).not.toHaveBeenCalled();
  });

  it("hideHover with an empty slot is a no-op", () => {
    expect(() => makeSlot().hideHover()).not.toThrow();
  });

  it("escapes hostile feature properties under an untrusted policy — the hover path shares click's XSS gate", () => {
    const slot = makeSlot();
    slot.show(
      [{ p: [{ property: "name" }] }] as any,
      { properties: { name: '<img src=x onerror=alert(1)>' } },
      LNGLAT,
      HOVER
    );
    const html = popupInstances[0].html as string;
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("destroy tears down whatever occupies the slot", () => {
    const slot = makeSlot();
    slot.show(CONTENT, { properties: {} }, LNGLAT);
    slot.destroy();
    expect(popupInstances[0].remove).toHaveBeenCalled();
  });
});
