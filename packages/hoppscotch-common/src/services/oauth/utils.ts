import * as E from "fp-ts/Either"
import { z } from "zod"
import { getService } from "~/modules/dioc"
import { KernelInterceptorService } from "~/services/kernel-interceptor.service"
import { content } from "@hoppscotch/kernel"
import { decodeResponseAsJSON } from "./oauth.service"
import {
  OAuth2AdvancedParam,
  OAuth2ClientAuthentication,
} from "@hoppscotch/data"

const interceptorService = getService(KernelInterceptorService)

// Type definition for refresh request parameters
export type RefreshRequestParam = {
  id: number
  key: string
  value: string
  active: boolean
  sendIn?: "headers" | "url" | "body"
}

// Unified refresh token parameters for all OAuth flows
export type RefreshTokenParams = {
  tokenEndpoint: string
  clientID: string
  refreshToken: string
  clientSecret?: string
  refreshRequestParams?: Array<RefreshRequestParam>
  clientAuthentication?: OAuth2ClientAuthenticationType
}

export type OAuth2ClientAuthenticationType = z.infer<
  typeof OAuth2ClientAuthentication
>

type AdvancedParam = {
  key: string
  value: string
  active: boolean
  sendIn?: "headers" | "url" | "body"
}

/**
 * Encodes a client credential component for HTTP Basic auth as described by
 * RFC 6749 Section 2.3.1 (application/x-www-form-urlencoded).
 */
export const encodeBasicAuthComponent = (component: string): string => {
  // application/x-www-form-urlencoded expects spaces to be encoded as '+', but
  // encodeURIComponent encodes them as '%20'.
  return encodeURIComponent(component).replace(/%20/g, "+")
}

export const getBasicAuthHeaderValue = (
  clientID: string,
  clientSecret?: string
) =>
  `Basic ${btoa(
    `${encodeBasicAuthComponent(clientID)}:${encodeBasicAuthComponent(
      clientSecret || ""
    )}`
  )}`

/**
 * Distributes the active advanced params into headers, URL query params or
 * body params based on their `sendIn` value (defaults to body).
 */
export const applyOAuth2AdvancedParams = (
  params: AdvancedParam[] | undefined,
  target: {
    headers: Record<string, string>
    urlParams: Record<string, string>
    bodyParams: Record<string, string>
  }
) => {
  if (!params) return

  params
    .filter((param) => param.active && param.key && param.value)
    .forEach((param) => {
      if (param.sendIn === "headers") {
        target.headers[param.key] = param.value
      } else if (param.sendIn === "url") {
        target.urlParams[param.key] = param.value
      } else {
        target.bodyParams[param.key] = param.value
      }
    })
}

/**
 * Appends the given query params to the URL. Returns the URL untouched when
 * there is nothing to append so existing endpoints are not normalised.
 */
export const appendQueryParamsToURL = (
  endpoint: string,
  urlParams: Record<string, string>
) => {
  if (Object.keys(urlParams).length === 0) return endpoint

  const url = new URL(endpoint)
  Object.entries(urlParams).forEach(([key, value]) => {
    url.searchParams.set(key, value)
  })

  return url.toString()
}

/**
 * Unified refresh token function for all OAuth flows
 * Supports both basic flows (authCode) and advanced flows (password, clientCredentials)
 * with optional advanced parameters
 */
export const refreshToken = async ({
  tokenEndpoint,
  clientID,
  refreshToken,
  clientSecret,
  refreshRequestParams,
  clientAuthentication,
}: RefreshTokenParams) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  }

  const sendAsBasicAuth = clientAuthentication === "AS_BASIC_AUTH_HEADERS"

  if (sendAsBasicAuth) {
    headers.Authorization = getBasicAuthHeaderValue(clientID, clientSecret)
  }

  const bodyParams: Record<string, string> = {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    ...(!sendAsBasicAuth && {
      client_id: clientID,
      ...(clientSecret && {
        client_secret: clientSecret,
      }),
    }),
  }

  const urlParams: Record<string, string> = {}

  applyOAuth2AdvancedParams(refreshRequestParams, {
    headers,
    urlParams,
    bodyParams,
  })

  const url = new URL(tokenEndpoint)
  Object.entries(urlParams).forEach(([key, value]) => {
    url.searchParams.set(key, value)
  })

  const { response } = interceptorService.execute({
    id: Date.now(),
    url: url.toString(),
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

  const withAccessTokenAndRefreshTokenSchema = z.object({
    access_token: z.string(),
    refresh_token: z.string().optional(),
  })

  const parsedTokenResponse = withAccessTokenAndRefreshTokenSchema.safeParse(
    responsePayload.right
  )

  return parsedTokenResponse.success
    ? E.right(parsedTokenResponse.data)
    : E.left("AUTH_TOKEN_REQUEST_INVALID_RESPONSE" as const)
}

/**
 * Common OAuth2 parameter schema
 * Used for all OAuth parameter types - omit sendIn field where not needed
 */
export const OAuth2ParamSchema = OAuth2AdvancedParam.extend({
  sendIn: z.enum(["headers", "url", "body"]).optional(),
})
