import { Environment } from "@hoppscotch/data"
import * as E from "fp-ts/Either"
import { cloneDeep } from "lodash-es"

import { TeamEnvironment } from "~/helpers/teams/TeamEnvironment"
import { stripSecretVariableValuesForWire } from "~/helpers/secretVariables"
import { getService } from "~/modules/dioc"
import { CurrentValueService } from "~/services/current-environment-value.service"
import { initializeDownloadFile } from "."

/**
 * Prepare variables for a FILE export.
 *
 * Difference from `stripSecretVariableValuesForWire`:
 *  - Non-secret variables keep their real runtime `currentValue` (read from
 *    `CurrentValueService` via `getRuntimeCurrentValue`).
 *  - Secret variables are fully stripped (both `initialValue` and
 *    `currentValue` become `""`), same as the wire path.
 *
 * @param variables            Raw variable list from the environment object.
 * @param getRuntimeCurrentValue
 *   Callback that returns the live `currentValue` for a given key.
 *   Receives `(key)` and should return `""` when no runtime override exists.
 */
export const prepareVariablesForExport = <
  T extends {
    key: string
    initialValue: string
    currentValue: string
    secret: boolean
  },
>(
  variables: T[],
  getRuntimeCurrentValue: (key: string) => string
): T[] =>
  variables.map((v) => {
    if (v.secret) {
      // Never export secret values
      return { ...v, initialValue: "", currentValue: "" }
    }
    return {
      ...v,
      initialValue: v.initialValue,
      // Prefer the live runtime override; fall back to whatever the object
      // already carries (covers cases where the service has no entry yet).
      currentValue: getRuntimeCurrentValue(v.key) || v.currentValue,
    }
  })

const getEnvironmentJSON = (
  environmentObj: TeamEnvironment | Environment,
  environmentIndex?: number | "Global" | null
) => {
  const newEnvironment =
    "environment" in environmentObj
      ? cloneDeep(environmentObj.environment)
      : cloneDeep(environmentObj)

  const environmentId =
    environmentIndex || environmentIndex === 0
      ? environmentIndex
      : environmentObj.id

  // Determine the key used in CurrentValueService:
  //   "Global" for the global env, or the environment's own id otherwise.
  const serviceKey =
    environmentIndex === "Global" ? "Global" : String(newEnvironment.id ?? "")

  const currentValueService = getService(CurrentValueService)
  const getRuntimeCurrentValue = (key: string) =>
    currentValueService.getEnvironmentByKey(serviceKey, key)?.currentValue ?? ""

  const transformedEnvironment = {
    ...newEnvironment,
    variables: prepareVariablesForExport(newEnvironment.variables, getRuntimeCurrentValue),
  }

  return environmentId !== null
    ? JSON.stringify(transformedEnvironment, null, 2)
    : undefined
}

// Apply necessary transformations prior to environment exports.
// Strips `initialValue` for `secret: true` variables AND clears
// `currentValue` for all variables.
// NOTE: used by ImportExport.vue for the bulk-export preview JSON.
// If you have access to CurrentValueService, prefer the hydrating path
// inside `exportAsJSON` / `getEnvironmentJSON`.
export const transformEnvironmentVariables = ({
  id,
  v,
  name,
  variables,
}: Environment) => {
  return {
    id,
    v,
    name,
    variables: stripSecretVariableValuesForWire(variables),
  }
}

export const exportAsJSON = async (
  environmentObj: Environment | TeamEnvironment,
  environmentIndex?: number | "Global" | null
): Promise<E.Right<string> | E.Left<string>> => {
  const environmentJSON = getEnvironmentJSON(environmentObj, environmentIndex)

  if (!environmentJSON) {
    return E.left("state.download_failed")
  }

  const message = await initializeDownloadFile(
    environmentJSON,
    JSON.parse(environmentJSON).name
  )

  return message
}
