/**
 * Tests for hoppGlobalEnvImporter
 *
 * Supported shapes tested:
 *  - Hoppscotch V1  ({ v:1, variables:[{ key, value, secret }] })
 *  - Hoppscotch V2  ({ v:2, variables:[{ key, initialValue, currentValue, secret }] })
 *  - Array of V1/V2 envs (flattened)
 *  - Postman env    ({ name, values:[{ key, value, type }] })
 *  - Multi-file input
 *  - Rejection / error cases (including V0 which is intentionally unsupported)
 */

import * as E from "fp-ts/Either"
import { describe, expect, it } from "vitest"

import { hoppGlobalEnvImporter } from "../hoppGlobalEnv"

// ── Helpers ───────────────────────────────────────────────────────────────────

const run = async (payloads: object | object[]) => {
  const contents = Array.isArray(payloads)
    ? payloads.map((p) => JSON.stringify(p))
    : [JSON.stringify(payloads)]
  const result = await hoppGlobalEnvImporter(contents)()
  if (E.isLeft(result)) throw new Error(`importer failed: ${String(result.left)}`)
  return result.right
}

const fail = async (payloads: object | object[]) => {
  const contents = Array.isArray(payloads)
    ? payloads.map((p) => JSON.stringify(p))
    : [JSON.stringify(payloads)]
  return hoppGlobalEnvImporter(contents)()
}

// ─────────────────────────────────────────────────────────────────────────────

describe("hoppGlobalEnvImporter — V2 format (current, { v:2, variables:[...] })", () => {
  it("parses a single V2 env with distinct initialValue and currentValue", async () => {
    const vars = await run({
      id: "Global",
      v: 2,
      name: "Global",
      variables: [
        { key: "token", initialValue: "t1", currentValue: "t2", secret: false },
      ],
    })

    expect(vars).toEqual([
      { key: "token", initialValue: "t1", currentValue: "t2", secret: false },
    ])
  })

  it("preserves distinct initialValue and currentValue (core user scenario)", async () => {
    const vars = await run({
      v: 2,
      name: "Global",
      variables: [
        { key: "token", initialValue: "t1", currentValue: "t2", secret: false },
      ],
    })

    expect(vars[0].initialValue).toBe("t1")
    expect(vars[0].currentValue).toBe("t2")
  })

  it("handles standard export shape where currentValue is stripped to empty string", async () => {
    const vars = await run({
      v: 2,
      name: "Global",
      variables: [
        { key: "host", initialValue: "https://api.example.com", currentValue: "", secret: false },
      ],
    })

    expect(vars[0].initialValue).toBe("https://api.example.com")
    expect(vars[0].currentValue).toBe("")
  })

  it("defaults initialValue to empty string when field is missing (loose format)", async () => {
    // Loose format (no 'v') uses hoppSingleEnvSchema which has defaults.
    // Strict V2 (with 'v:2') requires all fields — test that separately below.
    const vars = await run({
      name: "Global",
      variables: [{ key: "x", currentValue: "cv", secret: false }],
    })

    expect(vars[0].initialValue).toBe("")
    expect(vars[0].currentValue).toBe("cv")
  })

  it("defaults currentValue to empty string when field is missing (loose format)", async () => {
    const vars = await run({
      name: "Global",
      variables: [{ key: "x", initialValue: "iv", secret: false }],
    })

    expect(vars[0].initialValue).toBe("iv")
    expect(vars[0].currentValue).toBe("")
  })

  it("defaults secret to false when field is missing (loose format)", async () => {
    const vars = await run({
      name: "Global",
      variables: [{ key: "x", initialValue: "iv", currentValue: "cv" }],
    })

    expect(vars[0].secret).toBe(false)
  })

  it("preserves secret: true for secret variables", async () => {
    const vars = await run({
      v: 2,
      name: "Global",
      variables: [{ key: "apiKey", initialValue: "", currentValue: "", secret: true }],
    })

    expect(vars[0].secret).toBe(true)
  })

  it("returns an empty array for a V2 env with no variables", async () => {
    const vars = await run({ v: 2, name: "Empty", variables: [] })
    expect(vars).toEqual([])
  })

  it("imports multiple variables from a single V2 env", async () => {
    const vars = await run({
      v: 2,
      name: "Multi",
      variables: [
        { key: "a", initialValue: "a1", currentValue: "a2", secret: false },
        { key: "b", initialValue: "b1", currentValue: "b2", secret: false },
        { key: "c", initialValue: "", currentValue: "", secret: true },
      ],
    })

    expect(vars).toHaveLength(3)
    expect(vars.map((v) => v.key)).toEqual(["a", "b", "c"])
  })
})

describe("hoppGlobalEnvImporter — V1 format ({ v:1, variables:[{ key, value, secret }] })", () => {
  it("imports a non-secret V1 variable — 'value' promoted to both initialValue and currentValue", async () => {
    const vars = await run({
      v: 1,
      variables: [
        { key: "api_url", value: "https://api.example.com", secret: false },
      ],
    })

    expect(vars).toHaveLength(1)
    expect(vars[0].key).toBe("api_url")
    expect(vars[0].initialValue).toBe("https://api.example.com")
    expect(vars[0].currentValue).toBe("https://api.example.com")
    expect(vars[0].secret).toBe(false)
  })

  it("imports a V1 secret variable with empty initialValue and currentValue", async () => {
    const vars = await run({
      v: 1,
      variables: [{ key: "secret_token", secret: true }],
    })

    expect(vars[0].key).toBe("secret_token")
    expect(vars[0].initialValue).toBe("")
    expect(vars[0].currentValue).toBe("")
    expect(vars[0].secret).toBe(true)
  })

  it("imports multiple V1 variables — mixed secret and non-secret", async () => {
    const vars = await run({
      v: 1,
      variables: [
        { key: "host", value: "https://api.io", secret: false },
        { key: "token", secret: true },
      ],
    })

    expect(vars).toHaveLength(2)
    expect(vars[0]).toMatchObject({ key: "host", initialValue: "https://api.io", currentValue: "https://api.io", secret: false })
    expect(vars[1]).toMatchObject({ key: "token", initialValue: "", currentValue: "", secret: true })
  })

  it("returns an empty array for a V1 env with no variables", async () => {
    const vars = await run({ v: 1, variables: [] })
    expect(vars).toEqual([])
  })
})

describe("hoppGlobalEnvImporter — array of envs (V1, V2, mixed)", () => {
  it("flattens variables from multiple V2 env objects in an array", async () => {
    const vars = await run([
      { v: 2, name: "Env1", variables: [{ key: "a", initialValue: "a1", currentValue: "a2", secret: false }] },
      { v: 2, name: "Env2", variables: [{ key: "b", initialValue: "b1", currentValue: "b2", secret: false }] },
    ])

    expect(vars).toHaveLength(2)
    expect(vars[0].key).toBe("a")
    expect(vars[1].key).toBe("b")
  })

  it("flattens variables from a mixed V1 + V2 array — V1 'value' promoted correctly", async () => {
    const vars = await run([
      { v: 2, name: "Env-A", variables: [{ key: "a", initialValue: "a-init", currentValue: "a-cur", secret: false }] },
      { v: 1, variables: [{ key: "b", value: "b-val", secret: false }] },
    ])

    expect(vars).toHaveLength(2)
    expect(vars[0]).toMatchObject({ key: "a", initialValue: "a-init", currentValue: "a-cur" })
    // V1 'value' promoted to both initialValue and currentValue
    expect(vars[1]).toMatchObject({ key: "b", initialValue: "b-val", currentValue: "b-val" })
  })

  it("handles array items without a 'v' field (loose { name, variables } shape)", async () => {
    const vars = await run([
      { name: "Env1", variables: [{ key: "a", initialValue: "a1", currentValue: "a2", secret: false }] },
      { name: "Env2", variables: [{ key: "b", initialValue: "b1", currentValue: "b2", secret: false }] },
    ])

    expect(vars).toHaveLength(2)
    expect(vars[0].key).toBe("a")
    expect(vars[1].key).toBe("b")
  })

  it("handles an empty array", async () => {
    const vars = await run([])
    expect(vars).toEqual([])
  })

  it("handles array where some envs have no variables", async () => {
    const vars = await run([
      { v: 2, name: "Empty", variables: [] },
      { v: 2, name: "WithVars", variables: [{ key: "k", initialValue: "v", currentValue: "v", secret: false }] },
    ])

    expect(vars).toHaveLength(1)
    expect(vars[0].key).toBe("k")
  })
})

describe("hoppGlobalEnvImporter — Postman environment format", () => {
  it("maps Postman 'value' field to both initialValue and currentValue", async () => {
    const vars = await run({
      name: "Postman",
      values: [{ key: "base_url", value: "https://api.example.com", type: "default" }],
    })

    expect(vars[0].initialValue).toBe("https://api.example.com")
    expect(vars[0].currentValue).toBe("https://api.example.com")
    expect(vars[0].secret).toBe(false)
  })

  it("marks variable as secret when type is 'secret'", async () => {
    const vars = await run({
      name: "Postman",
      values: [{ key: "api_key", value: "secret-val", type: "secret" }],
    })

    expect(vars[0].secret).toBe(true)
    expect(vars[0].initialValue).toBe("secret-val")
  })

  it("marks variable as secret when secret boolean is true (Postman 12+)", async () => {
    const vars = await run({
      name: "Postman",
      values: [{ key: "api_key", value: "s", type: "default", secret: true }],
    })

    expect(vars[0].secret).toBe(true)
  })

  it("marks variable as not secret for type 'default' with no secret flag", async () => {
    const vars = await run({
      name: "Postman",
      values: [{ key: "url", value: "https://example.com", type: "default" }],
    })

    expect(vars[0].secret).toBe(false)
  })

  it("imports multiple Postman variables preserving secret flags", async () => {
    const vars = await run({
      name: "Postman",
      values: [
        { key: "url", value: "https://api.io", type: "default" },
        { key: "token", value: "abc", type: "secret" },
      ],
    })

    expect(vars).toHaveLength(2)
    expect(vars[0].secret).toBe(false)
    expect(vars[1].secret).toBe(true)
  })
})

describe("hoppGlobalEnvImporter — multi-file input", () => {
  it("concatenates variables from two separate JSON strings", async () => {
    const file1 = JSON.stringify({ v: 2, name: "F1", variables: [{ key: "a", initialValue: "a1", currentValue: "a2", secret: false }] })
    const file2 = JSON.stringify({ v: 2, name: "F2", variables: [{ key: "b", initialValue: "b1", currentValue: "b2", secret: false }] })

    const result = await hoppGlobalEnvImporter([file1, file2])()
    if (E.isLeft(result)) throw new Error("expected right")

    expect(result.right).toHaveLength(2)
    expect(result.right[0].key).toBe("a")
    expect(result.right[1].key).toBe("b")
  })

  it("fails if any one of the provided strings is invalid JSON", async () => {
    const result = await hoppGlobalEnvImporter([
      JSON.stringify({ v: 2, name: "ok", variables: [] }),
      "NOT_JSON",
    ])()

    expect(E.isLeft(result)).toBe(true)
  })
})

describe("hoppGlobalEnvImporter — rejection / error cases", () => {
  it("returns Left for invalid JSON input", async () => {
    const result = await hoppGlobalEnvImporter(["not json"])()
    expect(E.isLeft(result)).toBe(true)
  })

  it("returns Left for a JSON object that matches neither Hopp nor Postman schema", async () => {
    const result = await fail({ completely: "unrecognised", shape: 42 })
    expect(E.isLeft(result)).toBe(true)
  })

  it("returns Left for a plain number", async () => {
    const result = await hoppGlobalEnvImporter(["42"])()
    expect(E.isLeft(result)).toBe(true)
  })

  it("returns Left for a JSON string", async () => {
    const result = await hoppGlobalEnvImporter(['"just a string"'])()
    expect(E.isLeft(result)).toBe(true)
  })

  it("returns Left for null JSON", async () => {
    const result = await hoppGlobalEnvImporter(["null"])()
    expect(E.isLeft(result)).toBe(true)
  })

  it("returns Left for an empty string", async () => {
    const result = await hoppGlobalEnvImporter([""])()
    expect(E.isLeft(result)).toBe(true)
  })

  it("returns Left for V0 bare array (intentionally unsupported — pre-2024.10.0 format)", async () => {
    // V0 is a bare array with no 'v' field. It is ~2 years old and ambiguous
    // with the "array of multiple envs" format. Dropped intentionally.
    const result = await fail([
      { key: "host", value: "https://api.example.com", secret: false },
      { key: "token", secret: true },
    ])
    expect(E.isLeft(result)).toBe(true)
  })

  it("returns Left for a Hopp env object with an unrecognised v number", async () => {
    // e.g. a hypothetical v:99 that doesn't exist
    const result = await fail({ v: 99, variables: [] })
    expect(E.isLeft(result)).toBe(true)
  })
})

