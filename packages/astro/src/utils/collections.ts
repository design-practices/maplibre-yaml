/**
 * @file Content Collection schema helpers for Astro
 * @module @maplibre-yaml/astro/utils/collections
 *
 * @description
 * Helper functions for defining Astro Content Collections with maplibre-yaml
 * schemas. These functions return Zod schemas that can be used in
 * `src/content/config.ts` to type-check YAML configuration files in
 * content collections.
 *
 * ## Usage with Content Collections
 *
 * Content Collections allow you to organize YAML files in `src/content/`
 * directories and query them with type safety. These helpers provide the
 * schemas needed to validate map and scrollytelling configurations.
 *
 * @example Define a maps collection
 * ```typescript
 * // src/content/config.ts
 * import { defineCollection } from 'astro:content';
 * import { getMapSchema } from '@maplibre-yaml/astro/utils';
 *
 * export const collections = {
 *   maps: defineCollection({
 *     type: 'data',
 *     schema: getMapSchema()
 *   })
 * };
 * ```
 *
 * @example Query maps in a page
 * ```astro
 * ---
 * import { getCollection } from 'astro:content';
 * import { Map } from '@maplibre-yaml/astro';
 *
 * const maps = await getCollection('maps');
 * ---
 * {maps.map(entry => (
 *   <Map config={entry.data} />
 * ))}
 * ```
 */

import { z } from "astro/zod";
import {
  MapBlockSchema,
  ScrollytellingBlockSchema,
  ChapterSchema,
  MapConfigSchema,
} from "@maplibre-yaml/core/schemas";
import type {
  MapBlock,
  MapConfig,
  ScrollytellingBlock,
  Chapter,
} from "@maplibre-yaml/core/schemas";
import { bridgeSchema, HOST_ZOD_IS_V4, type CoreSchemaLike } from "./zod-bridge";

/**
 * Core schema behind each bridged schema, so {@link extendSchema} can extend
 * a bridged (zod-4 host) schema by validating with the core one.
 */
const CORE_OF = new WeakMap<object, CoreSchemaLike<unknown>>();

function bridged<T>(core: CoreSchemaLike<T>): z.ZodType<T> {
  const schema = bridgeSchema(core);
  CORE_OF.set(schema as object, core as CoreSchemaLike<unknown>);
  return schema;
}

/**
 * Get the Zod schema for map block configurations.
 *
 * @returns Zod schema for validating MapBlock configurations
 *
 * @remarks
 * This function returns the MapBlockSchema from @maplibre-yaml/core,
 * which validates complete map block configurations including:
 * - Map configuration (center, zoom, mapStyle)
 * - Layers and sources
 * - Controls and legend
 * - Interactive features
 *
 * Use this schema when defining a content collection for map configurations.
 *
 * @example Define maps collection
 * ```typescript
 * // src/content/config.ts
 * import { defineCollection } from 'astro:content';
 * import { getMapSchema } from '@maplibre-yaml/astro/utils';
 *
 * export const collections = {
 *   maps: defineCollection({
 *     type: 'data',
 *     schema: getMapSchema()
 *   })
 * };
 * ```
 *
 * @example Use in Astro page
 * ```astro
 * ---
 * import { getCollection } from 'astro:content';
 * import { Map } from '@maplibre-yaml/astro';
 *
 * const mapEntry = await getEntry('maps', 'earthquake-map');
 * ---
 * <Map config={mapEntry.data} height="600px" />
 * ```
 *
 * @example List all maps
 * ```astro
 * ---
 * import { getCollection } from 'astro:content';
 *
 * const maps = await getCollection('maps');
 * ---
 * <div class="map-gallery">
 *   {maps.map(entry => (
 *     <div>
 *       <h2>{entry.data.id}</h2>
 *       <Map config={entry.data} height="400px" />
 *     </div>
 *   ))}
 * </div>
 * ```
 */
export function getMapSchema(): z.ZodType<MapBlock> {
  return bridged<MapBlock>(MapBlockSchema as CoreSchemaLike<MapBlock>);
}

/**
 * Get the Zod schema for scrollytelling configurations.
 *
 * @returns Zod schema for validating ScrollytellingBlock configurations
 *
 * @remarks
 * This function returns the ScrollytellingBlockSchema from @maplibre-yaml/core,
 * which validates complete scrollytelling configurations including:
 * - Base map configuration
 * - Chapters with all properties
 * - Chapter actions (onChapterEnter, onChapterExit)
 * - Persistent layers
 * - Theme and markers
 *
 * Use this schema when defining a content collection for scrollytelling stories.
 *
 * @example Define stories collection
 * ```typescript
 * // src/content/config.ts
 * import { defineCollection } from 'astro:content';
 * import { getScrollytellingSchema } from '@maplibre-yaml/astro/utils';
 *
 * export const collections = {
 *   stories: defineCollection({
 *     type: 'data',
 *     schema: getScrollytellingSchema()
 *   })
 * };
 * ```
 *
 * @example Use in Astro page
 * ```astro
 * ---
 * import { getEntry } from 'astro:content';
 * import { Scrollytelling } from '@maplibre-yaml/astro';
 *
 * const story = await getEntry('stories', 'climate-change');
 * ---
 * <Scrollytelling config={story.data} />
 * ```
 *
 * @example Dynamic story pages
 * ```astro
 * ---
 * // src/pages/stories/[slug].astro
 * import { getCollection, getEntry } from 'astro:content';
 * import { Scrollytelling } from '@maplibre-yaml/astro';
 *
 * export async function getStaticPaths() {
 *   const stories = await getCollection('stories');
 *   return stories.map(entry => ({
 *     params: { slug: entry.id },
 *     props: { entry }
 *   }));
 * }
 *
 * const { entry } = Astro.props;
 * ---
 * <Scrollytelling config={entry.data} />
 * ```
 */
export function getScrollytellingSchema(): z.ZodType<ScrollytellingBlock> {
  return bridged<ScrollytellingBlock>(
    ScrollytellingBlockSchema as CoreSchemaLike<ScrollytellingBlock>
  );
}

/**
 * Get the Zod schema for individual chapters.
 *
 * @returns Zod schema for validating Chapter configurations
 *
 * @remarks
 * This function returns the ChapterSchema from @maplibre-yaml/core,
 * which validates individual chapter configurations. This is useful if
 * you want to store chapters separately from scrollytelling stories.
 *
 * ## Chapter Properties
 *
 * - **Required**: id, title, center, zoom
 * - **Optional**: description, image, video, pitch, bearing, alignment
 * - **Actions**: onChapterEnter, onChapterExit
 * - **Layers**: show/hide layer controls
 *
 * @example Define chapters collection
 * ```typescript
 * // src/content/config.ts
 * import { defineCollection } from 'astro:content';
 * import { getChapterSchema } from '@maplibre-yaml/astro/utils';
 *
 * export const collections = {
 *   chapters: defineCollection({
 *     type: 'data',
 *     schema: getChapterSchema()
 *   })
 * };
 * ```
 *
 * @example Build story from chapters
 * ```astro
 * ---
 * import { getCollection } from 'astro:content';
 * import { Scrollytelling } from '@maplibre-yaml/astro';
 *
 * const chapters = await getCollection('chapters', ({ id }) =>
 *   id.startsWith('earthquake-')
 * );
 *
 * const storyConfig = {
 *   type: 'scrollytelling',
 *   id: 'earthquake-story',
 *   config: {
 *     center: [0, 0],
 *     zoom: 2,
 *     mapStyle: 'https://demotiles.maplibre.org/style.json'
 *   },
 *   chapters: chapters.map(c => c.data)
 * };
 * ---
 * <Scrollytelling config={storyConfig} />
 * ```
 */
export function getChapterSchema(): z.ZodType<Chapter> {
  return bridged<Chapter>(ChapterSchema as CoreSchemaLike<Chapter>);
}

/**
 * Get a simplified Zod schema for basic map configurations.
 *
 * @returns Zod schema for validating simple map configurations
 *
 * @remarks
 * This function returns a simplified schema that only validates the core
 * map configuration (center, zoom, mapStyle) without the full block structure.
 * This is useful for simpler use cases where you just need basic map settings.
 *
 * ## Use Cases
 *
 * - Simple map configurations without layers
 * - Embedding map settings in other content
 * - Lightweight config files
 * - Quick prototyping
 *
 * @example Define simple maps collection
 * ```typescript
 * // src/content/config.ts
 * import { defineCollection } from 'astro:content';
 * import { getSimpleMapSchema } from '@maplibre-yaml/astro/utils';
 *
 * export const collections = {
 *   'map-settings': defineCollection({
 *     type: 'data',
 *     schema: getSimpleMapSchema()
 *   })
 * };
 * ```
 *
 * @example Use with custom map setup
 * ```astro
 * ---
 * import { getEntry } from 'astro:content';
 *
 * const settings = await getEntry('map-settings', 'default');
 * const mapConfig = {
 *   type: 'map',
 *   id: 'custom-map',
 *   config: settings.data,
 *   layers: [
 *     // Add layers programmatically
 *   ]
 * };
 * ---
 * <Map config={mapConfig} />
 * ```
 *
 * @example Store map views
 * ```yaml
 * # src/content/map-settings/san-francisco.yaml
 * center: [-122.4194, 37.7749]
 * zoom: 12
 * pitch: 45
 * bearing: 0
 * mapStyle: "https://demotiles.maplibre.org/style.json"
 * ```
 */
export function getSimpleMapSchema(): z.ZodType<MapConfig> {
  return bridged<MapConfig>(MapConfigSchema as CoreSchemaLike<MapConfig>);
}

/**
 * Create a custom schema by extending a base schema.
 *
 * @param baseSchema - Base schema to extend (e.g., MapBlockSchema)
 * @param extensions - Additional Zod schema properties to merge
 * @returns Extended Zod schema
 *
 * @remarks
 * This utility function allows you to extend the base schemas with
 * additional metadata or custom fields specific to your application.
 *
 * ## Common Use Cases
 *
 * - Add metadata (author, date, tags)
 * - Include custom frontmatter
 * - Extend with application-specific fields
 * - Add computed properties
 *
 * @example Add metadata to maps
 * ```typescript
 * // src/content/config.ts
 * import { defineCollection } from 'astro:content';
 * import { getMapSchema, extendSchema } from '@maplibre-yaml/astro/utils';
 * import { z } from 'zod';
 *
 * export const collections = {
 *   maps: defineCollection({
 *     type: 'data',
 *     schema: extendSchema(getMapSchema(), {
 *       author: z.string(),
 *       publishDate: z.date(),
 *       tags: z.array(z.string()),
 *       featured: z.boolean().default(false)
 *     })
 *   })
 * };
 * ```
 *
 * @example Extended YAML file
 * ```yaml
 * # src/content/maps/earthquake-map.yaml
 * author: "John Doe"
 * publishDate: 2024-01-15
 * tags: ["earthquakes", "geoscience"]
 * featured: true
 *
 * type: map
 * id: earthquake-map
 * config:
 *   center: [-120, 35]
 *   zoom: 6
 *   mapStyle: "https://demotiles.maplibre.org/style.json"
 * # ... rest of map config
 * ```
 *
 * @example Use metadata in template
 * ```astro
 * ---
 * import { getCollection } from 'astro:content';
 *
 * const featuredMaps = await getCollection('maps', ({ data }) =>
 *   data.featured
 * );
 * ---
 * {featuredMaps.map(entry => (
 *   <div>
 *     <h2>{entry.data.id}</h2>
 *     <p>By {entry.data.author} on {entry.data.publishDate}</p>
 *     <Map config={entry.data} />
 *   </div>
 * ))}
 * ```
 */
export function extendSchema<T extends z.ZodTypeAny, E extends z.ZodRawShape>(
  baseSchema: T,
  extensions: E
): z.ZodType<z.output<T> & { [K in keyof E]: z.output<E[K]> }> {
  return extendSchemaImpl(baseSchema, extensions) as unknown as z.ZodType<
    z.output<T> & { [K in keyof E]: z.output<E[K]> }
  >;
}

function extendSchemaImpl(baseSchema: z.ZodTypeAny, extensions: z.ZodRawShape): z.ZodTypeAny {
  const core = CORE_OF.get(baseSchema as object);

  // zod-4 host (Astro 6+) with a bridged core schema: the core half cannot
  // be `.extend()`ed by host zod, so validate both halves and merge. Both
  // strip unknown keys, so each sees only its own fields in the output.
  if (HOST_ZOD_IS_V4 && core) {
    const extra = z.object(extensions);
    return z.unknown().transform((value, ctx) => {
      const base = core.safeParse(value);
      const ext = extra.safeParse(value);
      if (!base.success) {
        for (const issue of base.error.issues) {
          ctx.addIssue({ code: "custom", message: issue.message, path: issue.path });
        }
      }
      if (!ext.success) {
        for (const issue of ext.error.issues) {
          ctx.addIssue({
            code: "custom",
            message: issue.message,
            path: issue.path as (string | number)[],
          });
        }
      }
      if (!base.success || !ext.success) return z.NEVER;
      return { ...(base.data as object), ...(ext.data as object) };
    });
  }

  // If base schema is an object, merge with extensions
  const extend = (baseSchema as { extend?: unknown }).extend;
  if (typeof extend === "function" && typeof (baseSchema as { shape?: unknown }).shape === "object") {
    return (baseSchema as unknown as z.ZodObject<z.ZodRawShape>).extend(extensions);
  }

  // Otherwise, create a new object schema with extensions
  return z.object(extensions);
}
