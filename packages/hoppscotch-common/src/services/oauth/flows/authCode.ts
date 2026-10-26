import { PersistenceService } from "~/services/persistence"
import {
  OauthAuthService,
  PersistedOAuthConfig,
  createFlowConfig,
  decodeResponseAsJSON,
  generateRandomString,
} from "../oauth.service"
import { z } from "zod"
import { getService } from "~/modules/dioc"
import * as E from "fp-ts/Either"
import { KernelInterceptorService } from "~/services/kernel-interceptor.service"
import { content } from "@hoppscotch/kernel"
import {
  refreshToken,
  OAuth2ParamSchema,
  OAuth2ClientAuthenticationType,
  applyOAuth2AdvancedParams,
  appendQueryParamsToURL,
  getBasicAuthHeaderValue,
} from "../utils"
import {
  AuthCodeGrantTypeParams,
  OAuth2AuthRequestParam,
} from "@hoppscotch/data"

const persistenceService = getService(PersistenceService)
const interceptorService = getService(KernelInterceptorService)

// Use the existing schema from hoppscotch-data but ensure required arrays
const AuthCodeOauthFlowParamsSchema = AuthCodeGrantTypeParams.omit({
  grantType: true,
  token: true,
})
  .extend({
    // Override optional arrays to be required for the service layer
    authRequestParams: z.array(OAuth2AuthRequestParam),
    tokenRequestParams: z.array(OAuth2ParamSchema),
    refreshRequestParams: z.array(OAuth2ParamSchema),
    tokenType: z.enum(["access_token", "id_token"]).optional(),
    useBrowserCallback: z.boolean().optional(),
    redirectURI: z.string().optional(),
    clientAuthentication: z
      .enum(["IN_BODY", "AS_BASIC_AUTH_HEADERS"])
      .optional(),
  })
  .refine(
    (params) => {
      return (
        params.authEndpoint.length >= 1 &&
        params.tokenEndpoint.length >= 1 &&
        params.clientID.length >= 1 &&
        (!params.scopes || params.scopes.trim().length >= 1)
      )
    },
    {
      message: "Minimum length requirement not met for one or more parameters",
    }
  )
  .refine((params) => (params.isPKCE ? !!params.codeVerifierMethod : true), {
    message: "codeVerifierMethod is required when using PKCE",
    path: ["codeVerifierMethod"],
  })

export type AuthCodeOauthFlowParams = z.infer<
  typeof AuthCodeOauthFlowParamsSchema
>

export type AuthCodeOauthRefreshParams = {
  tokenEndpoint: string
  clientID: string
  clientSecret?: string
  refreshToken: string
  clientAuthentication?: OAuth2ClientAuthenticationType
}

/**
 * Result of initiating the Authorization Code flow.
 * - `redirect`: the app navigated to the auth server and the token is
 *   delivered through the Hoppscotch `/oauth` callback page (default).
 * - `external`: a custom callback URL is configured, which Hoppscotch cannot
 *   receive directly. The caller must open `authUrl`, capture the URL the
 *   auth server redirects to (`redirectURI?code=...`) and pass it to
 *   `exchangeCodeForToken`.
 */
export type AuthCodeInitResult =
  | { mode: "redirect" }
  | { mode: "external"; authUrl: string; redirectURI: string }

/**
 * Whether the flow uses a custom (non-Hoppscotch) callback URL.
 * Absent/legacy configs keep using the Hoppscotch `/oauth` callback.
 */
export const usesCustomRedirectURI = (params: {
  useBrowserCallback?: boolean
  redirectURI?: string
}) => params.useBrowserCallback === false && !!params.redirectURI?.trim()

export const getEffectiveRedirectURI = (params: {
  useBrowserCallback?: boolean
  redirectURI?: string
}) =>
  usesCustomRedirectURI(params)
    ? params.redirectURI!.trim()
    : OauthAuthService.redirectURI

export const getDefaultAuthCodeOauthFlowParams =
  (): AuthCodeOauthFlowParams => ({
    authEndpoint: "",
    tokenEndpoint: "",
    clientID: "",
    clientSecret: "",
    scopes: undefined,
    isPKCE: false,
    codeVerifierMethod: "S256",
    authRequestParams: [],
    refreshRequestParams: [],
    tokenRequestParams: [],
    tokenType: "access_token",
  })

const initAuthCodeOauthFlow = async ({
  tokenEndpoint,
  clientID,
  clientSecret,
  scopes,
  authEndpoint,
  isPKCE,
  codeVerifierMethod,
  authRequestParams,
  refreshRequestParams,
  tokenRequestParams,
  tokenType,
  useBrowserCallback,
  redirectURI,
  clientAuthentication,
}: AuthCodeOauthFlowParams): Promise<E.Either<string, AuthCodeInitResult>> => {
  const state = generateRandomString()

  const effectiveRedirectURI = getEffectiveRedirectURI({
    useBrowserCallback,
    redirectURI,
  })
  const isExternalCallback = usesCustomRedirectURI({
    useBrowserCallback,
    redirectURI,
  })

  let codeVerifier: string | undefined
  let codeChallenge: string | undefined

  // Ensure backward compatibility for collections that were imported before
  // `codeVerifierMethod` was added. If PKCE is enabled but the method is
  // missing, default to 'plain' as requested by the user.
  const codeVerifierMethodNormalized =
    isPKCE && !codeVerifierMethod ? ("plain" as const) : codeVerifierMethod

  if (isPKCE) {
    codeVerifier = generateCodeVerifier()
    // codeVerifierMethodNormalized might be undefined only if isPKCE is false,
    // but here we guard with isPKCE so it's safe to pass a value.
    codeChallenge = await generateCodeChallenge(
      codeVerifier,
      codeVerifierMethodNormalized
    )
  }

  let oauthTempConfig: {
    state: string
    grant_type: "AUTHORIZATION_CODE"
    authEndpoint: string
    tokenEndpoint: string
    clientSecret?: string
    clientID: string
    isPKCE: boolean
    codeVerifier?: string
    codeVerifierMethod?: string
    codeChallenge?: string
    scopes?: string
    authRequestParams?: Array<{
      key: string
      value: string
      active: boolean
      sendIn?: string
    }>
    refreshRequestParams?: Array<{
      key: string
      value: string
      active: boolean
      sendIn?: string
    }>
    tokenRequestParams?: Array<{
      key: string
      value: string
      active: boolean
      sendIn?: string
    }>
    tokenType?: "access_token" | "id_token"
    redirectURI: string
    useBrowserCallback?: boolean
    clientAuthentication?: OAuth2ClientAuthenticationType
  } = {
    state,
    grant_type: "AUTHORIZATION_CODE",
    authEndpoint,
    tokenEndpoint,
    clientSecret,
    clientID,
    isPKCE,
    // Persist the normalized method so subsequent redirect handling has a value
    codeVerifierMethod: codeVerifierMethodNormalized,
    scopes,
    authRequestParams,
    refreshRequestParams,
    tokenRequestParams,
    tokenType,
    // Persisted so the token request uses the exact same `redirect_uri`
    redirectURI: effectiveRedirectURI,
    useBrowserCallback,
    clientAuthentication,
  }

  if (codeVerifier && codeChallenge) {
    oauthTempConfig = {
      ...oauthTempConfig,
      codeVerifier,
      codeChallenge,
    }
  }

  const localOAuthTempConfig =
    await persistenceService.getLocalConfig("oauth_temp_config")

  const persistedOAuthConfig: PersistedOAuthConfig = localOAuthTempConfig
    ? { ...JSON.parse(localOAuthTempConfig) }
    : {}

  const { grant_type, ...rest } = oauthTempConfig

  // persist the state so we can compare it when we get redirected back
  // also persist the grant_type,tokenEndpoint and clientSecret so we can use them when we get redirected back
  await persistenceService.setLocalConfig(
    "oauth_temp_config",
    JSON.stringify(<PersistedOAuthConfig>{
      ...persistedOAuthConfig,
      fields: rest,
      grant_type,
    })
  )

  let url: URL

  try {
    url = new URL(authEndpoint)
  } catch (_e) {
    return E.left("INVALID_AUTH_ENDPOINT")
  }

  url.searchParams.set("client_id", clientID)
  url.searchParams.set("state", state)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("redirect_uri", effectiveRedirectURI)

  if (scopes) url.searchParams.set("scope", scopes)

  if (codeVerifierMethod && codeChallenge) {
    url.searchParams.set("code_challenge", codeChallenge)
    url.searchParams.set("code_challenge_method", codeVerifierMethod)
  }

  if (authRequestParams.length > 0) {
    authRequestParams.forEach((param) => {
      if (param.active && param.key && param.value) {
        url.searchParams.set(param.key, param.value)
      }
    })
  }

  if (isExternalCallback) {
    return E.right({
      mode: "external" as const,
      authUrl: url.toString(),
      redirectURI: effectiveRedirectURI,
    })
  }

  // Redirect to the authorization server
  window.location.assign(url.toString())

  return E.right({ mode: "redirect" as const })
}

/**
 * Reads the OAuth callback params from both the query string and the
 * fragment (some servers use `response_mode=fragment`). Query wins.
 */
const getCallbackParams = (callbackURL: URL) => {
  const hash = callbackURL.hash.replace(/^#\??/, "")
  const params = new URLSearchParams(hash)

  callbackURL.searchParams.forEach((value, key) => params.set(key, value))

  return params
}

const AdvancedParamFromConfigSchema = z.object({
  key: z.string(),
  value: z.string(),
  active: z.boolean(),
  sendIn: z.enum(["headers", "url", "body"]).optional(),
})

/**
 * Exchanges the authorization code found in `callbackURLString` for a token,
 * using the config persisted in `oauth_temp_config` by `init`.
 * Used by the `/oauth` page and by custom callback URL capture.
 */
export const exchangeCodeForToken = async (
  callbackURLString: string,
  localConfig: string
) => {
  let callbackURL: URL

  try {
    callbackURL = new URL(callbackURLString)
  } catch (_e) {
    return E.left("INVALID_CALLBACK_URL" as const)
  }

  const params = getCallbackParams(callbackURL)

  const code = params.get("code")
  const state = params.get("state")
  const error = params.get("error")

  if (error) {
    return E.left("AUTH_SERVER_RETURNED_ERROR")
  }

  if (!code) {
    return E.left("AUTH_TOKEN_REQUEST_FAILED")
  }

  const expectedSchema = z.object({
    source: z.optional(z.string()),
    state: z.string(),
    tokenEndpoint: z.string(),
    clientSecret: z.string(),
    clientID: z.string(),
    codeVerifier: z.string().optional(),
    codeChallenge: z.string().optional(),
    tokenType: z.enum(["access_token", "id_token"]).optional(),
    // Absent for configs persisted before custom callback support
    redirectURI: z.string().optional(),
    clientAuthentication: z
      .enum(["AS_BASIC_AUTH_HEADERS", "IN_BODY"])
      .optional()
      .catch("IN_BODY"),
    tokenRequestParams: z
      .array(AdvancedParamFromConfigSchema)
      .optional()
      .catch([]),
  })

  let rawLocalConfig: unknown

  try {
    rawLocalConfig = JSON.parse(localConfig).fields
  } catch (_e) {
    return E.left("INVALID_LOCAL_CONFIG")
  }

  const decodedLocalConfig = expectedSchema.safeParse(rawLocalConfig)

  if (!decodedLocalConfig.success) {
    return E.left("INVALID_LOCAL_CONFIG")
  }

  const config = decodedLocalConfig.data

  // check if the state matches
  if (config.state !== state) {
    return E.left("INVALID_STATE")
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  }

  const sendAsBasicAuth =
    config.clientAuthentication === "AS_BASIC_AUTH_HEADERS"

  if (sendAsBasicAuth) {
    headers.Authorization = getBasicAuthHeaderValue(
      config.clientID,
      config.clientSecret
    )
  }

  const bodyParams: Record<string, string> = {
    code,
    grant_type: "authorization_code",
    ...(!sendAsBasicAuth && {
      client_id: config.clientID,
      client_secret: config.clientSecret,
    }),
    redirect_uri: config.redirectURI || OauthAuthService.redirectURI,
    ...(config.codeVerifier && {
      code_verifier: config.codeVerifier,
    }),
  }

  const urlParams: Record<string, string> = {}

  applyOAuth2AdvancedParams(config.tokenRequestParams, {
    headers,
    urlParams,
    bodyParams,
  })

  let tokenRequestURL: string

  try {
    tokenRequestURL = appendQueryParamsToURL(config.tokenEndpoint, urlParams)
  } catch (_e) {
    return E.left("AUTH_TOKEN_REQUEST_FAILED" as const)
  }

  // exchange the code for a token
  const { response } = interceptorService.execute({
    id: Date.now(),
    url: tokenRequestURL,
    method: "POST",
    version: "HTTP/1.1",
    headers,
    content: content.urlencoded(bodyParams),
  })

  const res = await response

  if (E.isLeft(res)) {
    return E.left("AUTH_TOKEN_REQUEST_FAILED" as const)
  }

  const responsePayload = decodeResponseAsJSON(res.right)

  if (E.isLeft(responsePayload)) {
    return E.left("AUTH_TOKEN_REQUEST_FAILED" as const)
  }

  const withAccessTokenSchema = z
    .object({
      access_token: z.string().optional(),
      id_token: z.string().optional(),
      refresh_token: z.string().optional(),
    })
    .refine((data) => data.access_token || data.id_token, {
      message: "Either access_token or id_token must be present",
    })

  const parsedTokenResponse = withAccessTokenSchema.safeParse(
    responsePayload.right
  )

  if (!parsedTokenResponse.success) {
    return E.left("AUTH_TOKEN_REQUEST_INVALID_RESPONSE" as const)
  }

  // Get the token type preference from the persisted config
  const tokenTypePreference = config.tokenType || "access_token"

  return E.right({
    access_token:
      tokenTypePreference === "id_token"
        ? parsedTokenResponse.data.id_token ||
          parsedTokenResponse.data.access_token ||
          ""
        : parsedTokenResponse.data.access_token ||
          parsedTokenResponse.data.id_token ||
          "",
    refresh_token: parsedTokenResponse.data.refresh_token,
  })
}

const handleRedirectForAuthCodeOauthFlow = (localConfig: string) =>
  exchangeCodeForToken(window.location.href, localConfig)

const generateCodeVerifier = () => {
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  const length = Math.floor(Math.random() * (128 - 43 + 1)) + 43 // Random length between 43 and 128
  let codeVerifier = ""

  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length)
    codeVerifier += characters[randomIndex]
  }

  return codeVerifier
}

const generateCodeChallenge = async (
  codeVerifier: string,
  strategy: AuthCodeOauthFlowParams["codeVerifierMethod"]
) => {
  if (strategy === "plain") {
    return codeVerifier
  }

  const encoder = new TextEncoder()
  const data = encoder.encode(codeVerifier)

  const buffer = await crypto.subtle.digest("SHA-256", data)

  return encodeArrayBufferAsUrlEncodedBase64(buffer)
}

const encodeArrayBufferAsUrlEncodedBase64 = (buffer: ArrayBuffer) => {
  const hashArray = Array.from(new Uint8Array(buffer))
  const hashBase64URL = btoa(String.fromCharCode(...hashArray))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")

  return hashBase64URL
}

export default createFlowConfig(
  "AUTHORIZATION_CODE" as const,
  AuthCodeOauthFlowParamsSchema,
  initAuthCodeOauthFlow,
  handleRedirectForAuthCodeOauthFlow,
  refreshToken
)
