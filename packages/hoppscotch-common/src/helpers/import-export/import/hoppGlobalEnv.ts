/**
 * Importer for Global Environment variables.
 *
 * Accepts a JSON file in any of the following shapes:
 *   1. Hoppscotch Environment export  – `{ v, name, variables: [...] }`
 *   2. Array of Hoppscotch Environments – `[{ v, name, variables: [...] }, ...]`
 *   3. Postman Environment export  – `{ name, values: [{ key, value, type }] }`
 *
 * All matched variables are merged (appended) into the Global environment.
 */

import { GlobalEnvironmentVariable } from "@hoppscotch/data"
import * as O from "fp-ts/Option"
import * as TE from "fp-ts/TaskEither"
import { z } from "zod"

import { safeParseJSON } from "~/helpers/functional/json"
import { IMPORTER_INVALID_FILE_FORMAT } from "."

// ── Hoppscotch environment variable shape (v2) ───────────────────────────────
const hoppEnvVariableSchema = z.object({
  key: z.string(),
  initialValue: z.string().default(""),
  currentValue: z.string().default(""),
  secret: z.boolean().default(false),
})

// Accept both single-object and array formats
const hoppSingleEnvSchema = z.object({
  name: z.string().optional(),
  variables: z.array(hoppEnvVariableSchema).default([]),
})

const hoppEnvFileSchema = z.union([
  z.array(hoppSingleEnvSchema),
  hoppSingleEnvSchema,
])

// ── Postman environment shape ─────────────────────────────────────────────────
const postmanEnvVariableSchema = z.object({
  key: z.string(),
  value: z.string().default(""),
  type: z.string().default("default"),
  secret: z.boolean().optional(),
})

const postmanEnvFileSchema = z.object({
  name: z.string().optional(),
  values: z.array(postmanEnvVariableSchema),
})

// ─────────────────────────────────────────────────────────────────────────────

function extractFromHopp(
  raw: unknown
): GlobalEnvironmentVariable[] | null {
  const result = hoppEnvFileSchema.safeParse(raw)
  if (!result.success) return null

  const envs = Array.isArray(result.data) ? result.data : [result.data]

  return envs.flatMap((env) =>
    env.variables.map((v) => ({
      key: v.key,
      initialValue: v.initialValue,
      currentValue: v.currentValue,
      secret: v.secret,
    }))
  )
}

function extractFromPostman(
  raw: unknown
): GlobalEnvironmentVariable[] | null {
  const result = postmanEnvFileSchema.safeParse(raw)
  if (!result.success) return null

  return result.data.values.map(({ key, value, type, secret }) => ({
    key,
    initialValue: value,
    currentValue: value,
    secret: type === "secret" || secret === true,
  }))
}

export const hoppGlobalEnvImporter = (
  contents: string[]
): TE.TaskEither<
  typeof IMPORTER_INVALID_FILE_FORMAT,
  GlobalEnvironmentVariable[]
> => {
  const parsedContents = contents.map((str) => safeParseJSON(str, true))

  if (parsedContents.some((p) => O.isNone(p))) {
    return TE.left(IMPORTER_INVALID_FILE_FORMAT)
  }

  const variables: GlobalEnvironmentVariable[] = []

  for (const parsed of parsedContents) {
    const raw = O.toNullable(parsed)
    if (raw === null) return TE.left(IMPORTER_INVALID_FILE_FORMAT)

    // Try Hoppscotch format first, then Postman
    const extracted = extractFromHopp(raw) ?? extractFromPostman(raw)

    if (extracted === null) return TE.left(IMPORTER_INVALID_FILE_FORMAT)

    variables.push(...extracted)
  }

  return TE.right(variables)
}

