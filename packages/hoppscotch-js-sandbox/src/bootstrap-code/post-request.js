/* eslint-disable @typescript-eslint/no-unused-expressions */
;(inputs) => {
  globalThis.pw = {
    env: {
      get: (key) => inputs.envGet(key),
      getResolve: (key) => inputs.envGetResolve(key),
      set: (key, value) => inputs.envSet(key, value),
      unset: (key) => inputs.envUnset(key),
      resolve: (key) => inputs.envResolve(key),
    },
    expect: (expectVal) => {
      const isDateInstance = expectVal instanceof Date

      const expectation = {
        toBe: (expectedVal) => inputs.expectToBe(expectVal, expectedVal),
        toBeLevel2xx: () => inputs.expectToBeLevel2xx(expectVal),
        toBeLevel3xx: () => inputs.expectToBeLevel3xx(expectVal),
        toBeLevel4xx: () => inputs.expectToBeLevel4xx(expectVal),
        toBeLevel5xx: () => inputs.expectToBeLevel5xx(expectVal),
        toBeType: (expectedType) =>
          inputs.expectToBeType(expectVal, expectedType, isDateInstance),
        toHaveLength: (expectedLength) =>
          inputs.expectToHaveLength(expectVal, expectedLength),
        toInclude: (needle) => inputs.expectToInclude(expectVal, needle),
        toBeGreaterThan: (expected) =>
          inputs.expectToBeGreaterThan(expectVal, expected),
        toBeLessThan: (expected) =>
          inputs.expectToBeLessThan(expectVal, expected),
        toBeGreaterThanOrEqual: (expected) =>
          inputs.expectToBeGreaterThanOrEqual(expectVal, expected),
        toBeLessThanOrEqual: (expected) =>
          inputs.expectToBeLessThanOrEqual(expectVal, expected),
      }

      Object.defineProperty(expectation, "not", {
        get: () => ({
          toBe: (expectedVal) => inputs.expectNotToBe(expectVal, expectedVal),
          toBeLevel2xx: () => inputs.expectNotToBeLevel2xx(expectVal),
          toBeLevel3xx: () => inputs.expectNotToBeLevel3xx(expectVal),
          toBeLevel4xx: () => inputs.expectNotToBeLevel4xx(expectVal),
          toBeLevel5xx: () => inputs.expectNotToBeLevel5xx(expectVal),
          toBeType: (expectedType) =>
            inputs.expectNotToBeType(expectVal, expectedType, isDateInstance),
          toHaveLength: (expectedLength) =>
            inputs.expectNotToHaveLength(expectVal, expectedLength),
          toInclude: (needle) => inputs.expectNotToInclude(expectVal, needle),
          toBeGreaterThan: (expected) =>
            inputs.expectNotToBeGreaterThan(expectVal, expected),
          toBeLessThan: (expected) =>
            inputs.expectNotToBeLessThan(expectVal, expected),
          toBeGreaterThanOrEqual: (expected) =>
            inputs.expectNotToBeGreaterThanOrEqual(expectVal, expected),
          toBeLessThanOrEqual: (expected) =>
            inputs.expectNotToBeLessThanOrEqual(expectVal, expected),
        }),
      })

      return expectation
    },
    test: (descriptor, testFn) => {
      inputs.preTest(descriptor)
      testFn()
      inputs.postTest()
    },
    response: inputs.getResponse(),
  }
}
