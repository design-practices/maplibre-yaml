/**
 * @file U12 SPIKE — browser bundle entry (esbuild → dist/spike.js)
 *
 * maplibre-gl stays external: the page's <ml-map> owns the map instance;
 * @deck.gl/maplibre only needs that instance (no runtime maplibre import).
 */
import { parse } from "yaml";
import { attachEffects, toHatchParams } from "./runtime";
import { HatchLayer } from "./hatch-layer";
import { sampleFps, installCounters, idle, gridFeatures } from "./harness";
import { attachCrosshatch, heightExaggeration, DECK_BEFORE, DECK_AFTER } from "./crosshatch-runtime";
import { CrosshatchLayer } from "./crosshatch-layer";
import { attachCrosshatchPost } from "./crosshatch-post";
import { attachCrosshatchCustom, buildTileMesh } from "./crosshatch-custom";

export { parse, attachEffects, toHatchParams, HatchLayer, sampleFps, installCounters, idle, gridFeatures, attachCrosshatch, heightExaggeration, DECK_BEFORE, DECK_AFTER, CrosshatchLayer, attachCrosshatchPost, attachCrosshatchCustom, buildTileMesh };
