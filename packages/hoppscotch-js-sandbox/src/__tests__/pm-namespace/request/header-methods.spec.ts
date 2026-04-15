import { HoppRESTRequest } from "@hoppscotch/data"
import { describe, expect, test } from "vitest"

import { runPreRequestScript } from "~/web"
import { runTest } from "~/utils/test-helpers"

// ---------------------------------------------------------------------------
// Base request used across all tests
// ---------------------------------------------------------------------------
const baseRequest: HoppRESTRequest = {
  v: "16",
  name: "Test Request",
  endpoint: "https://example.com/api",
  method: "GET",
  headers: [
    {
      key: "Content-Type",
      value: "application/json",
      active: true,
      description: "",
    },
    {
      key: "Authorization",
      value: "Bearer token123",
      active: true,
      description: "",
    },
  ],
  params: [],
  body: { contentType: null, body: null },
  auth: { authType: "none", authActive: false },
  preRequestScript: "",
  testScript: "",
  requestVariables: [],
  responses: {},
}

const envs = { global: [], selected: [] }

// ---------------------------------------------------------------------------
// pm.request.addHeader()
// ---------------------------------------------------------------------------
describe("pm.request.addHeader()", () => {
  test("adds a new header to the request", () => {
    return expect(
      runPreRequestScript(
        `
        pm.request.addHeader({ key: "x-custom-header", value: "hello" })
        `,
        { envs, request: baseRequest }
      )
    ).resolves.toEqualRight(
      expect.objectContaining({
        updatedRequest: expect.objectContaining({
          headers: expect.arrayContaining([
            expect.objectContaining({
              key: "x-custom-header",
              value: "hello",
            }),
          ]),
        }),
      })
    )
  })

  test("adds x-forwarded-authorization header (the primary use-case)", () => {
    return expect(
      runPreRequestScript(
        `
        pm.request.addHeader({ key: "x-forwarded-authorization", value: "Bearer mytoken" })
        `,
        { envs, request: baseRequest }
      )
    ).resolves.toEqualRight(
      expect.objectContaining({
        updatedRequest: expect.objectContaining({
          headers: expect.arrayContaining([
            expect.objectContaining({
              key: "x-forwarded-authorization",
              value: "Bearer mytoken",
            }),
          ]),
        }),
      })
    )
  })

  test("preserves existing headers when adding a new one", () => {
    return expect(
      runPreRequestScript(
        `
        pm.request.addHeader({ key: "x-new", value: "newvalue" })
        `,
        { envs, request: baseRequest }
      )
    ).resolves.toEqualRight(
      expect.objectContaining({
        updatedRequest: expect.objectContaining({
          headers: expect.arrayContaining([
            expect.objectContaining({ key: "Content-Type" }),
            expect.objectContaining({ key: "Authorization" }),
            expect.objectContaining({ key: "x-new", value: "newvalue" }),
          ]),
        }),
      })
    )
  })

  test("adds header with empty value when value is omitted", () => {
    return expect(
      runPreRequestScript(
        `
        pm.request.addHeader({ key: "x-empty-value" })
        `,
        { envs, request: baseRequest }
      )
    ).resolves.toEqualRight(
      expect.objectContaining({
        updatedRequest: expect.objectContaining({
          headers: expect.arrayContaining([
            expect.objectContaining({ key: "x-empty-value", value: "" }),
          ]),
        }),
      })
    )
  })

  test("throws when called without an object argument", () => {
    return expect(
      runPreRequestScript(
        `
        pm.request.addHeader("x-bad-arg")
        `,
        { envs, request: baseRequest }
      )
    ).resolves.toEqualLeft(
      expect.stringContaining("pm.request.addHeader() requires an object")
    )
  })

  test("throws when header object is missing 'key' property", () => {
    return expect(
      runPreRequestScript(
        `
        pm.request.addHeader({ value: "no-key-here" })
        `,
        { envs, request: baseRequest }
      )
    ).resolves.toEqualLeft(
      expect.stringContaining("pm.request.addHeader() requires a 'key' property")
    )
  })
})

// ---------------------------------------------------------------------------
// pm.request.removeHeader()
// ---------------------------------------------------------------------------
describe("pm.request.removeHeader()", () => {
  test("removes a header by string name", () => {
    return expect(
      runPreRequestScript(
        `
        pm.request.removeHeader("Authorization")
        `,
        { envs, request: baseRequest }
      )
    ).resolves.toEqualRight(
      expect.objectContaining({
        updatedRequest: expect.objectContaining({
          headers: expect.not.arrayContaining([
            expect.objectContaining({ key: "Authorization" }),
          ]),
        }),
      })
    )
  })

  test("removes x-forwarded-authorization header (the primary use-case)", () => {
    const requestWithFwdAuth: HoppRESTRequest = {
      ...baseRequest,
      headers: [
        ...baseRequest.headers,
        {
          key: "x-forwarded-authorization",
          value: "Bearer old",
          active: true,
          description: "",
        },
      ],
    }

    return expect(
      runPreRequestScript(
        `
        pm.request.removeHeader("x-forwarded-authorization")
        `,
        { envs, request: requestWithFwdAuth }
      )
    ).resolves.toEqualRight(
      expect.objectContaining({
        updatedRequest: expect.objectContaining({
          headers: expect.not.arrayContaining([
            expect.objectContaining({ key: "x-forwarded-authorization" }),
          ]),
        }),
      })
    )
  })

  test("accepts an object with 'key' property instead of a plain string", () => {
    return expect(
      runPreRequestScript(
        `
        pm.request.removeHeader({ key: "Authorization" })
        `,
        { envs, request: baseRequest }
      )
    ).resolves.toEqualRight(
      expect.objectContaining({
        updatedRequest: expect.objectContaining({
          headers: expect.not.arrayContaining([
            expect.objectContaining({ key: "Authorization" }),
          ]),
        }),
      })
    )
  })

  test("does not throw when the header does not exist (no-op)", () => {
    return expect(
      runPreRequestScript(
        `
        pm.request.removeHeader("x-does-not-exist")
        `,
        { envs, request: baseRequest }
      )
    ).resolves.toEqualRight(
      expect.objectContaining({
        updatedRequest: expect.objectContaining({
          headers: expect.arrayContaining([
            expect.objectContaining({ key: "Content-Type" }),
            expect.objectContaining({ key: "Authorization" }),
          ]),
        }),
      })
    )
  })

  test("throws when called with an invalid argument", () => {
    return expect(
      runPreRequestScript(
        `
        pm.request.removeHeader(42)
        `,
        { envs, request: baseRequest }
      )
    ).resolves.toEqualLeft(
      expect.stringContaining("pm.request.removeHeader() requires a string header name")
    )
  })
})

// ---------------------------------------------------------------------------
// Combined: removeHeader then addHeader (the main real-world pattern)
// ---------------------------------------------------------------------------
describe("pm.request.removeHeader() + pm.request.addHeader() combined", () => {
  test("removes old x-forwarded-authorization and adds a fresh one", () => {
    const requestWithFwdAuth: HoppRESTRequest = {
      ...baseRequest,
      headers: [
        ...baseRequest.headers,
        {
          key: "x-forwarded-authorization",
          value: "Bearer old-token",
          active: true,
          description: "",
        },
      ],
    }

    return expect(
      runPreRequestScript(
        `
        pm.request.removeHeader("x-forwarded-authorization")
        pm.request.addHeader({ key: "x-forwarded-authorization", value: "Bearer new-token" })
        `,
        { envs, request: requestWithFwdAuth }
      )
    ).resolves.toEqualRight(
      expect.objectContaining({
        updatedRequest: expect.objectContaining({
          headers: expect.arrayContaining([
            expect.objectContaining({
              key: "x-forwarded-authorization",
              value: "Bearer new-token",
            }),
          ]),
        }),
      })
    )
  })
})

// ---------------------------------------------------------------------------
// post-request (test) scripts — both methods must throw
// ---------------------------------------------------------------------------
describe("pm.request.addHeader / removeHeader in post-request scripts", () => {
  test("pm.request.addHeader() throws in a test script", () => {
    return expect(
      runTest(
        `
        pm.test("addHeader throws in test script", () => {
          let threw = false
          try {
            pm.request.addHeader({ key: "x-test", value: "v" })
          } catch (e) {
            threw = true
            pm.expect(e.message).toInclude("not supported in post-request")
          }
          pm.expect(threw).toBe(true)
        })
        `,
        { global: [], selected: [] }
      )()
    ).resolves.toEqualRight(
      expect.arrayContaining([
        expect.objectContaining({
          children: expect.arrayContaining([
            expect.objectContaining({
              descriptor: "addHeader throws in test script",
              expectResults: expect.arrayContaining([
                expect.objectContaining({ status: "pass" }),
              ]),
            }),
          ]),
        }),
      ])
    )
  })

  test("pm.request.removeHeader() throws in a test script", () => {
    return expect(
      runTest(
        `
        pm.test("removeHeader throws in test script", () => {
          let threw = false
          try {
            pm.request.removeHeader("x-forwarded-authorization")
          } catch (e) {
            threw = true
            pm.expect(e.message).toInclude("not supported in post-request")
          }
          pm.expect(threw).toBe(true)
        })
        `,
        { global: [], selected: [] }
      )()
    ).resolves.toEqualRight(
      expect.arrayContaining([
        expect.objectContaining({
          children: expect.arrayContaining([
            expect.objectContaining({
              descriptor: "removeHeader throws in test script",
              expectResults: expect.arrayContaining([
                expect.objectContaining({ status: "pass" }),
              ]),
            }),
          ]),
        }),
      ])
    )
  })
})

