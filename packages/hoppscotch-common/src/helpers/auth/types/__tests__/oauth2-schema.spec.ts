import {
  HoppCollection,
  HoppGQLRequest,
  HoppRESTAuth,
  HoppRESTRequest,
  getDefaultGQLRequest,
  getDefaultRESTRequest,
} from "@hoppscotch/data"
import { describe, expect, test } from "vitest"

const baseAuthCodeGrantTypeInfo = {
  grantType: "AUTHORIZATION_CODE" as const,
  authEndpoint: "https://auth.example.com/authorize",
  tokenEndpoint: "https://auth.example.com/token",
  clientID: "client-id",
  clientSecret: "client-secret",
  scopes: "openid",
  token: "",
  isPKCE: false,
  authRequestParams: [],
  tokenRequestParams: [],
  refreshRequestParams: [],
}

const makeAuth = (grantTypeInfo: Record<string, unknown>) => ({
  authType: "oauth-2",
  authActive: true,
  addTo: "HEADERS",
  grantTypeInfo,
})

const parseGrantTypeInfo = (grantTypeInfo: Record<string, unknown>) => {
  const result = HoppRESTAuth.safeParse(makeAuth(grantTypeInfo))

  expect(result.success).toBe(true)
  if (!result.success || result.data.authType !== "oauth-2")
    throw new Error("Expected a parsed OAuth 2.0 auth")

  return result.data.grantTypeInfo
}

describe("OAuth 2.0 Authorization Code schema: custom redirect fields", () => {
  test("legacy data without the new fields stays valid and unchanged", () => {
    const info = parseGrantTypeInfo(baseAuthCodeGrantTypeInfo)

    expect(info).not.toHaveProperty("useBrowserCallback")
    expect(info).not.toHaveProperty("redirectURI")
    expect(info).not.toHaveProperty("clientAuthentication")
  })

  test("preserves the new fields when present", () => {
    const info = parseGrantTypeInfo({
      ...baseAuthCodeGrantTypeInfo,
      useBrowserCallback: false,
      redirectURI: "https://localdev.example.com:8443/login/oauth2/code/b2c",
      clientAuthentication: "AS_BASIC_AUTH_HEADERS",
    })

    expect(info).toMatchObject({
      useBrowserCallback: false,
      redirectURI: "https://localdev.example.com:8443/login/oauth2/code/b2c",
      clientAuthentication: "AS_BASIC_AUTH_HEADERS",
    })
  })

  test("falls back to safe defaults for invalid values instead of failing", () => {
    const info = parseGrantTypeInfo({
      ...baseAuthCodeGrantTypeInfo,
      useBrowserCallback: "nope",
      redirectURI: 42,
      clientAuthentication: "SOMETHING_ELSE",
    })

    expect(info).toMatchObject({
      useBrowserCallback: true,
      redirectURI: "",
      clientAuthentication: "IN_BODY",
    })
  })

  test("REST request at the latest version keeps the new fields", () => {
    const request = {
      ...getDefaultRESTRequest(),
      auth: makeAuth({
        ...baseAuthCodeGrantTypeInfo,
        useBrowserCallback: false,
        redirectURI: "https://localdev.example.com/cb",
        clientAuthentication: "IN_BODY",
      }),
    }

    const result = HoppRESTRequest.safeParse(request)

    expect(result.type).toBe("ok")
    if (result.type !== "ok") return
    expect(result.value.auth).toMatchObject({
      grantTypeInfo: {
        useBrowserCallback: false,
        redirectURI: "https://localdev.example.com/cb",
        clientAuthentication: "IN_BODY",
      },
    })
  })

  test("GraphQL request keeps the new fields", () => {
    const request = {
      ...getDefaultGQLRequest(),
      auth: makeAuth({
        ...baseAuthCodeGrantTypeInfo,
        useBrowserCallback: false,
        redirectURI: "https://localdev.example.com/cb",
      }),
    }

    const result = HoppGQLRequest.safeParse(request)

    expect(result.type).toBe("ok")
    if (result.type !== "ok") return
    expect(result.value.auth).toMatchObject({
      grantTypeInfo: {
        useBrowserCallback: false,
        redirectURI: "https://localdev.example.com/cb",
      },
    })
  })

  test("collection auth keeps the new fields", () => {
    const collection = {
      v: 12,
      name: "Collection",
      folders: [],
      requests: [],
      headers: [],
      variables: [],
      description: null,
      preRequestScript: "",
      testScript: "",
      auth: makeAuth({
        ...baseAuthCodeGrantTypeInfo,
        useBrowserCallback: false,
        redirectURI: "https://localdev.example.com/cb",
        clientAuthentication: "AS_BASIC_AUTH_HEADERS",
      }),
    }

    const result = HoppCollection.safeParse(collection)

    expect(result.type).toBe("ok")
    if (result.type !== "ok") return
    expect(result.value.auth).toMatchObject({
      grantTypeInfo: {
        useBrowserCallback: false,
        redirectURI: "https://localdev.example.com/cb",
        clientAuthentication: "AS_BASIC_AUTH_HEADERS",
      },
    })
  })
})
