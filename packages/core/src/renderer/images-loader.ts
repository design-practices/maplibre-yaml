/**
 * @file Live `images:` — load named images before layers (U6, R9)
 * @module @maplibre-yaml/core/renderer
 *
 * @description
 * The runtime half of the images construct: each declared image is fetched
 * and registered via `map.addImage(name, ...)` BEFORE layers are added, so a
 * symbol layer's `icon-image: name` (or a `*-pattern` reference) resolves on
 * first render. URLs pass the same `safeUrl` scheme gate as popup images and
 * marker icons.
 *
 * Loading uses a plain `HTMLImageElement` (with `crossOrigin = "anonymous"`
 * so the texture upload isn't tainted) rather than `map.loadImage`, whose
 * callback-vs-promise signature drifted across the supported maplibre-gl
 * peer range (^3 || ^4 || ^5). `addImage` accepts the element directly on
 * every supported version.
 *
 * Density (ml-aot.139): an image declared denser than the screen — say a
 * `pixelRatio: 4` hatch on a DPR-2 display — is area-averaged down to the
 * screen's ratio before `addImage`. MapLibre samples its pattern and icon
 * atlas bilinearly with no mipmaps, so an image drawn more than ~1.5x
 * minified aliases: thin strokes break into dots and crawl or blink as the
 * map pans and zooms. The exported style never had the problem — `mlym
 * emit` resamples its sprite to @1x/@2x — so this gives the live document
 * the same pixels the export gets. SDF images are passed through untouched.
 *
 * Failure posture (ml-blj): a missing or refused image warns once per name
 * and the document keeps rendering — the layer simply draws without the
 * icon, exactly what MapLibre itself does for an unknown image reference.
 * Unknown names referenced by layers surface through the renderer's
 * `styleimagemissing` warn-once handler, not here.
 */

import type { Map as MapLibreMap } from "maplibre-gl";
import { safeUrl } from "../utils/html";
import type { ImageConfig } from "../schemas/map.schema";

/**
 * How long one image may take before the document stops waiting for it.
 * Layer adds (and therefore the `load` event and `mapReady()`) queue behind
 * image loading, so an unresponsive image host must not hang the document —
 * on timeout the image is treated exactly like a failed load.
 */
export const IMAGE_LOAD_TIMEOUT_MS = 10_000;

/** Options `map.addImage` understands, drawn from the declaration. */
function addImageOptions(config: ImageConfig): Record<string, unknown> {
  if (typeof config === "string") return {};
  return {
    ...(config.sdf !== undefined ? { sdf: config.sdf } : {}),
    ...(config.pixelRatio !== undefined ? { pixelRatio: config.pixelRatio } : {}),
  };
}

/**
 * The whole-number pixel ratio to prepare images for: the screen's device
 * pixel ratio, rounded (so at worst an image is drawn ~1.33x minified, at
 * DPR 1.5), and never below 1.
 */
export function displayPixelRatio(): number {
  const dpr = typeof devicePixelRatio === "number" && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.max(1, Math.round(dpr));
}

/**
 * Area-average (box-filter) resample of straight-alpha RGBA pixels to a
 * smaller size, averaging in premultiplied alpha so transparent texels do
 * not darken their neighbours. Any ratio, integer or not.
 */
export function downsampleRGBA(
  src: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  outWidth: number,
  outHeight: number
): Uint8Array {
  // per output column (row): the source columns (rows) it covers, with weights
  const spans = (from: number, to: number) => {
    const f = from / to;
    const out: Array<Array<[number, number]>> = [];
    for (let o = 0; o < to; o++) {
      const a = o * f, b = (o + 1) * f;
      const taps: Array<[number, number]> = [];
      for (let i = Math.floor(a); i < Math.min(from, Math.ceil(b)); i++) {
        const w = Math.min(b, i + 1) - Math.max(a, i);
        if (w > 0) taps.push([i, w / f]);
      }
      out.push(taps);
    }
    return out;
  };
  const cols = spans(width, outWidth);
  const rows = spans(height, outHeight);
  // horizontal pass into premultiplied floats
  const mid = new Float64Array(outWidth * height * 4);
  for (let y = 0; y < height; y++) {
    for (let ox = 0; ox < outWidth; ox++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (const [x, w] of cols[ox]!) {
        const i = (y * width + x) * 4;
        const al = (src[i + 3]! / 255) * w;
        r += src[i]! * al;
        g += src[i + 1]! * al;
        b += src[i + 2]! * al;
        a += al;
      }
      const o = (y * outWidth + ox) * 4;
      mid[o] = r;
      mid[o + 1] = g;
      mid[o + 2] = b;
      mid[o + 3] = a;
    }
  }
  const out = new Uint8Array(outWidth * outHeight * 4);
  for (let oy = 0; oy < outHeight; oy++) {
    for (let ox = 0; ox < outWidth; ox++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (const [y, w] of rows[oy]!) {
        const i = (y * outWidth + ox) * 4;
        r += mid[i]! * w;
        g += mid[i + 1]! * w;
        b += mid[i + 2]! * w;
        a += mid[i + 3]! * w;
      }
      const o = (oy * outWidth + ox) * 4;
      if (a > 0) {
        out[o] = Math.round(r / a);
        out[o + 1] = Math.round(g / a);
        out[o + 2] = Math.round(b / a);
      }
      out[o + 3] = Math.round(a * 255);
    }
  }
  return out;
}

/**
 * The image as MapLibre should get it: unchanged unless it is declared denser
 * than the screen, in which case its pixels resampled to the screen's ratio
 * (same logical size). Falls back to the element when the pixels cannot be
 * read (no 2D canvas, or a tainted image).
 */
function matchDensity(
  img: HTMLImageElement,
  config: ImageConfig
): { image: HTMLImageElement | { width: number; height: number; data: Uint8Array }; pixelRatio?: number } {
  if (typeof config === "string" || config.sdf === true || config.pixelRatio === undefined) return { image: img };
  const target = displayPixelRatio();
  const declared = config.pixelRatio;
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  if (!(declared > target) || !width || !height) return { image: img };
  const outWidth = Math.max(1, Math.round((width * target) / declared));
  const outHeight = Math.max(1, Math.round((height * target) / declared));
  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { image: img };
    ctx.drawImage(img, 0, 0);
    const pixels = ctx.getImageData(0, 0, width, height).data;
    return {
      image: { width: outWidth, height: outHeight, data: downsampleRGBA(pixels, width, height, outWidth, outHeight) },
      // keep the logical (CSS-pixel) size the declaration gave
      pixelRatio: (outWidth * declared) / width,
    };
  } catch {
    return { image: img };
  }
}

/**
 * Load every declared image and register it on the map. Resolves when all
 * images have either registered or failed (never rejects — failures warn).
 */
export function loadDocumentImages(
  map: MapLibreMap,
  images: Record<string, ImageConfig>,
  onImageError?: (name: string, url: string) => void,
  timeoutMs: number = IMAGE_LOAD_TIMEOUT_MS
): Promise<void> {
  const loads = Object.entries(images).map(([name, config]) => {
    const url = typeof config === "string" ? config : config.url;
    const gated = safeUrl(url);
    if (gated === null) {
      console.warn(
        `[maplibre-yaml] Dropping image "${name}" with unsafe URL scheme: ${url}`
      );
      onImageError?.(name, url);
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      let settled = false;
      const settle = () => {
        if (settled) return true;
        settled = true;
        clearTimeout(timer);
        return false;
      };
      const timer = setTimeout(() => {
        if (settle()) return;
        console.warn(
          `[maplibre-yaml] image "${name}" did not load within ${timeoutMs}ms; ` +
            "the document stops waiting for it."
        );
        onImageError?.(name, url);
        resolve();
      }, timeoutMs);

      const img = document.createElement("img");
      img.crossOrigin = "anonymous";
      img.addEventListener("load", () => {
        if (settle()) return;
        try {
          if (map.hasImage(name)) {
            // A basemap sprite icon (or an earlier addImage) already owns
            // this name — live, the existing image wins the shared
            // namespace, while the exported style's mlym:-rewritten
            // references select the document's. Never silent.
            console.warn(
              `[maplibre-yaml] image "${name}" is already registered on the map ` +
                "(basemap sprite?); the document's declaration is shadowed live."
            );
          } else {
            const { image, pixelRatio } = matchDensity(img, config);
            const options = addImageOptions(config);
            if (pixelRatio !== undefined) options["pixelRatio"] = pixelRatio;
            map.addImage(name, image as never, options as never);
          }
        } catch (error) {
          console.warn(`[maplibre-yaml] Could not register image "${name}":`, error);
          onImageError?.(name, url);
        }
        resolve();
      });
      img.addEventListener("error", () => {
        if (settle()) return;
        console.warn(
          `[maplibre-yaml] image "${name}" failed to load from ${url}; ` +
            "layers referencing it render without it. (Images load with " +
            "crossOrigin=anonymous — the host must allow cross-origin access, " +
            "including on every redirect hop.)"
        );
        onImageError?.(name, url);
        resolve();
      });
      img.src = gated;
    });
  });
  return Promise.all(loads).then(() => undefined);
}
