/**
 * Workstream A assertion: global config inheritance actually reaches built maps.
 *
 * Previously the astro builders hardcoded `zoom ?? 12`, so defaultZoom could
 * never apply, and resolveMapConfig's result was force-cast.
 *
 * Run from examples/verification:  pnpm verify:inheritance
 * PASS = "ALL CHECKS PASSED" and exit code 0.
 */
import {
  buildPointMapConfig,
  buildPolygonMapConfig,
} from "@maplibre-yaml/astro/utils";
import { ConfigResolutionError, type GlobalConfig } from "@maplibre-yaml/core";

const globalConfig: GlobalConfig = {
  theme: "light",
  defaultMapStyle: "https://demotiles.maplibre.org/style.json",
  defaultZoom: 8,
  defaultCenter: [-73.0, 41.0],
};

const location = { coordinates: [-74.006, 40.7128] as [number, number] };
const region = {
  coordinates: [
    [
      [-74.02, 40.7],
      [-73.98, 40.7],
      [-73.98, 40.73],
      [-74.02, 40.73],
      [-74.02, 40.7],
    ],
  ] as [number, number][][],
  name: "Test region",
};

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "  ok" : "FAIL"}  ${name}  (got ${JSON.stringify(actual)})`);
  if (!pass) failures++;
}

// 1. defaultZoom inherits when nothing else provides zoom (the bug: was always 12)
check(
  "point map inherits defaultZoom 8",
  buildPointMapConfig({ location }, globalConfig).config.zoom,
  8,
);
check(
  "polygon map inherits defaultZoom 8",
  buildPolygonMapConfig({ region }, globalConfig).config.zoom,
  8,
);

// 2. Explicit zoom still beats the global default
check(
  "explicit zoom 15 beats defaultZoom",
  buildPointMapConfig({ location, zoom: 15 }, globalConfig).config.zoom,
  15,
);

// 3. defaultMapStyle inherits
check(
  "mapStyle inherits defaultMapStyle",
  buildPointMapConfig({ location }, globalConfig).config.mapStyle,
  globalConfig.defaultMapStyle,
);

// 4. Without a global config, the old built-in default is unchanged
check(
  "no globalConfig -> built-in zoom 12 (behavior unchanged)",
  buildPointMapConfig({
    location,
    mapStyle: "https://demotiles.maplibre.org/style.json",
  }).config.zoom,
  12,
);

// 5. Missing mapStyle everywhere throws ConfigResolutionError (no silent fallback)
try {
  buildPointMapConfig({ location });
  console.log("FAIL  missing mapStyle everywhere should throw");
  failures++;
} catch (e) {
  check(
    "missing mapStyle throws ConfigResolutionError",
    e instanceof ConfigResolutionError,
    true,
  );
}

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nALL CHECKS PASSED");
