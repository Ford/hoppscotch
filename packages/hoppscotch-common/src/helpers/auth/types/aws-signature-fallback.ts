import { hmac } from "@noble/hashes/hmac.js"
import { sha256 } from "@noble/hashes/sha2.js"
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js"

type AwsV4FallbackOptions = {
  method: string
  url: string
  datetime: string
  accessKeyId: string
  secretAccessKey: string
  region: string
  service: string
  sessionToken?: string
  signQuery?: boolean
  body?: string
}

const ALGORITHM = "AWS4-HMAC-SHA256"
const TERMINATOR = "aws4_request"
const DEFAULT_PRESIGN_EXPIRY = "900"

const encodeRFC3986 = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  )

const canonicalUri = (path: string) =>
  path
    .split("/")
    .map((segment) => encodeRFC3986(segment))
    .join("/") || "/"

const sha256Hex = (value: string) => bytesToHex(sha256(utf8ToBytes(value)))

const hmacSha256 = (key: Uint8Array | string, value: string) =>
  hmac(
    sha256,
    typeof key === "string" ? utf8ToBytes(key) : key,
    utf8ToBytes(value)
  )

const getCredentialScope = (date: string, region: string, service: string) =>
  `${date}/${region}/${service}/${TERMINATOR}`

const normalizeAndSortQuery = (url: URL) => {
  const queryEntries = [...url.searchParams.entries()].map(([key, value]) => [
    encodeRFC3986(key),
    encodeRFC3986(value),
  ])

  queryEntries.sort((a, b) => {
    if (a[0] === b[0]) return a[1].localeCompare(b[1])
    return a[0].localeCompare(b[0])
  })

  return queryEntries.map(([key, value]) => `${key}=${value}`).join("&")
}

const getSigningKey = (
  secretAccessKey: string,
  date: string,
  region: string,
  service: string
) => {
  const kDate = hmacSha256(`AWS4${secretAccessKey}`, date)
  const kRegion = hmacSha256(kDate, region)
  const kService = hmacSha256(kRegion, service)
  return hmacSha256(kService, TERMINATOR)
}

const getCanonicalRequest = (
  method: string,
  url: URL,
  canonicalHeaders: string,
  signedHeaders: string,
  payloadHash: string
) =>
  [
    method.toUpperCase(),
    canonicalUri(url.pathname),
    normalizeAndSortQuery(url),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n")

const buildCanonicalHeaders = (
  url: URL,
  datetime: string,
  payloadHash: string,
  sessionToken?: string,
  signQuery = false
) => {
  const headerMap = new Map<string, string>()

  headerMap.set("host", url.host)
  headerMap.set("x-amz-date", datetime)

  if (!signQuery) {
    headerMap.set("x-amz-content-sha256", payloadHash)
  }

  if (sessionToken) {
    headerMap.set("x-amz-security-token", sessionToken)
  }

  const headerEntries = [...headerMap.entries()].sort(([a], [b]) =>
    a.localeCompare(b)
  )

  const canonicalHeaders = `${headerEntries
    .map(([key, value]) => `${key}:${value.trim().replace(/\s+/g, " ")}`)
    .join("\n")}\n`

  const signedHeaders = headerEntries.map(([key]) => key).join(";")

  return {
    canonicalHeaders,
    signedHeaders,
    headerMap,
  }
}

export const signAwsV4RequestWithJsFallback = async (
  options: AwsV4FallbackOptions
) => {
  const url = new URL(options.url)
  const amzDate = options.datetime
  const shortDate = amzDate.slice(0, 8)
  const payloadHash = options.signQuery
    ? "UNSIGNED-PAYLOAD"
    : sha256Hex(options.body ?? "")

  const { canonicalHeaders, signedHeaders, headerMap } = buildCanonicalHeaders(
    url,
    amzDate,
    payloadHash,
    options.sessionToken,
    options.signQuery
  )

  const credentialScope = getCredentialScope(
    shortDate,
    options.region,
    options.service
  )

  if (options.signQuery) {
    url.searchParams.set("X-Amz-Algorithm", ALGORITHM)
    url.searchParams.set(
      "X-Amz-Credential",
      `${options.accessKeyId}/${credentialScope}`
    )
    url.searchParams.set("X-Amz-Date", amzDate)
    url.searchParams.set("X-Amz-Expires", DEFAULT_PRESIGN_EXPIRY)
    url.searchParams.set("X-Amz-SignedHeaders", signedHeaders)

    if (options.sessionToken) {
      url.searchParams.set("X-Amz-Security-Token", options.sessionToken)
    }
  }

  const canonicalRequest = getCanonicalRequest(
    options.method,
    url,
    canonicalHeaders,
    signedHeaders,
    payloadHash
  )

  const stringToSign = [
    ALGORITHM,
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n")

  const signingKey = getSigningKey(
    options.secretAccessKey,
    shortDate,
    options.region,
    options.service
  )
  const signature = bytesToHex(hmacSha256(signingKey, stringToSign))

  if (options.signQuery) {
    url.searchParams.set("X-Amz-Signature", signature)

    return {
      url,
      headers: new Headers(),
    }
  }

  const authorizationHeader = `${ALGORITHM} Credential=${options.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  const signedHeadersMap = new Headers()
  signedHeadersMap.set("authorization", authorizationHeader)

  for (const [key, value] of headerMap.entries()) {
    signedHeadersMap.set(key, value)
  }

  return {
    url,
    headers: signedHeadersMap,
  }
}
