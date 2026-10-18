/**
 * @file Did-you-mean helpers
 * @module @maplibre-yaml/core/utils/suggest
 *
 * @description
 * A small hand-rolled Levenshtein (no dependency) and the nearest-match
 * helpers built on it. Standalone so the schemas can use it without importing
 * the parser's validation utilities (which import the schemas).
 */

/**
 * Compute the Levenshtein edit distance between two strings.
 *
 * @remarks
 * Iterative two-row DP, so we do not take on a dependency just for
 * did-you-mean hints.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j]! + 1, // deletion
        curr[j - 1]! + 1, // insertion
        prev[j - 1]! + cost // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length]!;
}

/**
 * Return the closest candidate to `input` within `maxDistance` edits, or
 * `undefined` when nothing is close enough.
 */
export function suggest(
  input: string,
  candidates: Iterable<string>,
  maxDistance = 2
): string | undefined {
  let best: string | undefined;
  let bestDistance = maxDistance + 1;
  for (const candidate of candidates) {
    if (candidate === input) continue;
    const distance = levenshtein(input, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return bestDistance <= maxDistance ? best : undefined;
}

/**
 * British and other common spellings authors type for a key, normalised to
 * the spelling the schemas use. Applied to every part of a hyphenated key, so
 * `circle-colour` reads as `circle-color`.
 */
const SPELLING_VARIANTS: ReadonlyArray<[RegExp, string]> = [
  [/colour/gi, "color"],
  [/centre/gi, "center"],
];

/**
 * Whether `typed` is very likely a misspelling of `intended`: the same key
 * apart from letter case, a British spelling (`centre`, `colour`), or a
 * near-miss short enough relative to the key's length to be a typo rather
 * than a different word.
 *
 * @remarks
 * Stricter than {@link suggest}'s default distance of 2, because a caller
 * uses it to replace a message rather than append a hint — `id` must not
 * "mean" `x`.
 */
export function isLikelyMisspelling(typed: string, intended: string): boolean {
  if (typed === intended) return false;
  const normalised = SPELLING_VARIANTS.reduce(
    (key, [pattern, replacement]) => key.replace(pattern, replacement),
    typed
  );
  if (normalised.toLowerCase() === intended.toLowerCase()) return true;
  const maxDistance = Math.min(2, Math.floor(intended.length / 3));
  return maxDistance > 0 && levenshtein(typed.toLowerCase(), intended.toLowerCase()) <= maxDistance;
}

/**
 * The candidate `typed` is an unambiguous variant of — same key apart from
 * letter case, or a British spelling — or `undefined`.
 *
 * @remarks
 * Safe to use where unknown keys are legitimate (open passthrough objects),
 * because it never guesses from edit distance alone.
 */
export function spellingVariantOf(
  typed: string,
  candidates: Iterable<string>
): string | undefined {
  const normalised = SPELLING_VARIANTS.reduce(
    (key, [pattern, replacement]) => key.replace(pattern, replacement),
    typed
  ).toLowerCase();
  for (const candidate of candidates) {
    if (candidate !== typed && candidate.toLowerCase() === normalised) return candidate;
  }
  return undefined;
}
