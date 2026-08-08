/**
 * @file Popup HTML builder for map features
 * @module @maplibre-yaml/core/renderer
 */

import type { z } from "zod";
import { PopupContentSchema, PopupContentItemSchema } from "../schemas";
import {
  escapeHtml,
  safeUrl,
  POPUP_TAGS,
  LINK_TARGETS,
} from "../utils/html";

type PopupContent = z.infer<typeof PopupContentSchema>;
type PopupContentItem = z.infer<typeof PopupContentItemSchema>;

/**
 * Builds popup HTML from configuration and feature properties
 */
export class PopupBuilder {
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
    // Static string
    if (item.str) {
      return escapeHtml(item.str);
    }

    // Dynamic property
    if (item.property) {
      const value = properties[item.property];
      if (value !== undefined && value !== null) {
        // Apply format if specified
        if (item.format && typeof value === "number") {
          return this.formatNumber(value, item.format);
        }
        return escapeHtml(String(value));
      }
      // Use fallback
      return item.else ? escapeHtml(item.else) : "";
    }

    // Link
    if (item.href) {
      const text = (item as any).text || item.href;
      // `javascript:` survives escaping untouched and executes on click, and
      // zod's `.url()` accepts it as well-formed -- so the scheme is checked
      // here rather than trusted from validation.
      const href = safeUrl(item.href);
      if (href === null) {
        console.warn(
          `[maplibre-yaml] Dropping popup link with unsafe URL scheme: ${item.href}`
        );
        return escapeHtml(text);
      }
      // `target` is passthrough in the schema, so it was raw-interpolated into
      // the attribute -- `_blank" onmouseover="...` escaped the quotes.
      const requested = (item as any).target ?? "_blank";
      const target = LINK_TARGETS.has(requested) ? requested : "_blank";
      // A `_blank` link hands the opener to the destination without this.
      const rel = target === "_blank" ? ' rel="noopener noreferrer"' : "";
      return `<a href="${escapeHtml(href)}" target="${escapeHtml(
        target
      )}"${rel}>${escapeHtml(text)}</a>`;
    }

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
   * Format a number according to format string
   */
  private formatNumber(value: number, format: string): string {
    // Simple number formatting
    // Format strings like ",.0f" or ".2f"

    // Check for thousands separator
    const useThousands = format.includes(",");

    // Extract decimal places
    const decimalMatch = format.match(/\.(\d+)/);
    const decimals =
      decimalMatch && decimalMatch[1] ? parseInt(decimalMatch[1]) : 0;

    // Format the number
    let result = value.toFixed(decimals);

    // Add thousands separators if requested
    if (useThousands) {
      const parts = result.split(".");
      if (parts[0]) {
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      }
      result = parts.join(".");
    }

    return result;
  }

}
