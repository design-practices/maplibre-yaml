/**
 * @file Colour-string checks shared by the colour schema and the runtime
 * notice
 * @module @maplibre-yaml/core/schemas/css-colors
 */

import { suggest } from "../utils/suggest";

/**
 * The CSS named colours — exactly the set maplibre-gl's colour parser
 * accepts (plus `transparent`, which it special-cases).
 */
export const CSS_COLOR_NAMES: ReadonlySet<string> = new Set(
  (
    "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond " +
    "blue blueviolet brown burlywood cadetblue chartreuse chocolate coral " +
    "cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray " +
    "darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid " +
    "darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey " +
    "darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue " +
    "firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod " +
    "gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki " +
    "lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan " +
    "lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon " +
    "lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue " +
    "lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue " +
    "mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen " +
    "mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin " +
    "navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod " +
    "palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum " +
    "powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon " +
    "sandybrown seagreen seashell sienna silver skyblue slateblue slategray " +
    "slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet " +
    "wheat white whitesmoke yellow yellowgreen transparent"
  ).split(" ")
);

/** Curly quotation marks pasted from a word processor or slides. */
const CURLY_QUOTES = /^[“”‘’„«»]|[“”‘’«»]$/;

/** Strip curly quotes from both ends of a value. */
function stripCurlyQuotes(value: string): string {
  return value.replace(/^[“”‘’„«»]+|[“”‘’«»]+$/g, "");
}

/**
 * The nearest CSS colour name to `value` (`bleu` → `blue`), or `undefined`.
 */
export function suggestColorName(value: string): string | undefined {
  return suggest(value.trim().toLowerCase(), CSS_COLOR_NAMES);
}

/**
 * Why `value` is not a usable colour string, or `null` when it is one.
 *
 * @remarks
 * Hex, `rgb()`/`rgba()` and `hsl()`/`hsla()` are checked for shape, as
 * before. A bare word must now be a real CSS colour name: maplibre-gl rejects
 * anything else at runtime and drops the whole layer, which a student sees
 * as "my data doesn't show" with the reason only on the console (ml-aot.15).
 * Other functional notations (`var(--accent)`, `oklch()`, …) pass, since the
 * same schema types CSS-only fields (legend swatches, marker pins) where they
 * are valid.
 */
export function colorProblem(value: string): string | null {
  if (CURLY_QUOTES.test(value)) {
    const inner = stripCurlyQuotes(value);
    return (
      `Curly quotes (“ ”) are not YAML quotes, so they became part of the colour: ${value}. ` +
      `Retype them as straight quotes: "${inner}"`
    );
  }

  const v = value.trim().toLowerCase();
  if (v.startsWith("#")) {
    return /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(v)
      ? null
      : "Invalid color format. Use hex (#rgb, #rrggbb), rgb(), rgba(), hsl(), hsla(), or named colors.";
  }
  if (v.startsWith("rgb")) {
    return /^rgba?\s*\([^)]+\)$/.test(v)
      ? null
      : "Invalid color format. Use hex (#rgb, #rrggbb), rgb(), rgba(), hsl(), hsla(), or named colors.";
  }
  if (v.startsWith("hsl")) {
    return /^hsla?\s*\([^)]+\)$/.test(v)
      ? null
      : "Invalid color format. Use hex (#rgb, #rrggbb), rgb(), rgba(), hsl(), hsla(), or named colors.";
  }
  if (CSS_COLOR_NAMES.has(v) || v === "currentcolor") return null;
  // Other CSS functional notations (var(), oklch(), color-mix(), …).
  if (/^[a-z-]+\(.*\)$/.test(v)) return null;

  const hint = suggestColorName(v);
  return (
    `"${value}" is not a colour name.` +
    (hint ? ` Did you mean "${hint}"?` : "") +
    ' Use a CSS colour name (red, steelblue), a hex code ("#ff0000"), rgb() or hsl().'
  );
}
