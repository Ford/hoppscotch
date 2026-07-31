/**
 * Importer for Global Environment variables.
 *
 * Supported input shapes:
 *   1. Hoppscotch GlobalEnvironment v1 – `{ v: 1, variables: [{ key, value, secret }] }`
 *   2. Hoppscotch GlobalEnvironment v2 – `{ v: 2, name, variables: [{ key, initialValue, currentValue, secret }] }`
 *   3. Array of Hoppscotch environments – `[{ v, name, variables }, ...]` (each item V1 or V2)
 *   4. Loose Hoppscotch env object      – `{ name?, variables?: [...] }` (no `v` field, uses defaults)
 *   5. Postman Environment export       – `{ name?, values: [{ key, value, type }] }`
 *
 * V0 (bare array of variable objects, pre-2024.10.0) is intentionally NOT supported.
 * V0 items have no `v`, `values`, `name` or `variables` fields and are rejected.
 *
 * IMPORTANT: safeParseJSON is always called with convertToArray=true, so `raw` is
 * always an array. Each element is classified independently.
 *
 * All matched variables are merged (appended) into the Global environment.
 */

import { GlobalEnvironment, GlobalEnvironmentVariable } from "@hoppscotch/data"
import * as O from "fp-ts/Option"
import * as TE from "fp-ts/TaskEither"
import { entityReference } from "verzod"
import { z } from "zod"

import { safeParseJSON } from "~/helpers/functional/json"
import { IMPORTER_INVALID_FILE_FORMAT } from "."

// ── Loose Hoppscotch env schema (no version field, field defaults) ─────────────
const hoppEnvVariableSchema = z.object({
  key: z.string(),
  initialValue: z.string().default(""),
  currentValue: z.string().default(""),
  secret: z.boolean().default(false),
})

const hoppSingleEnvSchema = z.object({
  name: z.string().optional(),
  variables: z.array(hoppEnvVariableSchema).default([]),
})

// ── Postman environment shape ─────────────────────────────────────────────────
const postmanEnvVariableSchema = z.object({
  key: z.string(),
  // Postman may export numeric/boolean/null values – coerce all to string.
  value: z
    .union([z.string(), z.number(), z.boolean()])
    .nullable()
    .transform((v) => (v === null || v === undefined ? "" : String(v)))
    .default(""),
  type: z.string().default("default"),
  secret: z.boolean().optional(),
  // Respect the enabled flag – false means the variable is disabled.
  enabled: z.boolean().optional().default(true),
})

const postmanEnvFileSchema = z.object({
  name: z.string().optional(),
  values: z.array(postmanEnvVariableSchema),
})

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classify and extract variables from a single array item.
 *
 * Priority order (prevents false positives):
 *  1. Has numeric `v` field  →  versioned V1/V2 via entityReference
 *  2. Has `values` array     →  Postman format
 *  3. Has `name` string OR `variables` array  →  loose Hopp env
 *  4. Otherwise              →  unrecognised → return null
 *
 * Returning null signals the caller to reject the whole import.
 */
function extractFromItem(
  item: unknown
): GlobalEnvironmentVariable[] | null {
  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    return null
  }

  const obj = item as Record<string, unknown>

  // ── 1. Versioned V1 / V2 ──────────────────────────────────────────────────
  if ("v" in obj && typeof obj.v === "number") {
    const result = entityReference(GlobalEnvironment).safeParse(item)
    return result.success ? result.data.variables : null
  }

  // ── 2. Postman: { name?, values: [...] } ──────────────────────────────────
  if ("values" in obj && Array.isArray(obj.values)) {
    const result = postmanEnvFileSchema.safeParse(item)
    if (!result.success) return null
    return result.data.values
      .filter(({ enabled }) => enabled !== false)
      .map(({ key, value, type, secret }) => ({
        key,
        initialValue: value,
        currentValue: value,
        secret: type === "secret" || secret === true,
      }))
  }

  // ── 3. Loose Hopp: { name?, variables?: [...] } ───────────────────────────
  // Require at least a `name` string or `variables` array to avoid matching
  // completely unrelated objects (e.g. { foo: "bar" }).
  if (
    ("name" in obj && typeof obj.name === "string") ||
    ("variables" in obj && Array.isArray(obj.variables))
  ) {
    const result = hoppSingleEnvSchema.safeParse(item)
    return result.success ? result.data.variables : null
  }

  // ── 4. Unrecognised ───────────────────────────────────────────────────────
  return null
}

export const hoppGlobalEnvImporter = (
  contents: string[]
): TE.TaskEither<
  typeof IMPORTER_INVALID_FILE_FORMAT,
  GlobalEnvironmentVariable[]
> => {
  // safeParseJSON with convertToArray=true always returns an array:
  //   - object input  → wrapped in [object]
  //   - array input   → kept as-is
  const parsedContents = contents.map((str) => safeParseJSON(str, true))

  if (parsedContents.some((p) => O.isNone(p))) {
    return TE.left(IMPORTER_INVALID_FILE_FORMAT)
  }

  const variables: GlobalEnvironmentVariable[] = []

  for (const parsed of parsedContents) {
    const items = O.toNullable(parsed) as unknown[] | null
    if (!items) return TE.left(IMPORTER_INVALID_FILE_FORMAT)

    for (const item of items) {
      const extracted = extractFromItem(item)
      if (extracted === null) return TE.left(IMPORTER_INVALID_FILE_FORMAT)
      variables.push(...extracted)
    }
  }

  return TE.right(variables)
}
