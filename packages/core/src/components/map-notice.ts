/**
 * @file The non-fatal on-map notice: "part of this map couldn't load"
 * @module @maplibre-yaml/core/components/map-notice
 *
 * @description
 * When the map renders but part of the document does not — a layer MapLibre
 * rejected, a data file that 404'd, a source name with a typo — the basemap
 * still shows and the author's layer is simply missing. The reason used to
 * reach only the console, which few people open (ml-aot.15). This small
 * dismissible panel lists those problems on the map itself, while the map
 * keeps working. `<ml-map quiet>` turns it off.
 *
 * Two readers see it: the map's author, who needs the fix (paths, folders,
 * did-you-mean), and a visitor to the published site, who only needs to
 * know part of the map is missing. So it leads with one plain line and puts
 * the author's detail in a "Details for the site's author" disclosure,
 * open while the page is served from this computer (localhost, file://)
 * and closed on a published site, where a click still opens it.
 */

import { DEFAULT_STRINGS, defaultStrings, type Strings } from "../i18n/strings";

/** Class on the notice element. */
export const NOTICE_CLASS = "ml-map-notice";

/**
 * The notice's lead line, for every reader (English; a document's `locale:`
 * overrides it as `maplibre-yaml.Notice.Title`).
 */
export const NOTICE_TITLE = DEFAULT_STRINGS["maplibre-yaml.Notice.Title"];

/** Whether a page is being served from this computer (an author working on it). */
export function isLocalPage(doc: Document | undefined): boolean {
  try {
    const location = doc?.location;
    if (!location) return false;
    if (location.protocol === "file:") return true;
    const host = location.hostname.replace(/^\[|\]$/g, "");
    return host === "localhost" || host.endsWith(".localhost") || host === "::1" || /^127\./.test(host);
  } catch {
    return false;
  }
}

/** Options for {@link MapNotice}. */
export interface MapNoticeOptions {
  /** Start with the author's details open (default: on a local page). */
  openDetails?: boolean;
  /** The document's UI strings (`maplibre-yaml.Notice.*`); English by default. */
  strings?: Strings;
}

/** More than this many items collapse into "and N more". */
const MAX_ITEMS = 6;

/**
 * Append `text` to `parent`, rendering `` `backticked` `` spans as `<code>`.
 * Built with text nodes only — nothing in a message is ever parsed as HTML.
 */
export function appendMessage(doc: Document, parent: HTMLElement, text: string): void {
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

  /**
   * @param host - where the panel mounts (the map container)
   * @param options - see {@link MapNoticeOptions}
   */
  constructor(
    private readonly host: HTMLElement,
    private readonly options: MapNoticeOptions = {}
  ) {}

  private get t(): Strings {
    return this.options.strings ?? defaultStrings;
  }

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
      this.more.textContent = this.t("maplibre-yaml.Notice.More", { count: this.hidden });
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
    title.textContent = this.t("maplibre-yaml.Notice.Title");
    title.style.cssText = "display: block; margin-bottom: 2px;";

    // The author's fix, one click away for a visitor (see the file header).
    const details = doc.createElement("details");
    details.open = this.options.openDetails ?? isLocalPage(doc);
    details.style.cssText = "font-size: 12px; line-height: 1.4;";
    const summary = doc.createElement("summary");
    summary.textContent = this.t("maplibre-yaml.Notice.AuthorDetails");
    summary.style.cssText = "cursor: pointer; opacity: 0.85;";
    const list = doc.createElement("ul");
    list.style.cssText = "margin: 2px 0 0; padding-left: 18px;";
    details.append(summary, list);

    const close = doc.createElement("button");
    close.type = "button";
    close.textContent = "×";
    close.setAttribute("aria-label", this.t("maplibre-yaml.Notice.Dismiss"));
    close.title = this.t("maplibre-yaml.Notice.Dismiss");
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

    root.append(title, details, close);
    this.root = root;
    this.list = list;
  }
}
