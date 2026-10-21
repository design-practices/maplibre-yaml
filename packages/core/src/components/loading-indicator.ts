/**
 * @file A quiet "Loading map…" while a slow map starts (ml-aot.121)
 * @module @maplibre-yaml/core/components/loading-indicator
 *
 * @description
 * On a slow connection a map takes seconds between the element appearing
 * and its basemap drawing: the scripts, the style and the first tiles all
 * arrive over the network, and until then the box is blank. This says the
 * map is coming:
 *
 * - `aria-busy="true"` on the element from the moment it starts, so a
 *   screen reader knows the region is still loading;
 * - after {@link LOADING_DELAY_MS}, and only if the map hasn't drawn by then,
 *   a small muted "Loading map…" in the middle of the box (`role="status"`),
 *   translatable as `maplibre-yaml.Loading` — a fast map never shows it;
 * - both go away when the basemap first draws, or when the map can't load
 *   (an error card takes the box).
 *
 * It is not a notice: `quiet` (which hides the notice of problems) leaves it
 * alone. A host with its own loading UI hides it with CSS:
 * `ml-map .ml-map-loading { display: none; }`.
 */

/** Class of the "Loading map…" element. */
export const LOADING_CLASS = "ml-map-loading";

/** How long a map may take before "Loading map…" appears. */
export const LOADING_DELAY_MS = 1000;

/** Shows and removes the loading state of one `<ml-map>`. */
export class LoadingIndicator {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private element: HTMLElement | null = null;
  private active = false;

  /**
   * @param host - The `<ml-map>` element (gets `aria-busy`).
   * @param container - Where the label goes (the map's own container).
   * @param label - The label text, read when it is shown (the document's
   *   `locale:` may have arrived by then).
   */
  constructor(
    private readonly host: HTMLElement,
    private readonly container: () => HTMLElement | null,
    private readonly label: () => string
  ) {}

  /** Start (or keep) the loading state. */
  start(delayMs: number = LOADING_DELAY_MS): void {
    if (this.active) return;
    this.active = true;
    this.host.setAttribute("aria-busy", "true");
    this.timer = setTimeout(() => this.show(), delayMs);
  }

  /** End the loading state: the map drew, or it can't. */
  stop(): void {
    if (!this.active) return;
    this.active = false;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.host.removeAttribute("aria-busy");
    this.element?.remove();
    this.element = null;
  }

  private show(): void {
    const container = this.container();
    if (!this.active || !container) return;
    const doc = container.ownerDocument;
    const el = doc.createElement("div");
    el.className = LOADING_CLASS;
    el.setAttribute("role", "status");
    el.textContent = this.label();
    el.style.cssText = [
      "position: absolute",
      "top: 50%",
      "left: 50%",
      "transform: translate(-50%, -50%)",
      "z-index: 4",
      "padding: 4px 10px",
      "border-radius: 999px",
      "background: rgba(255, 255, 255, 0.85)",
      "color: #4b5563",
      "font: 13px/1.4 system-ui, -apple-system, sans-serif",
      "pointer-events: none",
      "white-space: nowrap",
    ].join("; ");
    container.appendChild(el);
    this.element = el;
  }
}
