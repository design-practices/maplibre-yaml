/**
 * @file Build-time eject for the classics launch page (U11).
 *
 * The page at /classics/ shows each classic twice: live in `<ml-map>` with
 * the effects package, and ejected in vanilla maplibre-gl. The ejected pane
 * is only an honest claim if it runs the artifact `mlym emit` actually
 * produces for the document the page links — not a hand-copied style. So
 * this runs the real CLI, `mlym emit --with-fallbacks`, on every docs dev
 * start and build, into `docs/public/classics/<name>/ejected/` (git-ignored,
 * generate-on-build like the agent assets):
 *
 *   style.json                        the emitted style
 *   mlym.json, mlym.png, mlym@2x.*    its sprite (the document's images)
 *
 * The CLI runs through mlym-offline.mjs, which serves the site's own origin
 * from docs/public (the files this build deploys) so the build needs no
 * network. docs/test/classics-eject.test.mjs re-runs emit from scratch and
 * fails unless the shipped files are byte-identical.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
export const DOCS_ROOT = join(SCRIPTS, "..");
export const CLASSICS_DIR = join(DOCS_ROOT, "public", "classics");
export const MLYM_OFFLINE = join(SCRIPTS, "mlym-offline.mjs");
export const SITE = "https://docs.maplibre-yaml.org";

/** The launch page's classics, in page order (Amendment A1, D-A5). */
export const CLASSICS = ["crosshatch", "blueprint"];

/** The exact `mlym` arguments that produce one classic's ejected pane. */
export function emitArgs(name, outDir = join(CLASSICS_DIR, name, "ejected")) {
  return [
    "emit",
    join(CLASSICS_DIR, `${name}.yaml`),
    "--with-fallbacks",
    "--out",
    join(outDir, "style.json"),
    "--sprite-base",
    `${SITE}/classics/${name}/ejected`,
  ];
}

/**
 * Run `mlym emit` for one classic. Returns the CLI's combined output (its
 * warnings included); throws with that output if the CLI exits non-zero.
 */
export function emitClassic(name, outDir) {
  const run = spawnSync(process.execPath, [MLYM_OFFLINE, ...emitArgs(name, outDir)], {
    encoding: "utf8",
  });
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  if (run.status !== 0) {
    throw new Error(`mlym emit ${name} exited ${run.status}:\n${output}`);
  }
  return output;
}

/** Regenerate every classic's ejected pane (the Astro build hook). */
export function generateClassicsEject() {
  for (const name of CLASSICS) {
    const out = join(CLASSICS_DIR, name, "ejected");
    // Start clean: a stale sprite file from an older emit must not ship.
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    emitClassic(name, out);
  }
  console.log(`[docs] classics: emitted ${CLASSICS.join(", ")} with mlym emit --with-fallbacks`);
}
