/**
 * @file The `!html` tag and its trust-gated rendering
 * @module @maplibre-yaml/core/tests/parser
 *
 * @description
 * Two halves: the tag resolves to a structural marker at parse (never a sniffed
 * string), and the marker renders as markup only when the capability policy
 * permits it. The default is deny, so a host that configures nothing is safe.
 */

import { describe, it, expect } from "vitest";
import { YAMLParser } from "../../src/parser/yaml-parser";
import { PopupBuilder } from "../../src/renderer/popup-builder";
import { isHtmlMarker, html } from "../../src/utils/html";

describe("the !html tag resolves to a structural marker", () => {
  it("wraps a tagged value in { $html }", () => {
    const result = YAMLParser.safeParseMapBlock(`
type: map
id: m
config: { center: [0, 0], zoom: 5 }
layers:
  - id: a
    type: circle
    source: s
    interactive:
      click:
        popup:
          - p:
              - str: !html "<b>Bold</b>"
`);
    expect(result.success).toBe(true);
    const layers = result.data!.layers as any[];
    const str = layers[0].interactive.click.popup[0].p[0].str;
    expect(isHtmlMarker(str)).toBe(true);
    expect(str).toEqual({ $html: "<b>Bold</b>" });
  });

  it("leaves a plain string a plain string", () => {
    const result = YAMLParser.safeParseMapBlock(`
type: map
id: m
config: { center: [0, 0], zoom: 5 }
layers:
  - id: a
    type: circle
    source: s
    interactive:
      click:
        popup:
          - p:
              - str: "just text"
`);
    expect(result.success).toBe(true);
    const str = (result.data!.layers as any[])[0].interactive.click.popup[0].p[0].str;
    expect(isHtmlMarker(str)).toBe(false);
    expect(str).toBe("just text");
  });
});

describe("the marker renders gated by the policy", () => {
  const content = [{ p: [{ str: html("<b>Bold</b>") }] }] as never;

  it("renders raw markup in a trusted context", () => {
    const out = new PopupBuilder({ trust: "trusted" }).build(content, {});
    expect(out).toBe("<p><b>Bold</b></p>");
  });

  it("escapes it in an untrusted context", () => {
    const out = new PopupBuilder({ trust: "untrusted" }).build(content, {});
    expect(out).toBe("<p>&lt;b&gt;Bold&lt;/b&gt;</p>");
  });

  it("defaults to deny when constructed with no policy", () => {
    const out = new PopupBuilder().build(content, {});
    expect(out).not.toContain("<b>");
    expect(out).toContain("&lt;b&gt;");
  });

  it("honors an explicit allowHtml opt-in even when untrusted", () => {
    const out = new PopupBuilder({ trust: "untrusted", allowHtml: true }).build(content, {});
    expect(out).toBe("<p><b>Bold</b></p>");
  });

  it("still escapes a plain string regardless of policy", () => {
    const plain = [{ p: [{ str: "<b>not marked</b>" }] }] as never;
    const out = new PopupBuilder({ trust: "trusted" }).build(plain, {});
    expect(out).toBe("<p>&lt;b&gt;not marked&lt;/b&gt;</p>");
  });
});
