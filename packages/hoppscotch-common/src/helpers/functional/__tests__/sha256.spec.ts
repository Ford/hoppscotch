import { createHash } from "crypto"
import { afterEach, describe, expect, test, vi } from "vitest"
import { sha256, sha256Fallback } from "../sha256"

const hex = (buf: ArrayBuffer) => Buffer.from(buf).toString("hex")
const enc = (s: string) => new TextEncoder().encode(s)

describe("sha256Fallback", () => {
  test.each([
    "",
    "abc",
    "a".repeat(55),
    "a".repeat(56),
    "a".repeat(64),
    "a".repeat(1000),
    "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
  ])("matches node crypto for input of length %#", (input) => {
    const expected = createHash("sha256").update(input).digest("hex")
    expect(hex(sha256Fallback(enc(input)))).toBe(expected)
  })

  test("produces the RFC 7636 PKCE S256 challenge", () => {
    const challenge = Buffer.from(
      sha256Fallback(enc("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"))
    ).toString("base64url")
    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
  })
})

describe("sha256", () => {
  afterEach(() => vi.unstubAllGlobals())

  test("falls back when crypto.subtle is unavailable", async () => {
    vi.stubGlobal("crypto", { getRandomValues: () => undefined })
    const expected = createHash("sha256").update("verifier").digest("hex")
    expect(hex(await sha256(enc("verifier")))).toBe(expected)
  })
})
