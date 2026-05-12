import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";
import { getCollectionItemWithFeatureRefSchema } from "@maplibre-yaml/astro/utils";

/**
 * `getCollectionItemWithFeatureRefSchema` is the strict variant: it rejects
 * frontmatter that declares `feature_ref` alongside any inline geometry
 * field (`location`, `locations`, `region`, `route`). For the permissive
 * variant, compose your own schema with the individual exports.
 */
const poas = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/poas" }),
  schema: getCollectionItemWithFeatureRefSchema({
    title: z.string(),
    summary: z.string().optional(),
  }),
});

export const collections = { poas };
