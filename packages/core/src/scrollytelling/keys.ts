/**
 * @file Map-level keys a story shares with a `type: map` document
 * @module @maplibre-yaml/core/scrollytelling
 *
 * @remarks
 * Its own module, free of zod, so both the schema and the DOM-free engine
 * can import it without the engine pulling the validator in.
 */

/**
 * Map-level keys a story shares with a `type: map` document, in the order
 * `storyMapDocument` hands them to the story's `<ml-map>`.
 *
 * @remarks
 * A story's map used to be built from `config:` + `layers:` only, so these
 * keys were rejected as unknown (ml-t2x). `ScrollytellingBlockSchema` takes
 * their schemas straight from `MapBlockSchema`, so the two documents can
 * never disagree about them.
 */
export const STORY_MAP_KEYS = [
  "sources",
  "controls",
  "legend",
  "state",
  "parameters",
  "markers",
  "popups",
  "images",
  "terrain",
  "sky",
  "projection",
  "light",
] as const;
