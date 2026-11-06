/**
 * @file Core's stylesheets default their custom properties at zero specificity (ml-uo9.1)
 *
 * @description
 * The docs tell authors to resize a story with plain CSS:
 * `ml-scrollytelling { --ml-scrolly-map-height: calc(100vh - 64px) }`.
 * Astro's `<Scrollytelling>` imports core's `scrollytelling.css` AFTER the
 * site's stylesheets, so a default declared on the same `ml-scrollytelling`
 * selector won on source order and the override did nothing. A default
 * declared under `:where(...)` has zero specificity: any author rule on the
 * element beats it whichever stylesheet loads last. This pins that for every
 * stylesheet core injects or ships, for the documented `--ml-*` properties.
 */

import { describe, it, expect } from "vitest";
import { SCROLLYTELLING_CSS } from "../../src/scrollytelling/styles";
import { defaultStyles } from "../../src/components/styles";
import { loadingStyles } from "../../src/ui/styles";

/**
 * Every innermost rule (inside @media too) that declares a public `--ml-*`
 * custom property. (The unprefixed `--chapter-*`/`--footer-*` theme variables
 * are internal: each theme rule sets them, by specificity, on purpose.)
 */
function customPropertyRules(css: string): { selector: string; props: string[] }[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: { selector: string; props: string[] }[] = [];
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const props = [...m[2]!.matchAll(/(?:^|;)\s*(--ml-[\w-]+)\s*:/g)].map((d) => d[1]!);
    if (props.length > 0) rules.push({ selector: m[1]!.trim(), props });
  }
  return rules;
}

describe.each([
  ["SCROLLYTELLING_CSS (dist/scrollytelling.css)", SCROLLYTELLING_CSS],
  ["<ml-map> default styles", defaultStyles],
  ["loading styles", loadingStyles],
])("%s", (_name, css) => {
  it("declares custom-property defaults only under :where()", () => {
    for (const rule of customPropertyRules(css)) {
      for (const part of rule.selector.split(",")) {
        expect(part.trim(), `${rule.props.join(", ")} defaulted at "${rule.selector}"`).toMatch(/^:where\([^)]*\)$/);
      }
    }
  });
});

describe("SCROLLYTELLING_CSS", () => {
  it("still defaults the story map to 100vh", () => {
    expect(customPropertyRules(SCROLLYTELLING_CSS)).toEqual([
      { selector: ":where(ml-scrollytelling)", props: ["--ml-scrolly-map-height"] },
    ]);
    expect(SCROLLYTELLING_CSS).toMatch(/:where\(ml-scrollytelling\)\s*\{\s*--ml-scrolly-map-height:\s*100vh;\s*\}/);
  });
});
