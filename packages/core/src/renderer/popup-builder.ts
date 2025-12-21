/**
 * @file Popup HTML builder for map features
 * @module @maplibre-yaml/core/renderer
 */

import type { z } from "zod";
import { PopupContentSchema, PopupContentItemSchema } from "../schemas";

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
        if (entries.length === 0) return '';
        const [tag, items] = entries[0];
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
      return this.escapeHtml(item.str);
    }

    // Dynamic property
    if (item.property) {
      const value = properties[item.property];
      if (value !== undefined && value !== null) {
        // Apply format if specified
        if (item.format && typeof value === "number") {
          return this.formatNumber(value, item.format);
        }
        return this.escapeHtml(String(value));
      }
      // Use fallback
      return item.else ? this.escapeHtml(item.else) : "";
    }

    // Link
    if (item.href) {
      const text = (item as any).text || item.href;
      const target = (item as any).target || "_blank";
      return `<a href="${this.escapeHtml(
        item.href
      )}" target="${target}">${this.escapeHtml(text)}</a>`;
    }

    // Image
    if (item.src) {
      const alt = (item as any).alt || "";
      return `<img src="${this.escapeHtml(item.src)}" alt="${this.escapeHtml(
        alt
      )}" />`;
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
    const decimals = decimalMatch && decimalMatch[1] ? parseInt(decimalMatch[1]) : 0;

    // Format the number
    let result = value.toFixed(decimals);

    // Add thousands separators if requested
    if (useThousands) {
      const parts = result.split(".");
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      result = parts.join(".");
    }

    return result;
  }

  /**
   * Escape HTML to prevent XSS
   */
  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
}
