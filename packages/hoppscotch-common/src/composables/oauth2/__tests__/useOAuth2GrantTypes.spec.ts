import { HoppRESTAuthOAuth2 } from "@hoppscotch/data"
import * as E from "fp-ts/Either"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { nextTick, ref } from "vue"

const { authCodeMock } = vi.hoisted(() => ({
  authCodeMock: {
    params: { safeParse: vi.fn() },
    init: vi.fn(),
    refreshToken: vi.fn(),
  },
}))

vi.mock("~/composables/i18n", () => ({
  useI18n: () => (key: string) => key,
}))

vi.mock("~/composables/toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}))

vi.mock("~/helpers/auth", () => ({
  replaceTemplateString: (s: string) => s,
  replaceTemplateStringsInObjectValues: <T>(o: T) => o,
}))

vi.mock("~/services/oauth/oauth.service", () => ({
  OauthAuthService: { redirectURI: "https://hoppscotch.test/oauth" },
}))

vi.mock("~/services/oauth/flows/authCode", () => ({
  default: authCodeMock,
  getDefaultAuthCodeOauthFlowParams: () => ({}),
}))

vi.mock("~/services/oauth/flows/clientCredentials", () => ({
  default: {},
  getDefaultClientCredentialsFlowParams: () => ({}),
}))

vi.mock("~/services/oauth/flows/implicit", () => ({
  default: {},
  getDefaultImplicitOauthFlowParams: () => ({}),
}))

vi.mock("~/services/oauth/flows/password", () => ({
  default: {},
  getDefaultPasswordFlowParams: () => ({}),
}))

import { useOAuth2GrantTypes } from "../useOAuth2GrantTypes"

type Element = { id: string; ref: { value: unknown } }

const makeAuth = (overrides: Record<string, unknown> = {}) =>
  ({
    authType: "oauth-2",
    authActive: true,
    addTo: "HEADERS",
    grantTypeInfo: {
      grantType: "AUTHORIZATION_CODE",
      authEndpoint: "https://login.example.com/authorize",
      tokenEndpoint: "https://login.example.com/token",
      clientID: "client",
      clientSecret: "secret",
      scopes: "openid",
      isPKCE: false,
      token: "",
      authRequestParams: [],
      tokenRequestParams: [],
      refreshRequestParams: [],
      ...overrides,
    },
  }) as HoppRESTAuthOAuth2

const setup = (overrides: Record<string, unknown> = {}) => {
  const auth = ref(makeAuth(overrides))
  const composable = useOAuth2GrantTypes(
    auth,
    vi.fn(),
    ref([]),
    ref([]),
    ref([]),
    ref(null),
    ref(null)
  )

  const elements = () =>
    (composable.currentOAuthGrantTypeFormElements.value ?? []) as Element[]
  const ids = () => elements().map((e) => e.id)
  const find = (id: string) => elements().find((e) => e.id === id)!

  return { auth, ids, find, ...composable }
}

const CUSTOM_REDIRECT = "https://localdev.example.com:8443/callback"

describe("useOAuth2GrantTypes - Authorization Code", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authCodeMock.params.safeParse.mockImplementation((data: unknown) => ({
      success: true,
      data,
    }))
    authCodeMock.init.mockResolvedValue(E.right({ mode: "redirect" }))
  })

  test("legacy config shows the Hoppscotch callback URL and body auth", () => {
    const { ids, find } = setup()

    expect(ids()).toContain("useBrowserCallback")
    expect(ids()).toContain("browserCallbackURL")
    expect(ids()).not.toContain("redirectURI")

    expect(find("useBrowserCallback").ref.value).toBe(true)
    expect(find("browserCallbackURL").ref.value).toBe(
      "https://hoppscotch.test/oauth"
    )
    expect(find("clientAuthentication").ref.value).toMatchObject({
      id: "IN_BODY",
    })
  })

  test("unchecking 'Authorize using browser' shows the Callback URL field", async () => {
    const { auth, ids, find } = setup()

    find("useBrowserCallback").ref.value = false
    await nextTick()

    expect(auth.value.grantTypeInfo).toMatchObject({
      useBrowserCallback: false,
    })
    expect(ids()).toContain("redirectURI")
    expect(ids()).not.toContain("browserCallbackURL")
  })

  test("editing the callback URL and client auth persists to the auth", async () => {
    const { auth, find } = setup({ useBrowserCallback: false })

    find("redirectURI").ref.value = CUSTOM_REDIRECT
    await nextTick()

    find("clientAuthentication").ref.value = {
      id: "AS_BASIC_AUTH_HEADERS",
      label: "basic",
    }
    await nextTick()

    expect(auth.value.grantTypeInfo).toMatchObject({
      redirectURI: CUSTOM_REDIRECT,
      clientAuthentication: "AS_BASIC_AUTH_HEADERS",
    })
  })

  test("runAction passes the new fields and returns the external result", async () => {
    const { runAction } = setup({
      useBrowserCallback: false,
      redirectURI: CUSTOM_REDIRECT,
      clientAuthentication: "AS_BASIC_AUTH_HEADERS",
    })

    const external = {
      mode: "external",
      authUrl: "https://login.example.com/authorize?x=1",
      redirectURI: CUSTOM_REDIRECT,
    }
    authCodeMock.init.mockResolvedValue(E.right(external))

    const res = await runAction.value!()

    expect(authCodeMock.init).toHaveBeenCalledWith(
      expect.objectContaining({
        useBrowserCallback: false,
        redirectURI: CUSTOM_REDIRECT,
        clientAuthentication: "AS_BASIC_AUTH_HEADERS",
      })
    )
    expect(res).toEqual(E.right(external))
  })

  test("runAction keeps legacy defaults and returns undefined in redirect mode", async () => {
    const { runAction } = setup()

    const res = await runAction.value!()

    expect(authCodeMock.init).toHaveBeenCalledWith(
      expect.objectContaining({
        useBrowserCallback: true,
        clientAuthentication: "IN_BODY",
      })
    )
    expect(res).toEqual(E.right(undefined))
  })

  test("runAction fails validation when the custom callback URL is empty", async () => {
    const { runAction } = setup({ useBrowserCallback: false, redirectURI: "" })

    const res = await runAction.value!()

    expect(res).toEqual(E.left("VALIDATION_FAILED"))
    expect(authCodeMock.init).not.toHaveBeenCalled()
  })

  test("refresh uses the selected client authentication", async () => {
    const { runTokenRefresh } = setup({
      refreshToken: "refresh-123",
      clientAuthentication: "AS_BASIC_AUTH_HEADERS",
    })

    authCodeMock.refreshToken.mockResolvedValue(
      E.right({ access_token: "new" })
    )

    await runTokenRefresh.value!()

    expect(authCodeMock.refreshToken).toHaveBeenCalledWith(
      expect.objectContaining({
        refreshToken: "refresh-123",
        clientAuthentication: "AS_BASIC_AUTH_HEADERS",
      })
    )
  })
})
