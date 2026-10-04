/**
 * @file Legend builder for map layers
 * @module @maplibre-yaml/core/renderer
 */

import type { z } from 'zod';
import { LayerSchema, LegendConfigSchema, LegendItemSchema } from '../schemas';
import { escapeHtml } from '../utils/html';

type Layer = z.infer<typeof LayerSchema>;
type LegendConfig = z.infer<typeof LegendConfigSchema>;
type LegendItem = z.infer<typeof LegendItemSchema>;

/**
 * Builds legend HTML from layer configurations
 */
export class LegendBuilder {
  /**
   * Build legend in container from layers
   */
  build(container: string | HTMLElement, layers: Layer[], config?: Partial<LegendConfig>): void {
    const el = typeof container === 'string' ? document.getElementById(container) : container;
    if (!el) return;

    const items = config?.items || this.extractItems(layers);

    // Nothing to show → no box. An empty "Legend" panel reads as broken chrome;
    // say what's missing instead (entries come from layers' `legend:` fields
    // or the block's own `items:`).
    if (items.length === 0) {
      el.innerHTML = "";
      el.hidden = true;
      console.warn(
        "[maplibre-yaml] legend: has no entries — add `legend:` to the layers that " +
          "should appear, or list `items:` on the legend block. No legend is shown."
      );
      return;
    }
    el.hidden = false;

    // <details>/<summary> makes `collapsed:` real (the schema field existed
    // with no implementation — ml-tfd.8 contract audit): the title is the
    // toggle, `collapsed: true` starts closed, default stays fully visible.
    // The summary needs content to be clickable, so an untitled legend gets
    // the literal "Legend".
    let html = `<details class="maplibre-legend"${config?.collapsed ? "" : " open"}>`;
    html += `<summary class="legend-title">${escapeHtml(config?.title ?? "Legend")}</summary>`;
    html += '<div class="legend-items">';
    for (const item of items) {
      html += this.renderItem(item);
    }
    html += '</div></details>';

    el.innerHTML = html;
  }

  /**
   * Render a single legend item
   */
  private renderItem(item: LegendItem): string {
    const shape = item.shape || 'square';
    let symbol = '';

    switch (shape) {
      case 'circle':
        symbol = `<span class="legend-symbol circle" style="background:${escapeHtml(item.color)}"></span>`;
        break;
      case 'line':
        symbol = `<span class="legend-symbol line" style="background:${escapeHtml(item.color)}"></span>`;
        break;
      case 'icon':
        if (item.icon) {
          symbol = `<span class="legend-symbol icon">${escapeHtml(item.icon)}</span>`;
        } else {
          symbol = `<span class="legend-symbol square" style="background:${escapeHtml(item.color)}"></span>`;
        }
        break;
      default:
        symbol = `<span class="legend-symbol square" style="background:${escapeHtml(item.color)}"></span>`;
    }

    return `<div class="legend-item">${symbol}<span class="legend-label">${escapeHtml(item.label)}</span></div>`;
  }

  /**
   * Extract legend items from layers
   */
  private extractItems(layers: Layer[]): LegendItem[] {
    return layers
      .filter((l) => l.legend && typeof l.legend === 'object')
      .map((l) => l.legend as LegendItem);
  }

}
