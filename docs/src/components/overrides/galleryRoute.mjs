import { entryForSlug } from '../../data/gallery.mjs';

/**
 * The gallery entry for the page being rendered, or undefined when the page
 * isn't a gallery page. A gallery page with no entry in src/data/gallery.mjs
 * fails the build, so a new page can't ship without its index row and links.
 */
export function galleryEntry(route) {
  const m = route.id.match(/^examples\/gallery\/([^/]+?)\/?$/);
  if (!m || m[1] === 'index') return undefined;
  const entry = entryForSlug(m[1]);
  if (!entry) {
    throw new Error(
      `Gallery page "${m[1]}" has no entry in docs/src/data/gallery.mjs. Add it to its group there.`,
    );
  }
  return entry;
}
