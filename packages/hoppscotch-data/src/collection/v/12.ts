import { defineVersion, entityReference } from "verzod"
import { z } from "zod"

import { HoppCollection } from ".."
import { v11_baseCollectionSchema } from "./11"

export const v12_baseCollectionSchema = v11_baseCollectionSchema.extend({
  v: z.literal(12),
  preRequestScript: z.string().catch(""),
  testScript: z.string().catch(""),
})

type Input = z.input<typeof v12_baseCollectionSchema> & {
  folders: Input[]
}

type Output = z.output<typeof v12_baseCollectionSchema> & {
  folders: Output[]
}

// Use entityReference (not entityRefUptoVersion) so that nested folders that
// are already at v12 are accepted. entityRefUptoVersion(entity, 11) rejects
// v:12 folders because isUpToVersion(folder, 11) → 12 > 11 → false, causing
// V12_SCHEMA.safeParse to fail for any collection that has nested folders,
// which breaks persistence across app restarts.
export const V12_SCHEMA = v12_baseCollectionSchema.extend({
  folders: z.lazy(() => z.array(entityReference(HoppCollection))),
}) as unknown as z.ZodType<Output, z.ZodTypeDef, Input>

export default defineVersion({
  initial: false,
  schema: V12_SCHEMA,
  up(old: z.infer<typeof V12_SCHEMA>) {
    const result: z.infer<typeof V12_SCHEMA> = {
      ...old,
      v: 12 as const,
      preRequestScript: "",
      testScript: "",
      // Migrate each folder fully to v12 (same pattern as v11, but using
      // safeParse which migrates all the way to latestVersion = 12).
      folders: old.folders.map((folder) => {
        const res = HoppCollection.safeParse(folder)

        if (res.type !== "ok") {
          throw new Error("Failed to migrate child collections")
        }

        return res.value as any
      }),
    }

    return result
  },
})

