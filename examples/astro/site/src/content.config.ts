import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
// `astro/zod` is the zod your Astro version ships: zod 3 on Astro 4/5,
// zod 4 on Astro 6/7. The /utils helpers are built from the same module,
// so they nest inside these objects on every major.
import { z } from "astro/zod";
import {
  LocationPointSchema,
  getMapSchema,
  extendSchema,
  getCollectionItemWithLocationSchema,
} from "@maplibre-yaml/astro/utils";

/** `fuji.md` -> `fuji` on every Astro major (Astro 4 keeps the extension). */
const stripExtension = ({ entry }: { entry: string }) => entry.replace(/\.[^.]+$/, "");

/** Markdown entries with a point location in their frontmatter. */
const volcanoes = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/collections/volcanoes", generateId: stripExtension }),
  schema: z.object({
    title: z.string(),
    country: z.string(),
    elevation: z.number(),
    lastEruption: z.number(),
    location: LocationPointSchema,
  }),
});

/** Whole map documents as YAML data entries, plus two fields of our own. */
const maps = defineCollection({
  loader: glob({ pattern: "*.yaml", base: "./src/collections/maps", generateId: stripExtension }),
  schema: extendSchema(getMapSchema(), {
    title: z.string(),
    blurb: z.string(),
  }),
});

/**
 * Dated posts with an optional location: the collections guide's Quick Start
 * helper plus one custom field. `astro check` on every major type-checks the
 * /field-notes pages against this schema's inferred types (ml-aot.23: on
 * Astro 6/7 every field used to infer as `unknown`).
 */
const fieldNotes = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/collections/field-notes", generateId: stripExtension }),
  schema: getCollectionItemWithLocationSchema({
    volcano: z.string(),
  }),
});

export const collections = { volcanoes, maps, "field-notes": fieldNotes };
