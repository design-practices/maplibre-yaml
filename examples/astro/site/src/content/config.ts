// Astro 4 only reads its content config from here; Astro 5+ prefer
// src/content.config.ts (and Astro 6+ refuse this path unless that file
// exists). Re-exporting keeps one definition working on every major.
export { collections } from "../content.config";
