import { parseTemplateStringE } from "@hoppscotch/data"
import * as E from "fp-ts/Either"
import * as O from "fp-ts/Option"
import { pipe } from "fp-ts/lib/function"
import { cloneDeep } from "lodash-es"

import {
  Expectation,
  GlobalEnvItem,
  SelectedEnvItem,
  TestDescriptor,
  TestResult,
} from "./types"

const getEnv = (envName: string, envs: TestResult["envs"]) => {
  return O.fromNullable(
    envs.selected.find((x: SelectedEnvItem) => x.key === envName) ??
      envs.global.find((x: GlobalEnvItem) => x.key === envName)
  )
}

const findEnvIndex = (
  envName: string,
  envList: SelectedEnvItem[] | GlobalEnvItem[]
): number => {
  return envList.findIndex(
    (envItem: SelectedEnvItem) => envItem.key === envName
  )
}

const setEnv = (
  envName: string,
  envValue: string,
  envs: TestResult["envs"]
): TestResult["envs"] => {
  const { global, selected } = envs

  const indexInSelected = findEnvIndex(envName, selected)
  const indexInGlobal = findEnvIndex(envName, global)

  if (indexInSelected >= 0) {
    const selectedEnv = selected[indexInSelected]
    if ("currentValue" in selectedEnv) {
      selectedEnv.currentValue = envValue
    }
  } else if (indexInGlobal >= 0) {
    if ("currentValue" in global[indexInGlobal])
      (global[indexInGlobal] as { currentValue: string }).currentValue =
        envValue
  } else {
    selected.push({
      key: envName,
      currentValue: envValue,
      initialValue: envValue,
      secret: false,
    })
  }

  return {
    global,
    selected,
  }
}

const unsetEnv = (
  envName: string,
  envs: TestResult["envs"]
): TestResult["envs"] => {
  const { global, selected } = envs

  const indexInSelected = findEnvIndex(envName, selected)
  const indexInGlobal = findEnvIndex(envName, global)

  if (indexInSelected >= 0) {
    selected.splice(indexInSelected, 1)
  } else if (indexInGlobal >= 0) {
    global.splice(indexInGlobal, 1)
  }

  return {
    global,
    selected,
  }
}

// Shared scripting API methods
export const getSharedMethods = (envs: TestResult["envs"]) => {
  let updatedEnvs = envs

  const envGetFn = (key: any) => {
    if (typeof key !== "string") {
      throw new Error("Expected key to be a string")
    }

    return pipe(
      getEnv(key, updatedEnvs),
      O.fold(
        () => undefined,
        (env) => String(env.currentValue)
      )
    )
  }

  const envGetResolveFn = (key: any) => {
    if (typeof key !== "string") {
      throw new Error("Expected key to be a string")
    }

    return pipe(
      getEnv(key, updatedEnvs),
      E.fromOption(() => "INVALID_KEY" as const),
      E.map((e) =>
        pipe(
          parseTemplateStringE(e.currentValue, [
            ...updatedEnvs.selected,
            ...updatedEnvs.global,
          ]),
          E.getOrElse(() => e.currentValue)
        )
      ),
      E.map((x) => String(x)),
      E.getOrElseW(() => undefined)
    )
  }

  const envSetFn = (key: any, value: any) => {
    if (typeof key !== "string") {
      throw new Error("Expected key to be a string")
    }

    if (typeof value !== "string") {
      throw new Error("Expected value to be a string")
    }

    updatedEnvs = setEnv(key, value, updatedEnvs)
    return undefined
  }

  const envUnsetFn = (key: any) => {
    if (typeof key !== "string") {
      throw new Error("Expected key to be a string")
    }

    updatedEnvs = unsetEnv(key, updatedEnvs)
    return undefined
  }

  const envResolveFn = (value: any) => {
    if (typeof value !== "string") {
      throw new Error("Expected value to be a string")
    }

    return String(
      pipe(
        parseTemplateStringE(value, [
          ...updatedEnvs.selected,
          ...updatedEnvs.global,
        ]),
        E.getOrElse(() => value)
      )
    )
  }

  return {
    methods: {
      env: {
        get: envGetFn,
        getResolve: envGetResolveFn,
        set: envSetFn,
        unset: envUnsetFn,
        resolve: envResolveFn,
      },
    },
    updatedEnvs,
  }
}

const getResolvedExpectValue = (expectVal: any) => {
  if (typeof expectVal !== "string") return expectVal

  try {
    const parsedExpectVal = JSON.parse(expectVal)
    if (typeof parsedExpectVal === "object") {
      if (parsedExpectVal.isStringifiedWithinIsolate !== true) return expectVal

      if (Array.isArray(parsedExpectVal.arr)) return parsedExpectVal.arr

      delete parsedExpectVal.isStringifiedWithinIsolate
      return parsedExpectVal
    }
    return expectVal
  } catch (_) {
    return expectVal
  }
}

export function preventCyclicObjects<T extends object = Record<string, any>>(
  obj: T
): E.Left<string> | E.Right<T> {
  try {
    const jsonString = JSON.stringify(obj)
    const parsedJson = JSON.parse(jsonString)
    return E.right(parsedJson)
  } catch (_) {
    return E.left("Stringification failed")
  }
}

// Expectation implementation
export const createExpectation = (
  expectVal: any,
  negated: boolean,
  currTestStack: TestDescriptor[]
): Expectation => {
  const resolvedExpectVal = getResolvedExpectValue(expectVal)

  const pushResult = (status: "pass" | "fail" | "error", message: string) => {
    currTestStack[currTestStack.length - 1].expectResults.push({ status, message })
  }

  const baseAssert = (assertion: boolean, message: string) => {
    if (negated) assertion = !assertion
    pushResult(assertion ? "pass" : "fail", message)
  }

  const toBeFn = (expectedVal: any) => {
    baseAssert(
      resolvedExpectVal === expectedVal,
      `Expected '${resolvedExpectVal}' to${negated ? " not" : ""} be '${expectedVal}'`
    )
    return undefined
  }

  const toBeLevelXxx = (level: string, rangeStart: number, rangeEnd: number) => {
    const parsedExpectVal = parseInt(resolvedExpectVal)
    if (!Number.isNaN(parsedExpectVal)) {
      baseAssert(
        parsedExpectVal >= rangeStart && parsedExpectVal <= rangeEnd,
        `Expected '${parsedExpectVal}' to${negated ? " not" : ""} be ${level}-level status`
      )
    } else {
      pushResult(
        "error",
        `Expected ${level}-level status but could not parse value '${resolvedExpectVal}'`
      )
    }
    return undefined
  }

  const toBeLevel2xxFn = () => toBeLevelXxx("200", 200, 299)
  const toBeLevel3xxFn = () => toBeLevelXxx("300", 300, 399)
  const toBeLevel4xxFn = () => toBeLevelXxx("400", 400, 499)
  const toBeLevel5xxFn = () => toBeLevelXxx("500", 500, 599)

  const toBeTypeFn = (expectedType: any) => {
    const allowed = [
      "string",
      "boolean",
      "number",
      "object",
      "undefined",
      "bigint",
      "symbol",
      "function",
    ]
    if (!allowed.includes(expectedType)) {
      pushResult(
        "error",
        'Argument for toBeType should be "string", "boolean", "number", "object", "undefined", "bigint", "symbol" or "function"'
      )
      return undefined
    }
    baseAssert(
      typeof resolvedExpectVal === expectedType,
      `Expected '${resolvedExpectVal}' to${negated ? " not" : ""} be type '${expectedType}'`
    )
    return undefined
  }

  const toHaveLengthFn = (expectedLength: any) => {
    if (!(Array.isArray(resolvedExpectVal) || typeof resolvedExpectVal === "string")) {
      pushResult("error", "Expected toHaveLength to be called for an array or string")
      return undefined
    }
    if (!(typeof expectedLength === "number" && !Number.isNaN(expectedLength))) {
      pushResult("error", "Argument for toHaveLength should be a number")
      return undefined
    }
    baseAssert(
      (resolvedExpectVal as any).length === expectedLength,
      `Expected the array to${negated ? " not" : ""} be of length '${expectedLength}'`
    )
    return undefined
  }

  const toIncludeFn = (needle: any) => {
    if (!(Array.isArray(resolvedExpectVal) || typeof resolvedExpectVal === "string")) {
      pushResult("error", "Expected toInclude to be called for an array or string")
      return undefined
    }
    if (needle === null) {
      pushResult("error", "Argument for toInclude should not be null")
      return undefined
    }
    if (needle === undefined) {
      pushResult("error", "Argument for toInclude should not be undefined")
      return undefined
    }
    const expectValPretty = JSON.stringify(resolvedExpectVal)
    const needlePretty = JSON.stringify(needle)
    baseAssert(
      (resolvedExpectVal as any).includes(needle),
      `Expected ${expectValPretty} to${negated ? " not" : ""} include ${needlePretty}`
    )
    return undefined
  }

  // Numeric comparisons
  const getNumeric = (val: any) => {
    if (typeof val === "number") return val
    if (typeof val === "string" && val.trim() !== "") {
      const n = Number(val)
      if (!Number.isNaN(n)) return n
    }
    return undefined
  }

  const comparison = (
    comparator: "gt" | "lt" | "gte" | "lte",
    expected: any
  ) => {
    const actualNum = getNumeric(resolvedExpectVal)
    if (actualNum === undefined) {
      pushResult(
        "error",
        `Expected numeric comparison but could not parse value '${resolvedExpectVal}'`
      )
      return
    }
    if (typeof expected !== "number" || Number.isNaN(expected)) {
      const map: Record<string, string> = {
        gt: "Argument for toBeGreaterThan should be a number",
        lt: "Argument for toBeLessThan should be a number",
        gte: "Argument for toBeGreaterThanOrEqual should be a number",
        lte: "Argument for toBeLessThanOrEqual should be a number",
      }
      pushResult("error", map[comparator])
      return
    }
    let ok = false
    let verb = ""
    switch (comparator) {
      case "gt":
        ok = actualNum > expected
        verb = "greater than"
        break
      case "lt":
        ok = actualNum < expected
        verb = "less than"
        break
      case "gte":
        ok = actualNum >= expected
        verb = "greater than or equal to"
        break
      case "lte":
        ok = actualNum <= expected
        verb = "less than or equal to"
        break
    }
    baseAssert(
      ok,
      `Expected '${actualNum}' to${negated ? " not" : ""} be ${verb} '${expected}'`
    )
  }

  const toBeGreaterThanFn = (expected: any) => {
    comparison("gt", expected)
    return undefined
  }
  const toBeLessThanFn = (expected: any) => {
    comparison("lt", expected)
    return undefined
  }
  const toBeGreaterThanOrEqualFn = (expected: any) => {
    comparison("gte", expected)
    return undefined
  }
  const toBeLessThanOrEqualFn = (expected: any) => {
    comparison("lte", expected)
    return undefined
  }

  const result = {
    toBe: toBeFn,
    toBeLevel2xx: toBeLevel2xxFn,
    toBeLevel3xx: toBeLevel3xxFn,
    toBeLevel4xx: toBeLevel4xxFn,
    toBeLevel5xx: toBeLevel5xxFn,
    toBeType: toBeTypeFn,
    toHaveLength: toHaveLengthFn,
    toInclude: toIncludeFn,
    toBeGreaterThan: toBeGreaterThanFn,
    toBeLessThan: toBeLessThanFn,
    toBeGreaterThanOrEqual: toBeGreaterThanOrEqualFn,
    toBeLessThanOrEqual: toBeLessThanOrEqualFn,
  } as Expectation

  Object.defineProperties(result, {
    not: {
      get: () => createExpectation(expectVal, !negated, currTestStack),
    },
  })

  return result
}

// Pre-request methods (no tests stack returned)
export const getPreRequestScriptMethods = (envs: TestResult["envs"]) => {
  const { methods, updatedEnvs } = getSharedMethods(cloneDeep(envs))
  return { pw: methods, updatedEnvs }
}

// Post-request/test runner methods
export const getTestRunnerScriptMethods = (envs: TestResult["envs"]) => {
  const testRunStack: TestDescriptor[] = [
    { descriptor: "root", expectResults: [], children: [] },
  ]

  const testFn = (descriptor: string, testFunc: () => void) => {
    testRunStack.push({ descriptor, expectResults: [], children: [] })
    testFunc()
    const child = testRunStack.pop() as TestDescriptor
    testRunStack[testRunStack.length - 1].children.push(child)
  }

  const expectFn = (expectVal: any) =>
    createExpectation(expectVal, false, testRunStack)

  const { methods, updatedEnvs } = getSharedMethods(cloneDeep(envs))
  const pw = { ...methods, expect: expectFn, test: testFn }
  return { pw, testRunStack, updatedEnvs }
}
