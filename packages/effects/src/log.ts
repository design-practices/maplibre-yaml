/**
 * @file Warn-once logging
 * @module @maplibre-yaml/effects
 */

const seen = new Set<string>();

/** `console.warn` a message at most once per page. */
export function warnOnce(message: string): void {
  if (seen.has(message)) return;
  seen.add(message);
  console.warn(message);
}

/** Test seam. @internal */
export function resetWarnings(): void {
  seen.clear();
}
