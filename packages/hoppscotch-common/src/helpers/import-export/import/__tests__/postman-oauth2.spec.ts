import * as E from "fp-ts/Either"
import { describe, expect, it } from "vitest"

import { hoppPostmanImporter } from "../postman"

const V2_0_SCHEMA =
  "https://schema.getpostman.com/json/collection/v2.0.0/collection.json"
const V2_1_SCHEMA =
  "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"

const makeCollection = (auth: unknown, schema = V2_0_SCHEMA) => ({
  info: { name: "OAuth test", schema },
  item: [
    {
      name: "Request",
      request: {
        method: "GET",
        url: "https://api.example.com/resource",
        auth,
      },
    },
  ],
})

const importAuth = async (auth: unknown, schema?: string) => {
  const result = await hoppPostmanImporter([
    JSON.stringify(makeCollection(auth, schema)),
  ])()

  if (E.isLeft(result)) throw new Error(`importer failed: ${result.left}`)

  return result.right[0].requests[0].auth as Record<string, any>
}

// Mirrors an Azure B2C collection (v2.0 object format) with secrets masked
const AUTH_CODE_CUSTOM_CALLBACK = {
  type: "oauth2",
  oauth2: {
    tokenRequestParams: [],
    state: "",
    grant_type: "authorization_code",
    authRequestParams: [
      {
        key: "country_code",
        value: "USA",
        enabled: true,
        send_as: "request_url",
      },
      {
        key: "app_id",
        value: "{{appId}}",
        enabled: true,
        send_as: "request_url",
      },
      {
        key: "response_mode",
        value: "query",
        enabled: false,
        send_as: "request_url",
      },
    ],
    accessTokenUrl: "https://login.example.com/tenant/oauth2/v2.0/token",
    authUrl: "https://login.example.com/tenant/oauth2/v2.0/authorize",
    scope: "openid offline_access client-id",
    redirect_uri: "https://localdev.example.com:8443/login/oauth2/code/aadb2c",
    clientSecret: "<<masked-secret>>",
    clientId: "client-id",
    useBrowser: false,
    client_authentication: "body",
    tokenName: "New token",
    addTokenTo: "header",
  },
}

describe("hoppPostmanImporter - OAuth 2.0", () => {
  it("maps an Authorization Code config with a custom callback URL", async () => {
    const auth = await importAuth(AUTH_CODE_CUSTOM_CALLBACK)

    expect(auth.authType).toBe("oauth-2")
    expect(auth.addTo).toBe("HEADERS")
    expect(auth.grantTypeInfo).toMatchObject({
      grantType: "AUTHORIZATION_CODE",
      authEndpoint: "https://login.example.com/tenant/oauth2/v2.0/authorize",
      tokenEndpoint: "https://login.example.com/tenant/oauth2/v2.0/token",
      clientID: "client-id",
      clientSecret: "<<masked-secret>>",
      scopes: "openid offline_access client-id",
      isPKCE: false,
      useBrowserCallback: false,
      redirectURI: "https://localdev.example.com:8443/login/oauth2/code/aadb2c",
      clientAuthentication: "IN_BODY",
      tokenRequestParams: [],
      refreshRequestParams: [],
    })
    expect(auth.grantTypeInfo.authRequestParams).toEqual([
      { id: 1, key: "country_code", value: "USA", active: true },
      { id: 2, key: "app_id", value: "<<appId>>", active: true },
      { id: 3, key: "response_mode", value: "query", active: false },
    ])
  })

  it("maps the v2.1 array format, token params, basic auth and query params", async () => {
    const auth = await importAuth(
      {
        type: "oauth2",
        oauth2: [
          { key: "grant_type", value: "authorization_code_with_pkce" },
          { key: "authUrl", value: "https://auth.example.com/authorize" },
          { key: "accessTokenUrl", value: "https://auth.example.com/token" },
          { key: "clientId", value: "id" },
          { key: "clientSecret", value: "secret" },
          { key: "challengeAlgorithm", value: "S256" },
          { key: "useBrowser", value: true },
          { key: "client_authentication", value: "header" },
          { key: "addTokenTo", value: "queryParams" },
          {
            key: "tokenRequestParams",
            value: [
              {
                key: "resource",
                value: "api",
                enabled: true,
                send_as: "request_body",
              },
              {
                key: "x-tenant",
                value: "t1",
                enabled: true,
                send_as: "request_header",
              },
              {
                key: "audience",
                value: "aud",
                enabled: true,
                send_as: "request_url",
              },
            ],
          },
          {
            key: "refreshRequestParams",
            value: [{ key: "r", value: "1", enabled: true }],
          },
        ],
      },
      V2_1_SCHEMA
    )

    expect(auth.addTo).toBe("QUERY_PARAMS")
    expect(auth.grantTypeInfo).toMatchObject({
      grantType: "AUTHORIZATION_CODE",
      isPKCE: true,
      codeVerifierMethod: "S256",
      useBrowserCallback: true,
      clientAuthentication: "AS_BASIC_AUTH_HEADERS",
    })
    expect(auth.grantTypeInfo.redirectURI).toBeUndefined()
    expect(auth.grantTypeInfo.tokenRequestParams).toEqual([
      { id: 1, key: "resource", value: "api", active: true, sendIn: "body" },
      { id: 2, key: "x-tenant", value: "t1", active: true, sendIn: "headers" },
      { id: 3, key: "audience", value: "aud", active: true, sendIn: "url" },
    ])
    expect(auth.grantTypeInfo.refreshRequestParams).toEqual([
      { id: 1, key: "r", value: "1", active: true, sendIn: "body" },
    ])
  })

  it("keeps legacy output when no new Postman fields are present", async () => {
    const auth = await importAuth({
      type: "oauth2",
      oauth2: [
        { key: "authUrl", value: "https://auth.example.com/authorize" },
        { key: "accessTokenUrl", value: "https://auth.example.com/token" },
        { key: "clientId", value: "id" },
        { key: "usePkce", value: "true" },
      ],
    })

    expect(auth.addTo).toBe("HEADERS")
    expect(auth.grantTypeInfo).toMatchObject({
      grantType: "AUTHORIZATION_CODE",
      isPKCE: true,
      codeVerifierMethod: "S256",
      authRequestParams: [],
      tokenRequestParams: [],
      refreshRequestParams: [],
    })
    expect(auth.grantTypeInfo).not.toHaveProperty("redirectURI")
    expect(auth.grantTypeInfo.useBrowserCallback).toBeUndefined()
    expect(auth.grantTypeInfo.clientAuthentication).toBeUndefined()
  })

  it("falls back to the Hoppscotch callback when useBrowser is off but no redirect URI is set", async () => {
    const auth = await importAuth({
      type: "oauth2",
      oauth2: { grant_type: "authorization_code", useBrowser: false },
    })

    expect(auth.grantTypeInfo.useBrowserCallback).toBe(true)
  })

  it("maps client credentials", async () => {
    const auth = await importAuth({
      type: "oauth2",
      oauth2: {
        grant_type: "client_credentials",
        accessTokenUrl: "https://auth.example.com/token",
        clientId: "id",
        clientSecret: "secret",
        scope: "read",
        client_authentication: "header",
      },
    })

    expect(auth.grantTypeInfo).toMatchObject({
      grantType: "CLIENT_CREDENTIALS",
      authEndpoint: "https://auth.example.com/token",
      clientID: "id",
      clientSecret: "secret",
      scopes: "read",
      clientAuthentication: "AS_BASIC_AUTH_HEADERS",
    })
  })

  it("maps password credentials", async () => {
    const auth = await importAuth({
      type: "oauth2",
      oauth2: {
        grant_type: "password_credentials",
        accessTokenUrl: "https://auth.example.com/token",
        clientId: "id",
        username: "user",
        password: "{{pwd}}",
      },
    })

    expect(auth.grantTypeInfo).toMatchObject({
      grantType: "PASSWORD",
      authEndpoint: "https://auth.example.com/token",
      username: "user",
      password: "<<pwd>>",
    })
  })

  it("maps implicit", async () => {
    const auth = await importAuth({
      type: "oauth2",
      oauth2: {
        grant_type: "implicit",
        authUrl: "https://auth.example.com/authorize",
        clientId: "id",
      },
    })

    expect(auth.grantTypeInfo).toMatchObject({
      grantType: "IMPLICIT",
      authEndpoint: "https://auth.example.com/authorize",
      clientID: "id",
    })
  })
})
