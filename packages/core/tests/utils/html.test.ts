/**
 * @file Tests for the shared HTML escaping and URL guards
 * @module @maplibre-yaml/core/tests/utils/html
 */

import { describe, it, expect } from 'vitest';
import {
  escapeHtml,
  safeUrl,
  POPUP_TAGS,
  LINK_TARGETS,
} from '../../src/utils/html';

describe('escapeHtml', () => {
  it('escapes the five characters that matter in markup', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('escapes quotes, so the result is safe in attribute position', () => {
    // The `<ml-map>` error card used `div.textContent`, which leaves quotes
    // intact -- fine between tags, an attribute break anywhere else.
    const payload = '" onmouseover="alert(1)';
    const attr = `<a title="${escapeHtml(payload)}">x</a>`;
    // `onmouseover=` survives as inert text; what matters is that the quotes
    // closing the attribute are gone, so it can never become a live handler.
    expect(escapeHtml(payload)).not.toContain('"');
    expect(attr).toBe('<a title="&quot; onmouseover=&quot;alert(1)">x</a>');
  });

  it('does not double-escape an ampersand', () => {
    // Chained .replace() calls get this wrong unless `&` runs first.
    expect(escapeHtml('a&lt;b')).toBe('a&amp;lt;b');
  });

  it('neutralizes a script payload', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;'
    );
  });

  it('coerces non-strings rather than throwing', () => {
    expect(escapeHtml(42)).toBe('42');
    expect(escapeHtml(null)).toBe('null');
    expect(escapeHtml(undefined)).toBe('undefined');
  });

  it('works without a DOM', () => {
    // Guards the regression where this depended on document.createElement and
    // therefore could not run during SSR or in Node.
    expect(typeof escapeHtml('<x>')).toBe('string');
  });
});

describe('safeUrl', () => {
  describe.each([
    'https://example.com/x',
    'http://example.com/x',
    'mailto:someone@example.com',
    'tel:+15551234567',
  ])('allows safe absolute scheme %s', (url) => {
    it('returns it unchanged', () => {
      expect(safeUrl(url)).toBe(url);
    });
  });

  describe.each([
    '/data/x.geojson',
    './x.png',
    '../shared/y.png',
    'images/z.png',
    '#section',
    '?query=1',
  ])('allows scheme-less reference %s', (url) => {
    it('returns it unchanged', () => {
      expect(safeUrl(url)).toBe(url);
    });
  });

  describe.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
  ])('rejects %s', (url) => {
    it('returns null', () => {
      expect(safeUrl(url)).toBeNull();
    });
  });

  // Browsers strip tabs and newlines before resolving the scheme, so a guard
  // that only matched the literal string would wave these straight through.
  describe.each([
    ['tab inside scheme', 'java\tscript:alert(1)'],
    ['newline inside scheme', 'java\nscript:alert(1)'],
    ['carriage return inside scheme', 'java\rscript:alert(1)'],
    ['NUL inside scheme', 'java\u0000script:alert(1)'],
    ['leading whitespace', '   javascript:alert(1)'],
  ])('rejects %s', (_name, url) => {
    it('returns null', () => {
      expect(safeUrl(url)).toBeNull();
    });
  });

  it('rejects an empty or whitespace-only URL', () => {
    expect(safeUrl('')).toBeNull();
    expect(safeUrl('   ')).toBeNull();
  });

  it('preserves an internal space rather than rewriting the path', () => {
    // Browsers percent-encode an internal space; stripping it would silently
    // point at a different file.
    expect(safeUrl('/my file.png')).toBe('/my file.png');
  });
});

describe('allowlists', () => {
  it('covers the tags the popup docs advertise', () => {
    for (const tag of ['h1', 'h3', 'p', 'span', 'div', 'strong', 'em', 'a', 'img', 'ul', 'li']) {
      expect(POPUP_TAGS.has(tag)).toBe(true);
    }
  });

  it('excludes script-bearing and frame elements', () => {
    for (const tag of ['script', 'iframe', 'object', 'embed', 'style', 'link']) {
      expect(POPUP_TAGS.has(tag)).toBe(false);
    }
  });

  it('accepts only the four legal link targets', () => {
    expect([...LINK_TARGETS].sort()).toEqual(['_blank', '_parent', '_self', '_top']);
  });
});
