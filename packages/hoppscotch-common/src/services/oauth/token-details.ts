import { ref } from "vue"
import { OAuth2ClientAuthenticationType } from "./utils"

/**
 * Details of the latest generated OAuth 2.0 token, shown to the user in the
 * token details modal (similar to Postman's "Manage Access Tokens").
 */
export type OAuthTokenDetails = {
  /** The raw JSON returned by the token endpoint */
  response: Record<string, unknown>
  /** Details of the token request that produced the response */
  request: {
    access_token_url: string
    client_id: string
    client_secret: string
    grant_type: string
    username: string
    password: string
    client_authentication: string
  }
  timestamp: number
}

export const latestOAuthTokenDetails = ref<OAuthTokenDetails | null>(null)

export const getClientAuthenticationLabel = (
  clientAuthentication?: OAuth2ClientAuthenticationType
) => (clientAuthentication === "AS_BASIC_AUTH_HEADERS" ? "header" : "body")

export const showOAuthTokenDetails = (
  response: Record<string, unknown>,
  request: Partial<OAuthTokenDetails["request"]> &
    Pick<OAuthTokenDetails["request"], "access_token_url" | "grant_type">
) => {
  latestOAuthTokenDetails.value = {
    response,
    request: {
      client_id: "",
      client_secret: "",
      username: "",
      password: "",
      client_authentication: "body",
      ...request,
    },
    timestamp: Date.now(),
  }
}

export const hideOAuthTokenDetails = () => {
  latestOAuthTokenDetails.value = null
}
