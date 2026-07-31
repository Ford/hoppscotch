import { Environment, EnvironmentSchemaVersion } from "@hoppscotch/data"
import * as O from "fp-ts/Option"
import * as TE from "fp-ts/TaskEither"
import { z } from "zod"

import { safeParseJSON } from "~/helpers/functional/json"
import { IMPORTER_INVALID_FILE_FORMAT } from "."
import { uniqueID } from "~/helpers/utils/uniqueID"
import { replacePMVarTemplating } from "./postman"

const postmanEnvSchema = z.object({
  name: z.string(),
  values: z.array(
    z.object({
      key: z.string(),
      // Postman may export numeric/boolean/null values – coerce all to string.
      value: z
        .union([z.string(), z.number(), z.boolean()])
        .nullable()
        .transform((v) => (v === null || v === undefined ? "" : String(v))),
      type: z.string().default("default"),
      // Postman 12+ uses `secret: true`; older exports use `type: "secret"`.
      secret: z.boolean().optional(),
      // Respect the enabled flag – false means the variable is disabled.
      enabled: z.boolean().optional().default(true),
    })
  ),
})

type PostmanEnv = z.infer<typeof postmanEnvSchema>

export const postmanEnvImporter = (contents: string[]) => {
  const parsedContents = contents.map((str) => safeParseJSON(str, true))
  if (parsedContents.some((parsed) => O.isNone(parsed))) {
    return TE.left(IMPORTER_INVALID_FILE_FORMAT)
  }

  const parsedValues = parsedContents.flatMap((parsed) => {
    const unwrappedEntry = O.toNullable(parsed) as PostmanEnv[] | null

    if (unwrappedEntry) {
      return unwrappedEntry.map((entry) => ({
        ...entry,
        values: entry.values?.map((valueEntry) => ({
          ...valueEntry,
          value: String(valueEntry.value),
          type: String(valueEntry.type),
        })),
      }))
    }
    return null
  })

  const validationResult = z.array(postmanEnvSchema).safeParse(parsedValues)

  if (!validationResult.success) {
    return TE.left(IMPORTER_INVALID_FILE_FORMAT)
  }

  // Treat as secret on legacy `type: "secret"` OR Postman 12+ `secret: true`.
  // Skip variables that are explicitly disabled in Postman.
  const environments: Environment[] = validationResult.data.map(
    ({ name, values }) => ({
      id: uniqueID(),
      v: EnvironmentSchemaVersion,
      name,
      variables: values
        .filter(({ enabled }) => enabled !== false)
        .map(({ key, value, type, secret }) => ({
          key,
          initialValue: replacePMVarTemplating(value),
          currentValue: replacePMVarTemplating(value),
          secret: type === "secret" || secret === true,
        })),
    })
  )

  return TE.right(environments)
}
