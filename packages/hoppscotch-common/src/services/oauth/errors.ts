import { useI18n } from "~/composables/i18n"

/**
 * Translates errors returned by the OAuth redirect/code exchange handling.
 */
export const translateOAuthRedirectError = (
  t: ReturnType<typeof useI18n>,
  error: string
) => {
  switch (error) {
    case "AUTH_SERVER_RETURNED_ERROR":
      return t("authorization.oauth.redirect_auth_server_returned_error")

    case "NO_AUTH_CODE":
      return t("authorization.oauth.redirect_no_auth_code")

    case "INVALID_STATE":
      return t("authorization.oauth.redirect_invalid_state")

    case "NO_TOKEN_ENDPOINT":
      return t("authorization.oauth.redirect_no_token_endpoint")

    case "NO_CLIENT_ID":
      return t("authorization.oauth.redirect_no_client_id")

    case "NO_CLIENT_SECRET":
      return t("authorization.oauth.redirect_no_client_secret")

    case "NO_CODE_VERIFIER":
      return t("authorization.oauth.redirect_no_code_verifier")

    case "AUTH_TOKEN_REQUEST_FAILED":
      return t("authorization.oauth.redirect_auth_token_request_failed")

    case "AUTH_TOKEN_REQUEST_INVALID_RESPONSE":
      return t(
        "authorization.oauth.redirect_auth_token_request_invalid_response"
      )

    case "INVALID_CALLBACK_URL":
      return t("authorization.oauth.redirect_invalid_callback_url")

    default:
      return t("authorization.oauth.something_went_wrong_on_oauth_redirect")
  }
}
