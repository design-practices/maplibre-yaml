/**
 * What a site's `src/content.config.ts` + `[...slug].astro` see when they use
 * the collection-item helpers (guides/collections-integration.mdx Quick
 * Start). `astro/zod` is mapped by the tsconfig to zod 3 (Astro 4/5) or
 * zod 4 (Astro 6/7); Astro types `entry.data` as the schema's output.
 *
 * Every line here must compile on BOTH. Before ml-aot.23 the zod-4 run typed
 * every field `unknown`/`{}` ("Type 'unknown' is not assignable to type
 * 'string'").
 */
import { z } from "astro/zod";
import {
  getCollectionItemWithLocationSchema,
  getCollectionItemWithLocationsSchema,
  getCollectionItemWithRegionSchema,
  getCollectionItemWithRouteSchema,
  getCollectionItemWithGeoSchema,
  type LocationPoint,
  type RegionPolygon,
  type RouteLine,
} from "../../../src/utils/collections-schemas";
import { getCollectionItemWithFeatureRefSchema } from "../../../src/utils/feature-ref-schema";

type Out<S extends { _output: unknown }> = S["_output"];

// --- Quick Start: no custom fields --------------------------------------
// (`typeof` an actual call, as Astro sees `schema:`: `ReturnType<typeof fn>`
// would instantiate the type parameter with its constraint, not its default.)
const postSchema = getCollectionItemWithLocationSchema();
declare const post: Out<typeof postSchema>;
const title: string = post.title;
const description: string | undefined = post.description;
const pubDate: Date = post.pubDate;
const location: LocationPoint | undefined = post.location;
if (post.location) {
  const coords: [number, number] = post.location.coordinates;
  const name: string | undefined = post.location.name;
  void coords;
  void name;
}
// @ts-expect-error unknown keys are not invented
void post.notAField;

// --- custom fields merge with the base fields ---------------------------
const withAuthor = getCollectionItemWithLocationSchema({
  author: z.string(),
  tags: z.array(z.string()),
});
declare const authored: Out<typeof withAuthor>;
const author: string = authored.author;
const tags: string[] = authored.tags;
const authoredTitle: string = authored.title;
const authoredLocation: LocationPoint | undefined = authored.location;

// --- the other helpers ---------------------------------------------------
const tripSchema = getCollectionItemWithLocationsSchema();
declare const trip: Out<typeof tripSchema>;
const stops: LocationPoint[] | undefined = trip.locations;
const tripTitle: string = trip.title;

const hoodSchema = getCollectionItemWithRegionSchema();
declare const hood: Out<typeof hoodSchema>;
const region: RegionPolygon | undefined = hood.region;

const hikeSchema = getCollectionItemWithRouteSchema();
declare const hike: Out<typeof hikeSchema>;
const route: RouteLine | undefined = hike.route;

const geo = getCollectionItemWithGeoSchema({ category: z.enum(["a", "b"]) });
declare const anything: Out<typeof geo>;
const category: "a" | "b" = anything.category;
const geoTitle: string = anything.title;
const geoRoute: RouteLine | undefined = anything.route;

const refd = getCollectionItemWithFeatureRefSchema({ title: z.string() });
declare const ref: Out<typeof refd>;
const refTitle: string = ref.title;
const refLocation: LocationPoint | undefined = ref.location;

export {
  title,
  description,
  pubDate,
  location,
  author,
  tags,
  authoredTitle,
  authoredLocation,
  stops,
  tripTitle,
  region,
  route,
  category,
  geoTitle,
  geoRoute,
  refTitle,
  refLocation,
};
