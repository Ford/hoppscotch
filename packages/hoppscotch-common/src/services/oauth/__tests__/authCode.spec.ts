import * as E from "fp-ts/Either"
import { beforeEach, describe, expect, test, vi } from "vitest"

const { mockInterceptor, mockPersistence, store } = vi.hoisted(() => {
  const store = new Map<string, string>()

  return {
    store,
    mockInterceptor: { execute: vi.fn() },
    mockPersistence: {
      getLocalConfig: vi.fn(async (key: string) => store.get(key) ?? null),
      setLocalConfig: vi.fn(async (key: string, value: string) => {
        store.set(key, value)
      }),
      removeLocalConfig: vi.fn(async (key: string) => {
        store.delete(key)
      }),
    },
  }
})

vi.mock("~/modules/dioc", () => ({
  getService: (service: { ID?: string }) =>
    service?.ID === "KERNEL_INTERCEPTOR_SERVICE"
      ? mockInterceptor
      : mockPersistence,
}))

vi.mock("~/services/kernel-interceptor.service", () => ({
  KernelInterceptorService: { ID: "KERNEL_INTERCEPTOR_SERVICE" },
}))

vi.mock("~/services/persistence", () => ({
  PersistenceService: { ID: "PERSISTENCE_SERVICE" },
}))

vi.mock("@hoppscotch/kernel", () => ({
  content: {
    urlencoded: (data: Record<string, string>) => ({
      kind: "urlencoded",
      content: data,
    }),
  },
}))

import authCode, {
  AuthCodeOauthFlowParams,
  exchangeCodeForToken,
  getDefaultAuthCodeOauthFlowParams,
  getEffectiveRedirectURI,
} from "../flows/authCode"
import { refreshToken } from "../utils"
import { OauthAuthService } from "../oauth.service"

const CUSTOM_REDIRECT =
  "https://localdev.example.com:8443/login/oauth2/code/b2c"

const baseParams = (
  overrides: Partial<AuthCodeOauthFlowParams> = {}
): AuthCodeOauthFlowParams => ({
  ...getDefaultAuthCodeOauthFlowParams(),
  authEndpoint: "https://auth.example.com/authorize",
  tokenEndpoint: "https://auth.example.com/token",
  clientID: "client id",
  clientSecret: "s3cret",
  scopes: "openid offline_access",
  ...overrides,
})

const jsonResponse = (payload: unknown) => ({
  response: Promise.resolve(
    E.right({
      status: 200,
      headers: {},
      body: {
        body: new TextEncoder().encode(JSON.stringify(payload)),
        mediaType: "application/json",
      },
    })
  ),
})

const getPersistedConfig = () => store.get("oauth_temp_config")!

const getPersistedState = () => JSON.parse(getPersistedConfig()).fields.state

const lastTokenRequest = () => mockInterceptor.execute.mock.calls.at(-1)![0]

describe("Authorization Code flow", () => {
  let assignSpy: ReturnType<typeof vi.fn>
  const originalLocation = window.location

  beforeEach(() => {
    store.clear()
    vi.clearAllMocks()
    assignSpy = vi.fn()
    Object.defineProperty(window, "location", {
      value: {
        href: originalLocation.href,
        origin: originalLocation.origin,
        search: "",
        assign: assignSpy,
      },
      writable: true,
      configurable: true,
    })
    mockInterceptor.execute.mockReturnValue(
      jsonResponse({ access_token: "access", refresh_token: "refresh" })
    )
  })

  describe("getEffectiveRedirectURI", () => {
    test("defaults to the Hoppscotch callback", () => {
      expect(getEffectiveRedirectURI({})).toBe(OauthAuthService.redirectURI)
      expect(
        getEffectiveRedirectURI({
          useBrowserCallback: true,
          redirectURI: CUSTOM_REDIRECT,
        })
      ).toBe(OauthAuthService.redirectURI)
    })

    test("falls back to the Hoppscotch callback when custom URI is empty", () => {
      expect(
        getEffectiveRedirectURI({ useBrowserCallback: false, redirectURI: " " })
      ).toBe(OauthAuthService.redirectURI)
    })

    test("uses the custom callback when enabled", () => {
      expect(
        getEffectiveRedirectURI({
          useBrowserCallback: false,
          redirectURI: ` ${CUSTOM_REDIRECT} `,
        })
      ).toBe(CUSTOM_REDIRECT)
    })
  })

  describe("init", () => {
    test("default config redirects the app to the auth server (unchanged behaviour)", async () => {
      const res = await authCode.init(
        baseParams({
          authRequestParams: [
            { id: 1, key: "country_code", value: "USA", active: true },
          ],
        })
      )

      expect(res).toEqual(E.right({ mode: "redirect" }))
      expect(assignSpy).toHaveBeenCalledTimes(1)

      const url = new URL(assignSpy.mock.calls[0][0])
      expect(url.searchParams.get("redirect_uri")).toBe(
        OauthAuthService.redirectURI
      )
      expect(url.searchParams.get("response_type")).toBe("code")
      expect(url.searchParams.get("client_id")).toBe("client id")
      expect(url.searchParams.get("country_code")).toBe("USA")
      expect(url.searchParams.get("state")).toBe(getPersistedState())
    })

    test("custom callback returns the auth URL instead of navigating", async () => {
      const res = await authCode.init(
        baseParams({
          useBrowserCallback: false,
          redirectURI: CUSTOM_REDIRECT,
        })
      )

      expect(assignSpy).not.toHaveBeenCalled()
      expect(E.isRight(res)).toBe(true)
      if (!E.isRight(res) || res.right?.mode !== "external") {
        throw new Error("Expected external mode")
      }

      expect(res.right.redirectURI).toBe(CUSTOM_REDIRECT)
      const url = new URL(res.right.authUrl)
      expect(url.searchParams.get("redirect_uri")).toBe(CUSTOM_REDIRECT)

      const persisted = JSON.parse(getPersistedConfig())
      expect(persisted.grant_type).toBe("AUTHORIZATION_CODE")
      expect(persisted.fields.redirectURI).toBe(CUSTOM_REDIRECT)
    })

    test("rejects an invalid auth endpoint", async () => {
      const res = await authCode.init(baseParams({ authEndpoint: "not a url" }))
      expect(res).toEqual(E.left("INVALID_AUTH_ENDPOINT"))
    })
  })

  describe("exchangeCodeForToken", () => {
    test("legacy persisted config sends the same request as before", async () => {
      store.set(
        "oauth_temp_config",
        JSON.stringify({
          grant_type: "AUTHORIZATION_CODE",
          fields: {
            state: "abc",
            tokenEndpoint: "https://auth.example.com/token",
            clientID: "cid",
            clientSecret: "secret",
          },
        })
      )

      const res = await exchangeCodeForToken(
        `${OauthAuthService.redirectURI}?code=the-code&state=abc`,
        getPersistedConfig()
      )

      expect(res).toEqual(
        E.right({ access_token: "access", refresh_token: "refresh" })
      )
      expect(lastTokenRequest()).toEqual({
        id: expect.any(Number),
        url: "https://auth.example.com/token",
        method: "POST",
        version: "HTTP/1.1",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        content: {
          kind: "urlencoded",
          content: {
            code: "the-code",
            grant_type: "authorization_code",
            client_id: "cid",
            client_secret: "secret",
            redirect_uri: OauthAuthService.redirectURI,
          },
        },
      })
    })

    test("uses the custom redirect URI and applies token request params", async () => {
      await authCode.init(
        baseParams({
          useBrowserCallback: false,
          redirectURI: CUSTOM_REDIRECT,
          tokenRequestParams: [
            {
              id: 1,
              key: "x-trace",
              value: "t1",
              active: true,
              sendIn: "headers",
            },
            { id: 2, key: "tenant", value: "qa", active: true, sendIn: "url" },
            {
              id: 3,
              key: "audience",
              value: "api",
              active: true,
              sendIn: "body",
            },
            {
              id: 4,
              key: "ignored",
              value: "x",
              active: false,
              sendIn: "body",
            },
          ],
        })
      )

      const res = await exchangeCodeForToken(
        `${CUSTOM_REDIRECT}?code=c0de&state=${getPersistedState()}`,
        getPersistedConfig()
      )

      expect(E.isRight(res)).toBe(true)

      const req = lastTokenRequest()
      expect(req.url).toBe("https://auth.example.com/token?tenant=qa")
      expect(req.headers["x-trace"]).toBe("t1")
      expect(req.headers.Authorization).toBeUndefined()
      expect(req.content.content).toEqual({
        code: "c0de",
        grant_type: "authorization_code",
        client_id: "client id",
        client_secret: "s3cret",
        redirect_uri: CUSTOM_REDIRECT,
        audience: "api",
      })
    })

    test("sends client credentials as a basic auth header when configured", async () => {
      await authCode.init(
        baseParams({
          useBrowserCallback: false,
          redirectURI: CUSTOM_REDIRECT,
          clientAuthentication: "AS_BASIC_AUTH_HEADERS",
        })
      )

      await exchangeCodeForToken(
        `${CUSTOM_REDIRECT}?code=c0de&state=${getPersistedState()}`,
        getPersistedConfig()
      )

      const req = lastTokenRequest()
      expect(req.headers.Authorization).toBe(
        `Basic ${btoa("client+id:s3cret")}`
      )
      expect(req.content.content).not.toHaveProperty("client_id")
      expect(req.content.content).not.toHaveProperty("client_secret")
    })

    test("reads the code from the URL fragment", async () => {
      await authCode.init(
        baseParams({ useBrowserCallback: false, redirectURI: CUSTOM_REDIRECT })
      )

      const res = await exchangeCodeForToken(
        `${CUSTOM_REDIRECT}#code=frag&state=${getPersistedState()}`,
        getPersistedConfig()
      )

      expect(E.isRight(res)).toBe(true)
      expect(lastTokenRequest().content.content.code).toBe("frag")
    })

    test("rejects a mismatched state", async () => {
      await authCode.init(baseParams())

      const res = await exchangeCodeForToken(
        `${OauthAuthService.redirectURI}?code=c&state=wrong`,
        getPersistedConfig()
      )

      expect(res).toEqual(E.left("INVALID_STATE"))
      expect(mockInterceptor.execute).not.toHaveBeenCalled()
    })

    test("surfaces auth server errors", async () => {
      await authCode.init(baseParams())

      const res = await exchangeCodeForToken(
        `${OauthAuthService.redirectURI}?error=access_denied`,
        getPersistedConfig()
      )

      expect(res).toEqual(E.left("AUTH_SERVER_RETURNED_ERROR"))
    })

    test("rejects an invalid callback URL", async () => {
      await authCode.init(baseParams())

      const res = await exchangeCodeForToken("not a url", getPersistedConfig())

      expect(res).toEqual(E.left("INVALID_CALLBACK_URL"))
    })
  })

  describe("refreshToken", () => {
    test("sends credentials in the body by default (unchanged behaviour)", async () => {
      await refreshToken({
        tokenEndpoint: "https://auth.example.com/token",
        clientID: "cid",
        clientSecret: "secret",
        refreshToken: "r1",
      })

      const req = lastTokenRequest()
      expect(req.headers.Authorization).toBeUndefined()
      expect(req.content.content).toEqual({
        grant_type: "refresh_token",
        refresh_token: "r1",
        client_id: "cid",
        client_secret: "secret",
      })
    })

    test("sends credentials as basic auth when configured", async () => {
      await refreshToken({
        tokenEndpoint: "https://auth.example.com/token",
        clientID: "cid",
        clientSecret: "secret",
        refreshToken: "r1",
        clientAuthentication: "AS_BASIC_AUTH_HEADERS",
      })

      const req = lastTokenRequest()
      expect(req.headers.Authorization).toBe(`Basic ${btoa("cid:secret")}`)
      expect(req.content.content).toEqual({
        grant_type: "refresh_token",
        refresh_token: "r1",
      })
    })
  })
})
