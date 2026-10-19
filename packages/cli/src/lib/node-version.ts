/**
 * @file The Node.js version the CLI needs
 *
 * @remarks
 * The CLI needs Node.js 20.9 or newer: sharp 0.35 (sprite rasterising in
 * `emit`/`bake`, and the security fixes in its libvips/libheif/librsvg) does
 * not load on older Node. npm only prints an easy-to-miss `EBADENGINE`
 * warning when installing on Node 18, and `npx` shows nothing at all, so
 * the CLI says it itself, in one clear line, before doing anything else.
 */

/** The oldest Node.js the CLI runs on. Keep in step with package.json `engines`. */
export const MIN_NODE = "20.9.0";

function parts(version: string): [number, number, number] {
  const [major = 0, minor = 0, patch = 0] = version
    .replace(/^v/, "")
    .split(".")
    .map((n) => Number.parseInt(n, 10) || 0);
  return [major, minor, patch];
}

/** Whether `version` (e.g. `"v18.20.8"`) is at least `min`. */
export function nodeAtLeast(version: string, min: string = MIN_NODE): boolean {
  const a = parts(version);
  const b = parts(min);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!;
  return true;
}

/** The message for a Node.js that is too old, or `null` when it is fine. */
export function nodeVersionProblem(version: string): string | null {
  if (nodeAtLeast(version)) return null;
  return (
    `maplibre-yaml needs Node.js ${MIN_NODE.replace(/\.0$/, "")} or newer, but this is Node.js ${version.replace(/^v/, "")}.\n` +
    `Install the current LTS version from https://nodejs.org/ (or run "nvm install --lts"), ` +
    `then run the command again. Your maps themselves don't need Node: only this command line does.`
  );
}
