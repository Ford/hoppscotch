import * as E from "fp-ts/Either"
import { beforeEach, describe, expect, test, vi } from "vitest"

const { mockInvoke, mockExchange, store } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockExchange: vi.fn(),
  store: new Map<string, string>(),
}))

vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }))

vi.mock("@hoppscotch/kernel", () => ({ getKernelMode: () => "desktop" }))

vi.mock("~/modules/dioc", () => ({
  getService: () => ({
    getLocalConfig: async (key: string) => store.get(key) ?? null,
    removeLocalConfig: async (key: string) => {
      store.delete(key)
    },
  }),
}))

vi.mock("~/services/persistence", () => ({ PersistenceService: {} }))

vi.mock("../flows/authCode", () => ({ exchangeCodeForToken: mockExchange }))

import {
  DESKTOP_CAPTURE_TIMEOUT_SECS,
  captureRedirectInDesktopWindow,
  clearExternalAuthCodeFlow,
  completeExternalAuthCodeFlow,
  isTerminalDesktopCaptureError,
  isValidCallbackURL,
} from "../external-callback"

const REDIRECT = "https://localdev.example.com:8443/login/oauth2/code/b2c"

describe("external OAuth callback handling", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    store.clear()
  })

  describe("isValidCallbackURL", () => {
    test("accepts the callback URL with a code or error", () => {
      expect(isValidCallbackURL(`${REDIRECT}?code=1&state=s`, REDIRECT)).toBe(
        true
      )
      expect(isValidCallbackURL(` ${REDIRECT}/?code=1 `, REDIRECT)).toBe(true)
      expect(isValidCallbackURL(`${REDIRECT}#code=1`, REDIRECT)).toBe(true)
      expect(
        isValidCallbackURL(`${REDIRECT}?error=access_denied`, REDIRECT)
      ).toBe(true)
    })

    test("rejects other URLs or URLs without a code/error", () => {
      expect(isValidCallbackURL(REDIRECT, REDIRECT)).toBe(false)
      expect(isValidCallbackURL("not a url", REDIRECT)).toBe(false)
      expect(
        isValidCallbackURL(
          "https://localdev.example.com/login/oauth2/code/b2c?code=1",
          REDIRECT
        )
      ).toBe(false)
      expect(
        isValidCallbackURL(
          "https://evil.example.com:8443/login/oauth2/code/b2c?code=1",
          REDIRECT
        )
      ).toBe(false)
    })
  })

  describe("captureRedirectInDesktopWindow", () => {
    test("invokes the desktop command and returns the captured URL", async () => {
      mockInvoke.mockResolvedValue(`${REDIRECT}?code=1`)

      const res = await captureRedirectInDesktopWindow("https://auth", REDIRECT)

      expect(res).toEqual(E.right(`${REDIRECT}?code=1`))
      expect(mockInvoke).toHaveBeenCalledWith("oauth_capture_redirect", {
        authUrl: "https://auth",
        redirectUri: REDIRECT,
        timeoutSecs: DESKTOP_CAPTURE_TIMEOUT_SECS,
      })
    })

    test("passes through command errors", async () => {
      mockInvoke.mockRejectedValue("WINDOW_CLOSED")

      const res = await captureRedirectInDesktopWindow("https://auth", REDIRECT)

      expect(res).toEqual(E.left("WINDOW_CLOSED"))
      expect(isTerminalDesktopCaptureError("WINDOW_CLOSED")).toBe(true)
      expect(isTerminalDesktopCaptureError("TIMEOUT")).toBe(true)
    })

    test("unknown failures (e.g. older desktop shell) are not terminal", async () => {
      mockInvoke.mockRejectedValue(new Error("command not found"))

      const res = await captureRedirectInDesktopWindow("https://auth", REDIRECT)

      expect(res).toEqual(E.left("UNAVAILABLE"))
      expect(isTerminalDesktopCaptureError("UNAVAILABLE")).toBe(false)
    })
  })

  describe("completeExternalAuthCodeFlow", () => {
    test("exchanges the code using the persisted config", async () => {
      store.set("oauth_temp_config", "{}")
      mockExchange.mockResolvedValue(E.right({ access_token: "t" }))

      const res = await completeExternalAuthCodeFlow(` ${REDIRECT}?code=1 `)

      expect(res).toEqual(E.right({ access_token: "t" }))
      expect(mockExchange).toHaveBeenCalledWith(`${REDIRECT}?code=1`, "{}")
    })

    test("fails without a persisted config", async () => {
      const res = await completeExternalAuthCodeFlow(`${REDIRECT}?code=1`)

      expect(res).toEqual(E.left("INVALID_STATE"))
      expect(mockExchange).not.toHaveBeenCalled()
    })

    test("clearExternalAuthCodeFlow removes the persisted config", async () => {
      store.set("oauth_temp_config", "{}")

      await clearExternalAuthCodeFlow()

      expect(store.has("oauth_temp_config")).toBe(false)
    })
  })
})
