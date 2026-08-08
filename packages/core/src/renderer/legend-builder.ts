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

    let html = '<div class="maplibre-legend">';
    if (config?.title) {
      html += `<div class="legend-title">${escapeHtml(config.title)}</div>`;
    }
    html += '<div class="legend-items">';
    for (const item of items) {
      html += this.renderItem(item);
    }
    html += '</div></div>';

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
