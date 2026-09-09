import {
  Environment,
  HoppRESTAuth,
  HoppRESTHeader,
  HoppRESTParam,
  HoppRESTParams,
  HoppRESTRequest,
  parseTemplateString,
} from "@hoppscotch/data"
import { AwsV4Signer } from "aws4fetch"
import { getFinalBodyFromRequest } from "~/helpers/utils/EffectiveURL"
import { signAwsV4RequestWithJsFallback } from "./aws-signature-fallback"

type SignOptions = {
  auth: HoppRESTAuth & { authType: "aws-signature" }
  request: HoppRESTRequest
  envVars: Environment["variables"]
  signQuery?: boolean
}

const getNormalizedRegion = (regionValue: string) =>
  regionValue.trim() ? regionValue.trim() : "us-east-1"

const hasWebCryptoSupport = () => Boolean(globalThis.crypto?.subtle)

function processQueryParameters(
  params: HoppRESTParams,
  envVars: Environment["variables"],
  baseUrl: string
): { url: URL; sortedParams: Array<{ key: string; value: string }> } {
  const url = new URL(baseUrl)

  // add existing query parameters from the request in lexicographical order as per AWS documentation
  const sortedParams = params
    .filter((param) => param.active && param.key !== "")
    .map((param) => ({
      key: parseTemplateString(param.key, envVars),
      value: parseTemplateString(param.value, envVars),
    }))
    .sort((a, b) => a.key.localeCompare(b.key))

  sortedParams.forEach((param) => {
    url.searchParams.append(param.key, param.value)
  })

  return { url, sortedParams }
}

async function signAWSRequest({
  auth,
  request,
  envVars,
  signQuery = false,
}: SignOptions) {
  const currentDate = new Date()
  const amzDate = currentDate.toISOString().replace(/[:-]|\.\d{3}/g, "")

  const baseUrl = parseTemplateString(request.endpoint, envVars)
  const { url, sortedParams } = processQueryParameters(
    request.params,
    envVars,
    baseUrl
  )

  const accessKeyId = parseTemplateString(auth.accessKey, envVars)
  const secretAccessKey = parseTemplateString(auth.secretKey, envVars)
  const region = getNormalizedRegion(parseTemplateString(auth.region, envVars))
  const service = parseTemplateString(auth.serviceName, envVars)
  const sessionToken = auth.serviceToken
    ? parseTemplateString(auth.serviceToken, envVars)
    : undefined

  // Validate required AWS signature fields before signing
  if (!accessKeyId || !accessKeyId.trim()) {
    throw new Error(
      "AWS Signature: Access Key ID is required and cannot be empty"
    )
  }
  if (!secretAccessKey || !secretAccessKey.trim()) {
    throw new Error(
      "AWS Signature: Secret Access Key is required and cannot be empty"
    )
  }
  if (!service || !service.trim()) {
    throw new Error(
      "AWS Signature: Service Name is required and cannot be empty"
    )
  }

  const signerConfig: ConstructorParameters<typeof AwsV4Signer>[0] = {
    method: request.method,
    datetime: amzDate,
    accessKeyId,
    secretAccessKey,
    region,
    service,
    sessionToken,
    url: url.toString(),
    signQuery,
  }

  if (!signQuery) {
    const body = getFinalBodyFromRequest(request, envVars)
    signerConfig.body = body?.toString()
  }

  const fallbackBody =
    typeof signerConfig.body === "string" ? signerConfig.body : undefined

  const shouldUseFallback = !hasWebCryptoSupport()
  if (shouldUseFallback) {
    const sign = await signAwsV4RequestWithJsFallback({
      method: request.method,
      datetime: amzDate,
      accessKeyId,
      secretAccessKey,
      region,
      service,
      sessionToken,
      url: url.toString(),
      signQuery,
      body: fallbackBody,
    })

    return { sign, sortedParams }
  }

  try {
    const signer = new AwsV4Signer(signerConfig)
    return { sign: await signer.sign(), sortedParams }
  } catch (error) {
    if (error instanceof Error && error.message.includes("importKey")) {
      const sign = await signAwsV4RequestWithJsFallback({
        method: request.method,
        datetime: amzDate,
        accessKeyId,
        secretAccessKey,
        region,
        service,
        sessionToken,
        url: url.toString(),
        signQuery,
        body: fallbackBody,
      })

      return { sign, sortedParams }
    }

    const errorMessage = error instanceof Error ? error.message : String(error)
    throw new Error(
      `AWS Signature signing failed: ${errorMessage}. Ensure Access Key ID and Secret Access Key are valid.`
    )
  }
}

export async function generateAwsSignatureAuthHeaders(
  auth: HoppRESTAuth & { authType: "aws-signature" },
  request: HoppRESTRequest,
  envVars: Environment["variables"]
): Promise<HoppRESTHeader[]> {
  if (auth.addTo !== "HEADERS") return []

  const { sign } = await signAWSRequest({
    auth,
    request,
    envVars,
    signQuery: false,
  })
  const headers: HoppRESTHeader[] = []

  sign.headers.forEach((value, key) => {
    headers.push({
      active: true,
      key,
      value,
      description: "",
    })
  })

  return headers
}

export async function generateAwsSignatureAuthParams(
  auth: HoppRESTAuth & { authType: "aws-signature" },
  request: HoppRESTRequest,
  envVars: Environment["variables"]
): Promise<HoppRESTParam[]> {
  if (auth.addTo !== "QUERY_PARAMS") return []

  const { sign, sortedParams } = await signAWSRequest({
    auth,
    request,
    envVars,
    signQuery: true,
  })
  const params: HoppRESTParam[] = []

  const originalParams = new Set(sortedParams.map((param) => param.key))

  for (const [key, value] of sign.url.searchParams) {
    if (!originalParams.has(key)) {
      params.push({
        active: true,
        key,
        value,
        description: "",
      })
    }
  }

  return params
}
