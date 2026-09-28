/**
 * @file rehype plugin: explicit heading ids via a trailing `{#id}` marker.
 *
 * The generated YAML reference needs stable, path-shaped anchors
 * (`#config-center`, `#geojson-stream-url`) — the slugs Astro derives from
 * heading text would collide (`url` appears on every source type) and shift
 * whenever a sibling key is added. Raw `<h3 id>` HTML would give stable ids
 * but Astro does not collect raw-HTML headings, so the table of contents came
 * out empty. This plugin lets markdown say `### \`center\` {#config-center}`:
 * it moves the marker into the heading's `id` and strips it from the text.
 * Astro's own heading-id pass keeps an existing id, so the TOC links to it.
 *
 * Only a marker at the very end of a heading is recognised; any other page is
 * unaffected.
 */

const MARKER = /\s*\{#([A-Za-z0-9_-]+)\}\s*$/;

function visit(node, fn) {
  fn(node);
  if (Array.isArray(node.children)) for (const child of node.children) visit(child, fn);
}

export default function rehypeHeadingAnchors() {
  return (tree) => {
    visit(tree, (node) => {
      if (node.type !== "element" || !/^h[1-6]$/.test(node.tagName)) return;
      const last = node.children?.[node.children.length - 1];
      if (!last || last.type !== "text") return;
      const match = MARKER.exec(last.value);
      if (!match) return;
      last.value = last.value.slice(0, match.index);
      if (last.value === "") node.children.pop();
      node.properties = { ...node.properties, id: match[1] };
    });
  };
}
