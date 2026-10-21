/**
 * @file Popup HTML builder for map features
 * @module @maplibre-yaml/core/renderer
 */

import type { z } from "zod";
import { PopupContentSchema, PopupContentItemSchema } from "../schemas";
import {
  escapeHtml,
  safeUrl,
  isHtmlMarker,
  POPUP_TAGS,
  LINK_TARGETS,
} from "../utils/html";
import { allowsHtml, DEFAULT_POLICY, type CapabilityPolicy } from "../capabilities";
import { formatNumber, type NumberFormat } from "../i18n/number-format";
import { numericValue } from "../classify/breaks";

/**
 * The number a popup `format:` formats: a finite number, or a non-blank
 * string that reads as one the way `classify:` reads it (`"54000"`,
 * `"1.5e3"`). `"n/a"`, `""` and anything else stay text.
 */
function formattableNumber(value: unknown): number | undefined {
  if (typeof value === "string" && value.trim() === "") return undefined;
  const n = numericValue(value);
  return n !== undefined && Number.isFinite(n) ? n : undefined;
}
import { elementLanguage } from "../i18n/strings";

/**
 * The page's language at a map (its container's nearest `lang`), read
 * lazily: the popup sinks hand this to {@link PopupBuilder}.
 */
export function mapLanguage(map: unknown): () => string | undefined {
  return () => {
    const getContainer = (map as { getContainer?: () => Element | undefined })?.getContainer;
    try {
      return typeof getContainer === "function" ? elementLanguage(getContainer.call(map)) : undefined;
    } catch {
      return undefined;
    }
  };
}

type PopupContent = z.infer<typeof PopupContentSchema>;
type PopupContentItem = z.infer<typeof PopupContentItemSchema>;

/**
 * True when every item under an `a:`/`img:` entry renders that element itself
 * (a link item under `a:`, an image item under `img:`).
 */
function isSelfRendering(tag: string, items: PopupContentItem[]): boolean {
  if (tag === "a") return items.every((i) => !!i?.href && !i.property);
  if (tag === "img") return items.every((i) => !!i?.src && !i.href && !i.str && !i.property);
  return false;
}

/**
 * Builds popup HTML from configuration and feature properties.
 *
 * @remarks
 * Carries the capability policy, because whether an `!html`-marked value renders
 * as markup or as escaped text is a trust decision, not a content one. The
 * default policy is untrusted, so a builder constructed with no policy denies
 * raw HTML — the safe default a host that has thought about none of this gets.
 */
export class PopupBuilder {
  private readonly policy: CapabilityPolicy;
  private readonly language: () => string | undefined;

  /**
   * @param policy - the capability policy (see the class remarks).
   * @param options.language - the locale numbers are formatted for when a
   *   `format:` names none: usually the page's language at the map
   *   (`elementLanguage(map.getContainer())`). Read on every build. Absent:
   *   the browser's.
   */
  constructor(
    policy: CapabilityPolicy = DEFAULT_POLICY,
    options: { language?: () => string | undefined } = {}
  ) {
    this.policy = policy;
    this.language = options.language ?? (() => undefined);
  }

  /**
   * Build HTML string from popup content config and feature properties
   */
  build(content: PopupContent, properties: Record<string, any>): string {
    return content
      .map((item) => {
        const entries = Object.entries(item);
        if (entries.length === 0) return "";
        const entry = entries[0];
        if (!entry) return "";
        const [tag, items] = entry;
        if (!Array.isArray(items)) return "";
        // The tag is a YAML key, so without this check any key at all became
        // an element -- `script:` emitted a script block, and a key carrying
        // attributes (`img src=x onerror=...`) injected them wholesale.
        if (!POPUP_TAGS.has(tag)) {
          console.warn(
            `[maplibre-yaml] Ignoring popup element "${tag}": not a supported tag. ` +
              `Supported: ${[...POPUP_TAGS].join(", ")}.`
          );
          return "";
        }
        const innerHTML = items
          .map((i: PopupContentItem) => this.buildItem(i, properties))
          .join("");
        // A link item already renders its own <a>, an image item its own
        // <img>: wrapping them in the same tag emitted an empty <a>/<img>
        // around (or before) the real one.
        if (items.length > 0 && isSelfRendering(tag, items)) return innerHTML;
        return `<${tag}>${innerHTML}</${tag}>`;
      })
      .join("");
  }

  /**
   * Build a single content item
   */
  private buildItem(
    item: PopupContentItem,
    properties: Record<string, any>
  ): string {
    // Static string, or an `!html`-marked one. With `href` it is the link
    // text: `{ str, href }` is the shape the content-block docs show, and it
    // used to render the text alone, silently dropping the URL.
    if (item.str) {
      const strHtml = this.renderStr(item.str);
      return item.href ? this.buildLink(item, strHtml) : strHtml;
    }

    // Dynamic property
    if (item.property) {
      const value = properties[item.property];
      if (value !== undefined && value !== null) {
        // A number with a `format:` (MapLibre number-format options, or the
        // older ",.0f" string) goes through Intl, in the page's language
        // unless the format names a locale. A numeric string ("100700", as a
        // CSV or ogr2ogr-written text column carries it) is that number, as
        // `classify:` reads it; other text is escaped like any value.
        const number = item.format ? formattableNumber(value) : undefined;
        if (number !== undefined) {
          return escapeHtml(formatNumber(number, item.format as NumberFormat, this.language()));
        }
        return escapeHtml(String(value));
      }
      // Use fallback
      return item.else ? escapeHtml(item.else) : "";
    }

    // Link
    if (item.href) return this.buildLink(item, escapeHtml(item.href));

    // Image
    if (item.src) {
      const alt = (item as any).alt || "";
      const src = safeUrl(item.src);
      if (src === null) {
        console.warn(
          `[maplibre-yaml] Dropping popup image with unsafe URL scheme: ${item.src}`
        );
        return "";
      }
      return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" />`;
    }

    return "";
  }

  /**
   * Render a `str` value: plain text is escaped; an `!html`-marked value is
   * markup only when the capability policy allows it.
   */
  private renderStr(str: NonNullable<PopupContentItem["str"]>): string {
    if (isHtmlMarker(str)) {
      // The marker is a request; the policy is the grant. Denied content is
      // escaped and shown as text rather than dropped, so an author sees what
      // they wrote and a warning explains why it is not live markup.
      if (allowsHtml(this.policy)) return str.$html;
      console.warn(
        "[maplibre-yaml] An `!html` popup value was authored in a context " +
          "that does not permit raw markup; rendering it as escaped text."
      );
      return escapeHtml(str.$html);
    }
    return escapeHtml(str);
  }

  /**
   * Render a link item. The link text is `text` when given, else
   * `fallbackHtml` (the rendered `str`, or the escaped URL).
   */
  private buildLink(item: PopupContentItem, fallbackHtml: string): string {
    const textHtml = item.text ? escapeHtml(item.text) : fallbackHtml;
    // `javascript:` survives escaping untouched and executes on click, and
    // validation accepts it as a well-formed URL -- so the scheme is checked
    // here rather than trusted from validation.
    const href = safeUrl(item.href ?? "");
    if (href === null) {
      console.warn(
        `[maplibre-yaml] Dropping popup link with unsafe URL scheme: ${item.href}`
      );
      return textHtml;
    }
    // Validation restricts `target` to LINK_TARGETS, but the builder also
    // serves unvalidated configs: an unchecked value was raw-interpolated into
    // the attribute -- `_blank" onmouseover="...` escaped the quotes.
    const requested = typeof item.target === "string" ? item.target : "_blank";
    const target = LINK_TARGETS.has(requested) ? requested : "_blank";
    // A `_blank` link hands the opener to the destination without this.
    const rel = target === "_blank" ? ' rel="noopener noreferrer"' : "";
    return `<a href="${escapeHtml(href)}" target="${escapeHtml(
      target
    )}"${rel}>${textHtml}</a>`;
  }

}
