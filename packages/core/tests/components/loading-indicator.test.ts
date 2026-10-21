/**
 * The loading state of a slow `<ml-map>` (ml-aot.121): `aria-busy` from the
 * start, a muted "Loading map…" only once the map has taken a second, both
 * gone when it draws or fails.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { LoadingIndicator, LOADING_CLASS, LOADING_DELAY_MS } from "../../src/components/loading-indicator";
import { createStrings } from "../../src/i18n/strings";

afterEach(() => vi.useRealTimers());

function setup(label = () => "Loading map…") {
  const host = document.createElement("div");
  const container = document.createElement("div");
  host.appendChild(container);
  return { host, container, indicator: new LoadingIndicator(host, () => container, label) };
}

describe("LoadingIndicator", () => {
  it("busy at once, the label only after the delay, both gone on stop", () => {
    vi.useFakeTimers();
    const { host, container, indicator } = setup();
    indicator.start();
    expect(host.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector(`.${LOADING_CLASS}`)).toBeNull();
    vi.advanceTimersByTime(LOADING_DELAY_MS);
    const label = container.querySelector(`.${LOADING_CLASS}`)!;
    expect(label.textContent).toBe("Loading map…");
    expect(label.getAttribute("role")).toBe("status");
    indicator.stop();
    expect(host.hasAttribute("aria-busy")).toBe(false);
    expect(container.querySelector(`.${LOADING_CLASS}`)).toBeNull();
  });

  it("a map that draws within the delay never shows the label", () => {
    vi.useFakeTimers();
    const { container, indicator } = setup();
    indicator.start();
    vi.advanceTimersByTime(LOADING_DELAY_MS / 2);
    indicator.stop();
    vi.advanceTimersByTime(LOADING_DELAY_MS * 5);
    expect(container.querySelector(`.${LOADING_CLASS}`)).toBeNull();
  });

  it("the label is the document's translation, read when it shows", () => {
    vi.useFakeTimers();
    let strings = createStrings(undefined);
    const { container, indicator } = setup(() => strings("maplibre-yaml.Loading"));
    indicator.start();
    strings = createStrings({ "maplibre-yaml.Loading": "Cargando el mapa…" });
    vi.advanceTimersByTime(LOADING_DELAY_MS);
    expect(container.querySelector(`.${LOADING_CLASS}`)!.textContent).toBe("Cargando el mapa…");
  });

  it("starting twice keeps one timer and one label", () => {
    vi.useFakeTimers();
    const { container, indicator } = setup();
    indicator.start();
    indicator.start();
    vi.advanceTimersByTime(LOADING_DELAY_MS);
    expect(container.querySelectorAll(`.${LOADING_CLASS}`)).toHaveLength(1);
  });
});
