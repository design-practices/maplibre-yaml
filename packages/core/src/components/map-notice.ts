/**
 * @file The non-fatal on-map notice: "part of this map didn't load"
 * @module @maplibre-yaml/core/components/map-notice
 *
 * @description
 * When the map renders but part of the document does not — a layer MapLibre
 * rejected, a data file that 404'd, a source name with a typo — the basemap
 * still shows and the student's layer is simply missing. The reason used to
 * reach only the console, which beginners rarely open (ml-aot.15). This small
 * dismissible panel lists those problems on the map itself, while the map
 * keeps working. `<ml-map quiet>` turns it off.
 */

/** Class on the notice element. */
export const NOTICE_CLASS = "ml-map-notice";

/** More than this many items collapse into "and N more". */
const MAX_ITEMS = 6;

/**
 * Append `text` to `parent`, rendering `` `backticked` `` spans as `<code>`.
 * Built with text nodes only — nothing in a message is ever parsed as HTML.
 */
function appendMessage(doc: Document, parent: HTMLElement, text: string): void {
  text.split("`").forEach((part, index) => {
    if (part === "") return;
    if (index % 2 === 1) {
      const code = doc.createElement("code");
      code.textContent = part;
      code.style.cssText =
        "font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; background: rgba(120, 53, 15, 0.08); padding: 0 3px; border-radius: 3px;";
      parent.appendChild(code);
    } else {
      parent.appendChild(doc.createTextNode(part));
    }
  });
}

/**
 * A dismissible list of non-fatal document problems, shown over the map.
 *
 * @remarks
 * Created lazily on the first problem, inside the map container (which
 * MapLibre positions), top-centre where no control or corner chrome sits.
 * Identical messages are listed once. `role="status"`, so assistive tech
 * announces it politely without stealing focus.
 */
export class MapNotice {
  private root: HTMLElement | null = null;
  private list: HTMLUListElement | null = null;
  private more: HTMLLIElement | null = null;
  private readonly seen = new Set<string>();
  private hidden = 0;

  /** @param host - where the panel mounts (the map container) */
  constructor(private readonly host: HTMLElement) {}

  /** Number of distinct problems reported so far. */
  get size(): number {
    return this.seen.size;
  }

  /** Add one problem (a no-op for a message already listed). */
  add(message: string): void {
    if (this.seen.has(message)) return;
    this.seen.add(message);
    const doc = this.host.ownerDocument;
    if (!this.root || !this.list) this.mount(doc);
    if (!this.root || !this.list) return;
    if (!this.root.isConnected) this.host.appendChild(this.root);

    if (this.seen.size > MAX_ITEMS) {
      this.hidden += 1;
      if (!this.more) {
        this.more = doc.createElement("li");
        this.list.appendChild(this.more);
      }
      this.more.textContent = `…and ${this.hidden} more (see the browser console).`;
      return;
    }
    const item = doc.createElement("li");
    item.style.cssText = "margin: 2px 0;";
    appendMessage(doc, item, message);
    if (this.more) this.list.insertBefore(item, this.more);
    else this.list.appendChild(item);
  }

  /** Remove the panel and forget every message. */
  clear(): void {
    this.root?.remove();
    this.root = null;
    this.list = null;
    this.more = null;
    this.seen.clear();
    this.hidden = 0;
  }

  private mount(doc: Document): void {
    const root = doc.createElement("div");
    root.className = NOTICE_CLASS;
    root.setAttribute("role", "status");
    root.setAttribute("aria-live", "polite");
    root.style.cssText = [
      "position: absolute",
      "top: 10px",
      "left: 50%",
      "transform: translateX(-50%)",
      "z-index: 5",
      "box-sizing: border-box",
      "width: max-content",
      "max-width: min(480px, calc(100% - 20px))",
      "max-height: 45%",
      "overflow: auto",
      "padding: 8px 32px 8px 12px",
      "background: #fffbeb",
      "color: #78350f",
      "border: 1px solid #f59e0b",
      "border-radius: 6px",
      "box-shadow: 0 2px 6px rgba(0, 0, 0, 0.18)",
      "font: 13px/1.45 system-ui, -apple-system, sans-serif",
      "text-align: left",
      "overflow-wrap: anywhere",
    ].join("; ");

    const title = doc.createElement("strong");
    title.textContent = "Part of this map didn't load";
    title.style.cssText = "display: block; margin-bottom: 2px;";

    const list = doc.createElement("ul");
    list.style.cssText = "margin: 0; padding-left: 18px;";

    const close = doc.createElement("button");
    close.type = "button";
    close.textContent = "×";
    close.setAttribute("aria-label", "Dismiss this notice");
    close.title = "Dismiss";
    close.style.cssText = [
      "position: absolute",
      "top: 4px",
      "right: 4px",
      "width: 24px",
      "height: 24px",
      "border: 0",
      "border-radius: 4px",
      "background: transparent",
      "color: inherit",
      "font: 18px/1 system-ui, sans-serif",
      "cursor: pointer",
    ].join("; ");
    // Dismissing hides what is listed; a NEW problem brings the panel back.
    close.addEventListener("click", () => root.remove());

    root.append(title, list, close);
    this.root = root;
    this.list = list;
  }
}
