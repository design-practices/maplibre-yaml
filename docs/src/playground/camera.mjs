/**
 * Keeping the camera across edits (design D4). Re-rendering a document
 * rebuilds the map; without this, every edit would throw the reader back to
 * the document's opening view. The camera stays where the reader left it,
 * unless the edit itself changed the view: then the author is editing the
 * view, and the new view wins.
 */

/** The `config:` keys that set where the map opens. */
export const CAMERA_KEYS = ["center", "zoom", "bearing", "pitch", "bounds", "fitTo"];

/** A string that changes exactly when the document's view changes. */
export function cameraKey(doc) {
  const c = doc && typeof doc === "object" && doc.config && typeof doc.config === "object" ? doc.config : {};
  return JSON.stringify(CAMERA_KEYS.map((k) => c[k] ?? null));
}

/**
 * The document with the live camera written into `config:`, and the keys
 * that would move it (`bounds`, `fitTo`) dropped. Returns a copy.
 *
 * @param {any} doc the document parsed to plain values
 * @param {{ center: [number, number], zoom: number, bearing: number, pitch: number }} camera
 */
export function withCamera(doc, camera) {
  const config = { ...(doc.config ?? {}) };
  config.center = [round(camera.center[0], 6), round(camera.center[1], 6)];
  config.zoom = round(camera.zoom, 3);
  config.bearing = round(camera.bearing, 2);
  config.pitch = round(camera.pitch, 2);
  delete config.bounds;
  delete config.fitTo;
  return { ...doc, config };
}

function round(n, digits) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
