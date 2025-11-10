import { RelayResponse } from "@hoppscotch/kernel"
import { HoppRESTRequest } from "@hoppscotch/data"
import {
  HoppRESTResponseHeader,
  HoppRESTSuccessResponse,
} from "~/helpers/types/HoppRESTResponse"
import { getService } from "~/modules/dioc"
import { CookieJarService } from "~/services/cookie-jar.service"

export type HoppRESTTransformError = {
  type: "fail"
  error: {
    type: "transform_error"
    message: string
  }
}

const extractTiming = (response: RelayResponse): number =>
  response.meta?.timing
    ? response.meta.timing.end - response.meta.timing.start
    : 0

const extractSize = (response: RelayResponse): number =>
  response.meta?.size?.total ?? 0

export const RESTResponse = {
  async toResponse(
    response: RelayResponse,
    originalRequest: HoppRESTRequest
  ): Promise<HoppRESTSuccessResponse | HoppRESTTransformError> {
    if (!response.body.body || !(response.body.body instanceof Uint8Array)) {
      return {
        type: "fail",
        error: {
          type: "transform_error",
          message: "Invalid response body format",
        },
      }
    }

    // Extract Set-Cookie headers and store them in the cookie jar
    const headers = Object.entries(response.headers ?? {}).map(
      ([key, value]) => ({ key, value }) as HoppRESTResponseHeader
    )

    // Find Set-Cookie headers (case-insensitive)
    const setCookieHeaders = headers
      .filter(header => header.key.toLowerCase() === 'set-cookie')
      .map(header => header.value)

    if (setCookieHeaders.length > 0) {
      try {
        // Get CookieJarService instance and extract cookies
        const cookieJarService = getService(CookieJarService)
        cookieJarService.extractCookiesFromResponse(setCookieHeaders, originalRequest.endpoint)
      } catch (error) {
        console.warn("Failed to extract cookies from response:", error)
        // Don't fail the response if cookie extraction fails
      }
    }

    return {
      type: "success",
      headers,
      body: response.body.body.buffer,
      statusCode: response.status,
      statusText: response.statusText ?? "",
      meta: {
        responseSize: extractSize(response),
        responseDuration: extractTiming(response),
      },
      req: originalRequest,
    }
  },
}
