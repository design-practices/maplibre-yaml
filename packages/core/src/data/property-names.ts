/**
 * @file The property names a decoded file declares, beside its features (0.9)
 * @module @maplibre-yaml/core/data/property-names
 *
 * @description
 * A GeoParquet source reads only the columns the document uses, so its
 * features carry those properties alone. A hint that suggests a property
 * name ("did you mean …", "the data's properties: …") would then suggest
 * from almost nothing. The reader records the file's own column list (from
 * its footer) against the FeatureCollection it returns; the hint reads it
 * from there. Keyed by the data object, so it follows the data wherever the
 * pipeline hands it and is gone with it.
 */

const declared = new WeakMap<object, readonly string[]>();

/** Record the property names the file behind `data` declares (all of them, read or not). */
export function recordPropertyNames(data: object, names: readonly string[]): void {
  declared.set(data, names);
}

/** The property names the file behind `data` declares, when its reader recorded them. */
export function declaredPropertyNames(data: unknown): readonly string[] | undefined {
  return data !== null && typeof data === "object" ? declared.get(data) : undefined;
}
