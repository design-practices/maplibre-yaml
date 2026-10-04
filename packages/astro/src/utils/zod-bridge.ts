/**
 * @file Bridge core's zod-3 schemas into whatever zod the host Astro uses
 * @module @maplibre-yaml/astro/utils/zod-bridge
 *
 * @description
 * Astro 4 and 5 bundle zod 3; Astro 6 and 7 bundle zod 4 (`astro/zod` is
 * `zod/v4` there). The two cannot nest each other's schemas: a zod-3 field
 * inside a zod-4 `z.object()` dies with `keyValidator._parse is not a
 * function`, and the reverse fails the same way. So every schema this package
 * hands to a content collection is built from `astro/zod` (the host's own
 * zod), and core's schemas -- which are zod 3 and stay that way -- reach the
 * host through {@link bridgeSchema}.
 *
 * @internal
 */

import { z } from "astro/zod";

/** True when the host Astro's zod is v4 (Astro 6+). */
export const HOST_ZOD_IS_V4: boolean = "_zod" in (z.string() as object);

/** The structural slice of a zod-3 schema the bridge relies on. */
export interface CoreSchemaLike<T> {
  safeParse(value: unknown):
    | { success: true; data: T }
    | {
        success: false;
        error: { issues: Array<{ path: (string | number)[]; message: string }> };
      };
}

/**
 * Hand a core (zod 3) schema to the host's zod.
 *
 * @remarks
 * On a zod-3 host the schema is returned as-is (zod-3 copies interoperate).
 * On a zod-4 host it is wrapped in a host-zod `unknown().transform()` that
 * delegates validation to the core schema and re-raises each core issue at
 * its original path, so content-collection errors still point at the field.
 * Output (defaults applied, unknown keys stripped) is the core schema's.
 */
export function bridgeSchema<T>(core: CoreSchemaLike<T>): z.ZodType<T> {
  if (!HOST_ZOD_IS_V4) return core as unknown as z.ZodType<T>;
  return z.unknown().transform((value, ctx) => {
    const result = core.safeParse(value);
    if (result.success) return result.data;
    for (const issue of result.error.issues) {
      ctx.addIssue({ code: "custom", message: issue.message, path: issue.path });
    }
    return z.NEVER;
  }) as unknown as z.ZodType<T>;
}
