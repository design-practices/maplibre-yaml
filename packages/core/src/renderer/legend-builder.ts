/**
 * @file Legend builder for map layers
 * @module @maplibre-yaml/core/renderer
 */

import type { z } from 'zod';
import { LayerSchema, LegendConfigSchema, LegendItemSchema } from '../schemas';
import { escapeHtml } from '../utils/html';
import { defaultStrings, type Strings } from '../i18n';

/**
 * Inline base styles, matching the params panel's box. Core ships no
 * stylesheet, so without these the legend rendered as bare text and every
 * swatch was a 0x0 span. Inline (not a stylesheet) for the same reason the
 * params panel is: nothing to load, and an author `slot="legend"` replaces it.
 */
const LEGEND_BOX_STYLE =
  'display:block;background:rgba(255,255,255,0.95);border-radius:4px;' +
  'box-shadow:0 1px 4px rgba(0,0,0,0.3);padding:8px 12px;' +
  'font:12px/1.5 system-ui,sans-serif;color:#333;min-width:140px;';

const SYMBOL_STYLE = {
  circle: 'display:inline-block;flex:none;width:12px;height:12px;border-radius:50%;',
  square: 'display:inline-block;flex:none;width:12px;height:12px;border-radius:2px;',
  line: 'display:inline-block;flex:none;width:16px;height:3px;border-radius:2px;',
} as const;

type Layer = z.infer<typeof LayerSchema>;
type LegendConfig = z.infer<typeof LegendConfigSchema>;
type LegendItem = z.infer<typeof LegendItemSchema>;

/**
 * The author's `legend.title`, as a heading inside the panel — or `""` when
 * there is none, or it only repeats the toggle ("Legend", or the toggle's
 * translation), which would read "Legend / Legend".
 */
export function legendHeadingText(title: unknown, strings: Strings = defaultStrings): string {
  if (typeof title !== 'string') return '';
  const text = title.trim();
  if (!text) return '';
  const lower = text.toLowerCase();
  if (lower === 'legend' || lower === strings('maplibre-yaml.Legend.Title').trim().toLowerCase()) return '';
  return text;
}

/** Options for {@link LegendBuilder}. */
export interface LegendBuilderOptions {
  /** The document's UI strings (the toggle reads `maplibre-yaml.Legend.Title`). */
  strings?: Strings;
}

/**
 * Builds legend HTML from layer configurations
 */
export class LegendBuilder {
  private readonly strings: Strings;

  constructor(options: LegendBuilderOptions = {}) {
    this.strings = options.strings ?? defaultStrings;
  }

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
    // with no implementation — ml-tfd.8 contract audit): `collapsed: true`
    // starts closed, default stays fully visible. The toggle always says what
    // it is — "Legend", or its translation (`maplibre-yaml.Legend.Title`) —
    // as a story's legend button does (0.9): a screen reader announces
    // "Legend, expanded" whatever the author titled it. The author's
    // `title:` heads the panel instead.
    const heading = legendHeadingText(config?.title, this.strings);
    let html = `<details class="maplibre-legend" style="${LEGEND_BOX_STYLE}"${config?.collapsed ? "" : " open"}>`;
    html += `<summary class="legend-title" style="cursor:pointer;font-weight:600;">${escapeHtml(this.strings('maplibre-yaml.Legend.Title'))}</summary>`;
    if (heading) {
      html += `<div class="legend-heading" style="font-weight:600;margin-top:4px;">${escapeHtml(heading)}</div>`;
    }
    html += '<div class="legend-items">';
    for (const item of items) {
      html += this.renderItem(item);
    }
    html += '</div></details>';

    el.innerHTML = html;
  }

  /**
   * The legend's entries: the block's own `items:`, else every layer's
   * `legend:` field. Empty when there is nothing to show.
   */
  entries(layers: Layer[], config?: Partial<LegendConfig>): LegendItem[] {
    return config?.items || this.extractItems(layers);
  }

  /**
   * The entries' markup (swatch + label each), without the box or a title:
   * for a host that puts them in its own panel (a story's pinned legend).
   */
  itemsHTML(items: LegendItem[]): string {
    return `<div class="legend-items">${items.map((item) => this.renderItem(item)).join('')}</div>`;
  }

  /**
   * Render a single legend item
   */
  private renderItem(item: LegendItem): string {
    const shape = item.shape || 'square';
    let symbol = '';

    const swatch = (kind: 'circle' | 'line' | 'square') =>
      `<span class="legend-symbol ${kind}" style="background:${escapeHtml(item.color)};${SYMBOL_STYLE[kind]}"></span>`;

    switch (shape) {
      case 'circle':
        symbol = swatch('circle');
        break;
      case 'line':
        symbol = swatch('line');
        break;
      case 'icon':
        if (item.icon) {
          symbol = `<span class="legend-symbol icon">${escapeHtml(item.icon)}</span>`;
        } else {
          symbol = swatch('square');
        }
        break;
      default:
        symbol = swatch('square');
    }

    return `<div class="legend-item" style="display:flex;align-items:center;gap:6px;margin-top:4px;">${symbol}<span class="legend-label">${escapeHtml(item.label)}</span></div>`;
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
