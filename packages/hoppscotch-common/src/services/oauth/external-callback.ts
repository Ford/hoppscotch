import { getKernelMode } from "@hoppscotch/kernel"
import { invoke } from "@tauri-apps/api/core"
import * as E from "fp-ts/Either"
import { getService } from "~/modules/dioc"
import { PersistenceService } from "~/services/persistence"
import { exchangeCodeForToken } from "./flows/authCode"

const persistenceService = getService(PersistenceService)

export const DESKTOP_CAPTURE_TIMEOUT_SECS = 300

/**
 * Errors from the desktop capture command that mean the user is done
 * (no fallback). Anything else (e.g. an older desktop shell that doesn't
 * have the command) falls back to the manual paste flow.
 */
export const TERMINAL_DESKTOP_CAPTURE_ERRORS = [
  "WINDOW_CLOSED",
  "TIMEOUT",
] as const

export type TerminalDesktopCaptureError =
  (typeof TERMINAL_DESKTOP_CAPTURE_ERRORS)[number]

export const isTerminalDesktopCaptureError = (
  error: string
): error is TerminalDesktopCaptureError =>
  (TERMINAL_DESKTOP_CAPTURE_ERRORS as readonly string[]).includes(error)

export const canCaptureInDesktopWindow = () => getKernelMode() === "desktop"

/**
 * Option B: opens the login page in a dedicated desktop window and resolves
 * with the URL the auth server redirected to.
 */
export const captureRedirectInDesktopWindow = async (
  authUrl: string,
  redirectURI: string
): Promise<E.Either<string, string>> => {
  try {
    const callbackURL = await invoke<string>("oauth_capture_redirect", {
      authUrl,
      redirectUri: redirectURI,
      timeoutSecs: DESKTOP_CAPTURE_TIMEOUT_SECS,
    })

    return E.right(callbackURL)
  } catch (e) {
    return E.left(typeof e === "string" && e ? e : "UNAVAILABLE")
  }
}

const normalisePath = (path: string) => path.replace(/\/+$/, "")

const hasCallbackParams = (url: URL) => {
  const fragmentParams = new URLSearchParams(url.hash.replace(/^#\??/, ""))

  return ["code", "error"].some(
    (key) => url.searchParams.has(key) || fragmentParams.has(key)
  )
}

/**
 * Option A validation: the pasted URL must point at the configured callback
 * URL and carry either a `code` or an `error`.
 */
export const isValidCallbackURL = (pasted: string, redirectURI: string) => {
  try {
    const url = new URL(pasted.trim())
    const expected = new URL(redirectURI)

    return (
      url.protocol === expected.protocol &&
      url.host === expected.host &&
      normalisePath(url.pathname) === normalisePath(expected.pathname) &&
      hasCallbackParams(url)
    )
  } catch (_e) {
    return false
  }
}

/**
 * Exchanges the code in the captured/pasted callback URL for a token using
 * the config persisted by `authCode.init`.
 */
export const completeExternalAuthCodeFlow = async (callbackURL: string) => {
  const localConfig =
    await persistenceService.getLocalConfig("oauth_temp_config")

  if (!localConfig) {
    return E.left("INVALID_STATE")
  }

  return exchangeCodeForToken(callbackURL.trim(), localConfig)
}

/**
 * Must run whenever an external flow ends (success, failure or cancel):
 * a leftover `oauth_temp_config` makes the collection properties modal
 * reopen on the next app load.
 */
export const clearExternalAuthCodeFlow = () =>
  persistenceService.removeLocalConfig("oauth_temp_config")
