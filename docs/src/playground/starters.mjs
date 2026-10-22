/**
 * The playground's starters (design D5, Q7): a short hand-picked list, then
 * every gallery page whose map is pure YAML, generated from the gallery's
 * one list (src/data/gallery.mjs). A starter is a path under /configs/, the
 * very file its docs page renders, loaded with `?src=`; nothing is copied.
 * docs/test/playground.test.mjs checks that every path exists and that
 * every starter but "Find the mistakes" validates.
 */
import { GROUPS } from "../data/gallery.mjs";

/** Hand-picked, in the order a newcomer would open them. */
export const CURATED = [
  {
    title: "Earthquakes, sized by magnitude",
    src: "/configs/earthquakes.yaml",
    why: "The map from Your first map, explained: live data, styling and a popup.",
  },
  {
    title: "Cities written in the document",
    src: "/configs/basic-map.yaml",
    why: "Points written as GeoJSON inside the document, no data file.",
  },
  {
    title: "World cities with a legend",
    src: "/configs/classify/graduated.yaml",
    why: "classify: colours and sizes each city by population, and draws the legend.",
  },
  {
    title: "A story map",
    src: "/configs/gallery/fly-to-a-location-based-on-scroll-position.yaml",
    why: "Chapters that move the map as you scroll.",
  },
  {
    title: "Find the mistakes",
    src: "/configs/playground/find-the-mistakes.yaml",
    why: "A map with three mistakes to fix, with the editor's help.",
    broken: true,
  },
];

/** What the playground opens with no link, share or saved draft. */
export const DEFAULT_SRC = CURATED[0].src;

/**
 * The gallery's pure-YAML pages, by group, in index order.
 * @returns {{ title: string, starters: { title: string, src: string, slug: string }[] }[]}
 */
export function galleryStarters() {
  return GROUPS.map((group) => ({
    title: group.title,
    starters: group.entries
      .filter((e) => e.slug && e.kind === "yaml")
      .map((e) => ({ title: e.title, slug: e.slug, src: `/configs/gallery/${e.slug}.yaml` })),
  })).filter((g) => g.starters.length > 0);
}

/** The playground link for a docs config path. */
export function playgroundHref(src) {
  return `/playground/?src=${encodeURIComponent(src).replace(/%2F/g, "/")}`;
}
