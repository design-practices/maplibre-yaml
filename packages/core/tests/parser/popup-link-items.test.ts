/**
 * Popup link items validate the way the builder renders them (ml-aot.29).
 *
 * @remarks
 * The builder honoured `target` (allowlisted) and relative `href`s, but the
 * item schema declared neither: `target` logged `Unknown key "target"` on
 * every parse, and a relative `href` such as `/about` failed validation as
 * "Invalid url" even though the builder would render it.
 */
import { describe, it, expect } from "vitest";
import { YAMLParser } from "../../src/parser";

function withPopup(item: string): string {
  return `type: map
id: m
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "https://demotiles.maplibre.org/style.json"
layers:
  - id: p
    type: circle
    source: { type: geojson, url: "https://example.com/d.geojson" }
    interactive:
      click:
        popup:
          - p:
              - ${item}
`;
}

describe("popup link items — validation", () => {
  it.each(["_blank", "_self", "_parent", "_top"])(
    "accepts target: %s without an unknown-key warning",
    (target) => {
      const result = YAMLParser.safeParseMapBlock(
        withPopup(`{ href: "https://example.com", text: "x", target: "${target}" }`)
      );
      expect(result.success).toBe(true);
      expect(result.warnings).toEqual([]);
    }
  );

  it("rejects an unknown target, listing the allowed values", () => {
    const result = YAMLParser.safeParseMapBlock(
      withPopup(`{ href: "https://example.com", text: "x", target: "_new" }`)
    );
    expect(result.success).toBe(false);
    // Reported on the key itself, not collapsed onto the whole layer.
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.path).toBe("layers.0.interactive.click.popup.0.p.0.target");
    expect(result.errors[0]!.message).toBe(
      "target must be one of: _blank, _self, _parent, _top"
    );
    expect(typeof result.errors[0]!.line).toBe("number");
  });

  it("accepts str + href without warnings", () => {
    const result = YAMLParser.safeParseMapBlock(
      withPopup(`{ str: "Wikipedia", href: "https://en.wikipedia.org/wiki/Chicago" }`)
    );
    expect(result.success).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it.each(["/about", "./notes.html", "notes.html", "../index.html", "#top", "mailto:class@example.edu"])(
    "accepts href: %s",
    (href) => {
      const result = YAMLParser.safeParseMapBlock(
        withPopup(`{ href: "${href}", text: "x" }`)
      );
      expect(result.success).toBe(true);
    }
  );

  it("still rejects an href that is neither a URL nor a path", () => {
    const result = YAMLParser.safeParseMapBlock(
      withPopup(`{ href: "not a url", text: "x" }`)
    );
    expect(result.success).toBe(false);
  });
});
