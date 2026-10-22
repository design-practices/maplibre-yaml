/**
 * The example map documents under public/configs/, as text, and excerpts cut
 * from them. Example pages show the YAML through these rather than as
 * hand-copied fences, so what a page shows is always the file its live map
 * loads.
 */
const RAW = import.meta.glob("../../../public/configs/**/*.yaml", {
  query: "?raw",
  import: "default",
  eager: true,
});

/** The text of public/configs/<name>, e.g. "basic-map.yaml". */
export function configText(name) {
  const key = `../../../public/configs/${name}`;
  if (!(key in RAW)) throw new Error(`No example document public/configs/${name}`);
  return RAW[key];
}

const indentOf = (line) => line.match(/^ */)[0].length;
const blank = (line) => line.trim() === "";

/** Index one past the last line of the block that starts at line `i`. */
function blockEnd(lines, i) {
  const indent = indentOf(lines[i]);
  const isKey = /:\s*(#.*)?$/.test(lines[i].trim());
  let j = i + 1;
  for (; j < lines.length; j++) {
    const line = lines[j];
    if (blank(line)) continue;
    const k = indentOf(line);
    if (k > indent) continue;
    // A sequence written at its key's own indent belongs to the key.
    if (k === indent && isKey && !lines[i].trim().startsWith("- ") && line.trim().startsWith("- ")) continue;
    break;
  }
  while (j > i + 1 && blank(lines[j - 1])) j--;
  return j;
}

/**
 * Cut one block out of a YAML document. `at` is a path of line starts, each
 * searched for inside the block of the one before it: ["- id: cities",
 * "circle-radius:"] is the `circle-radius:` block of the `cities` layer.
 * Throws when a step isn't found, so a page can't show an excerpt of
 * something its document no longer has. Comments come along.
 */
export function excerpt(text, at) {
  const lines = text.split("\n");
  let from = 0;
  let to = lines.length;
  let found = -1;
  for (const step of at) {
    found = -1;
    for (let i = from; i < to; i++) {
      if (lines[i].trim().startsWith(step)) {
        found = i;
        break;
      }
    }
    if (found < 0) throw new Error(`excerpt: no line starting "${step}" (path ${JSON.stringify(at)})`);
    from = found + 1;
    to = blockEnd(lines, found);
  }
  const block = lines.slice(found, to);
  const cut = indentOf(block[0]);
  return block.map((l) => l.slice(Math.min(cut, indentOf(l)))).join("\n");
}
