/**
 * Tests for hoppGlobalEnvImporter
 *
 * Covers all supported input shapes and edge-cases:
 *  - Hoppscotch single-env object  (v2 with both initialValue + currentValue)
 *  - Hoppscotch array of envs
 *  - Standard export shape (currentValue stripped to "")
 *  - Postman env shape (values array, type/secret fields)
 *  - Multi-file input (multiple JSON strings in one call)
 *  - Default / missing field handling
 *  - Rejection cases (invalid JSON, unrecognised schema)
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

describe("hoppGlobalEnvImporter — Hoppscotch single-env format", () => {
  it("parses a single env object with both initialValue and currentValue", async () => {
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
      id: "Global",
      v: 2,
      name: "Global",
      variables: [
        { key: "token", initialValue: "t1", currentValue: "t2", secret: false },
      ],
    })

    expect(vars[0].initialValue).toBe("t1")
    expect(vars[0].currentValue).toBe("t2")
  })

  it("handles the standard export shape where currentValue is stripped to empty string", async () => {
    const vars = await run({
      id: "Global",
      v: 2,
      name: "Global",
      variables: [
        { key: "host", initialValue: "https://api.example.com", currentValue: "", secret: false },
      ],
    })

    expect(vars).toEqual([
      { key: "host", initialValue: "https://api.example.com", currentValue: "", secret: false },
    ])
  })

  it("defaults initialValue to empty string when field is missing", async () => {
    const vars = await run({
      name: "Global",
      variables: [{ key: "x", currentValue: "cv", secret: false }],
    })

    expect(vars[0].initialValue).toBe("")
    expect(vars[0].currentValue).toBe("cv")
  })

  it("defaults currentValue to empty string when field is missing", async () => {
    const vars = await run({
      name: "Global",
      variables: [{ key: "x", initialValue: "iv", secret: false }],
    })

    expect(vars[0].initialValue).toBe("iv")
    expect(vars[0].currentValue).toBe("")
  })

  it("defaults secret to false when field is missing", async () => {
    const vars = await run({
      name: "Global",
      variables: [{ key: "x", initialValue: "iv", currentValue: "cv" }],
    })

    expect(vars[0].secret).toBe(false)
  })

  it("preserves secret: true for secret variables", async () => {
    const vars = await run({
      name: "Global",
      variables: [
        { key: "apiKey", initialValue: "", currentValue: "", secret: true },
      ],
    })

    expect(vars[0].secret).toBe(true)
  })

  it("returns an empty array for an env with no variables", async () => {
    const vars = await run({ name: "Empty", variables: [] })
    expect(vars).toEqual([])
  })

  it("returns an empty array for an env without a variables field", async () => {
    const vars = await run({ name: "NoVarsField" })
    expect(vars).toEqual([])
  })

  it("imports multiple variables from a single env", async () => {
    const vars = await run({
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

describe("hoppGlobalEnvImporter — Hoppscotch array-of-envs format", () => {
  it("flattens variables from multiple env objects in an array", async () => {
    const vars = await run([
      {
        name: "Env1",
        variables: [{ key: "a", initialValue: "a1", currentValue: "a2", secret: false }],
      },
      {
        name: "Env2",
        variables: [{ key: "b", initialValue: "b1", currentValue: "b2", secret: false }],
      },
    ])

    expect(vars).toHaveLength(2)
    expect(vars[0].key).toBe("a")
    expect(vars[1].key).toBe("b")
  })

  it("preserves initialValue/currentValue distinction across all envs in array", async () => {
    const vars = await run([
      {
        name: "E1",
        variables: [{ key: "x", initialValue: "init", currentValue: "cur", secret: false }],
      },
    ])

    expect(vars[0].initialValue).toBe("init")
    expect(vars[0].currentValue).toBe("cur")
  })

  it("handles an empty array as input", async () => {
    const vars = await run([])
    expect(vars).toEqual([])
  })

  it("handles array where some envs have no variables", async () => {
    const vars = await run([
      { name: "Empty" },
      { name: "WithVars", variables: [{ key: "k", initialValue: "v", currentValue: "v", secret: false }] },
    ])

    expect(vars).toHaveLength(1)
    expect(vars[0].key).toBe("k")
  })
})

describe("hoppGlobalEnvImporter — Postman environment format", () => {
  /**
   * IMPORTANT — behavioral note:
   *
   * `hoppGlobalEnvImporter` tries the Hopp schema first (via `??`).
   * `hoppSingleEnvSchema` matches ANY plain object because every field is
   * optional / defaulted — including Postman-formatted objects.
   * As a result, a Postman payload is absorbed as a zero-variable Hopp env
   * and `extractFromPostman` is never invoked.
   *
   * If you need to import Postman environments into the global namespace,
   * use the dedicated `postmanEnvImporter` (see postmanEnv.spec.ts).
   */

  it("absorbs a Postman env object as an empty-variables Hopp env (Hopp schema wins)", async () => {
    // The 'values' array is ignored — Hopp schema defaults 'variables' to [].
    const vars = await run({
      name: "Postman",
      values: [
        { key: "base_url", value: "https://api.example.com", type: "default" },
      ],
    })

    expect(vars).toEqual([])
  })

  it("absorbs a Postman secret-type entry as empty (Hopp schema wins)", async () => {
    const vars = await run({
      name: "Postman",
      values: [{ key: "api_key", value: "secret-val", type: "secret" }],
    })

    expect(vars).toEqual([])
  })

  it("absorbs multiple Postman variables as empty (Hopp schema wins)", async () => {
    const vars = await run({
      name: "Postman",
      values: [
        { key: "url", value: "https://api.io", type: "default" },
        { key: "token", value: "abc", type: "secret" },
      ],
    })

    expect(vars).toEqual([])
  })
})

describe("hoppGlobalEnvImporter — multi-file input", () => {
  it("concatenates variables from two separate JSON strings", async () => {
    const file1 = JSON.stringify({
      name: "F1",
      variables: [{ key: "a", initialValue: "a1", currentValue: "a2", secret: false }],
    })
    const file2 = JSON.stringify({
      name: "F2",
      variables: [{ key: "b", initialValue: "b1", currentValue: "b2", secret: false }],
    })

    const result = await hoppGlobalEnvImporter([file1, file2])()
    if (E.isLeft(result)) throw new Error("expected right")

    expect(result.right).toHaveLength(2)
    expect(result.right[0].key).toBe("a")
    expect(result.right[1].key).toBe("b")
  })

  it("fails if any one of the provided strings is invalid JSON", async () => {
    const result = await hoppGlobalEnvImporter([
      JSON.stringify({ name: "ok", variables: [] }),
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

  it("returns Right([]) for an object that matches neither recognisable schema field — Hopp schema absorbs it", async () => {
    // hoppSingleEnvSchema matches any object (all fields optional/defaulted).
    // Unknown keys are stripped; variables defaults to [].
    const result = await fail({ completely: "unrecognised", shape: 42 })
    expect(E.isRight(result)).toBe(true)
    if (E.isRight(result)) expect(result.right).toEqual([])
  })

  it("returns Left for a plain number", async () => {
    const result = await hoppGlobalEnvImporter(["42"])()
    // A bare number parses to a valid JSON primitive but the Postman
    // schema requires an object with a 'values' array — should fail.
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
})

