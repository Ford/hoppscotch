import {
  FormDataKeyValue,
  HoppCollection,
  HoppRESTAuth,
  HoppRESTHeader,
  HoppRESTParam,
  HoppRESTReqBody,
  HoppRESTRequest,
  HoppRESTRequestVariable,
  knownContentTypes,
  makeCollection,
  makeRESTRequest,
  ValidContentTypes,
  HoppRESTRequestResponses,
  makeHoppRESTResponseOriginalRequest,
  HoppCollectionVariable,
} from "@hoppscotch/data"
import * as A from "fp-ts/Array"
import { flow, pipe } from "fp-ts/function"
import * as O from "fp-ts/Option"
import * as S from "fp-ts/string"
import * as TE from "fp-ts/TaskEither"
import {
  DescriptionDefinition,
  Item,
  ItemGroup,
  Collection as PMCollection,
  QueryParam,
  RequestAuthDefinition,
  Variable,
  VariableDefinition,
  VariableList,
} from "postman-collection"
import { stringArrayJoin } from "~/helpers/functional/array"
import { PMRawLanguage } from "~/types/pm-coll-exts"
import { IMPORTER_INVALID_FILE_FORMAT } from "."

const safeParseJSON = (jsonStr: string) => O.tryCatch(() => JSON.parse(jsonStr))

const isPMItem = (x: unknown): x is Item => Item.isItem(x)

/**
 * Checks if the Postman collection schema version supports scripts (v2.0+)
 * @param schema - The schema URL from collection.info.schema
 * @returns true if v2.0 or v2.1, false otherwise
 */
const isSchemaVersionSupported = (schema?: string): boolean => {
  if (!schema) return false
  // Support both schema.getpostman.com and schema.postman.com
  return schema.includes("/v2.0.") || schema.includes("/v2.1.")
}

/**
 * Extracts the collection schema from raw JSON data
 * Note: PMCollection SDK doesn't expose .info.schema, so we parse raw JSON
 */
const getCollectionSchema = (jsonStr: string): string | null => {
  try {
    const data = JSON.parse(jsonStr)
    return data?.info?.schema ?? null
  } catch {
    return null
  }
}

export const replacePMVarTemplating = flow(
  S.replace(/{{\s*/g, "<<"),
  S.replace(/\s*}}/g, ">>")
)

const PMRawLanguageOptionsToContentTypeMap: Record<
  PMRawLanguage,
  ValidContentTypes
> = {
  text: "text/plain",
  javascript: "text/plain",
  json: "application/json",
  html: "text/html",
  xml: "application/xml",
}

const isPMItemGroup = (x: unknown): x is ItemGroup<Item> =>
  ItemGroup.isItemGroup(x)

const readPMCollection = (def: string) =>
  pipe(
    def,
    safeParseJSON,
    O.chain((data) =>
      O.tryCatch(() => {
        return new PMCollection(data)
      })
    )
  )

const parseDescription = (descField?: string | DescriptionDefinition) => {
  if (!descField) {
    return ""
  }

  if (typeof descField === "string") {
    return descField
  }

  return descField.content
}

const getHoppCollVariables = (
  ig: ItemGroup<Item>
): HoppCollectionVariable[] => {
  if (!("variables" in ig && ig.variables)) {
    return []
  }

  return pipe(
    (ig.variables as VariableList).all(),
    A.filter(
      (variable) =>
        variable.key !== undefined &&
        variable.key !== null &&
        variable.key.length > 0
    ),
    A.map((variable) => {
      return <HoppCollectionVariable>{
        key: replacePMVarTemplating(variable.key ?? ""),
        initialValue: replacePMVarTemplating(variable.value ?? ""),
        currentValue: "",
        secret: variable.type === "secret",
      }
    })
  )
}

const getHoppReqHeaders = (
  headers: Item["request"]["headers"] | null
): HoppRESTHeader[] => {
  if (!headers) return []
  return pipe(
    headers.all(),
    A.map((header) => {
      const description = parseDescription(header.description)

      return <HoppRESTHeader>{
        key: replacePMVarTemplating(header.key),
        value: replacePMVarTemplating(header.value),
        active: !header.disabled,
        description,
      }
    })
  )
}

const getHoppReqParams = (
  query: Item["request"]["url"]["query"] | null
): HoppRESTParam[] => {
  {
    if (!query) return []
    return pipe(
      query.all(),
      A.filter(
        (param): param is QueryParam & { key: string } =>
          param.key !== undefined && param.key !== null && param.key.length > 0
      ),
      A.map((param) => {
        const description = parseDescription(param.description)

        return <HoppRESTHeader>{
          key: replacePMVarTemplating(param.key),
          value: replacePMVarTemplating(param.value ?? ""),
          active: !param.disabled,
          description,
        }
      })
    )
  }
}

const getHoppReqVariables = (
  variables: Item["request"]["url"]["variables"] | null
): HoppRESTRequestVariable[] => {
  {
    if (!variables) return []
    return pipe(
      variables.all(),
      A.filter(
        (variable): variable is Variable =>
          variable.key !== undefined &&
          variable.key !== null &&
          variable.key.length > 0
      ),
      A.map((variable) => {
        return <HoppRESTRequestVariable>{
          key: replacePMVarTemplating(variable.key ?? ""),
          value: replacePMVarTemplating(variable.value ?? ""),
          active: !variable.disabled,
        }
      })
    )
  }
}

// This regex is used to remove unsupported unicode characters from the response body which fails in Prisma
// https://dba.stackexchange.com/questions/115029/unicode-error-with-u0000-on-copy-of-large-json-file-into-postgres
const UNSUPPORTED_UNICODES_REGEX = /[\u0000]/g

const getHoppResponseBody = (
  body: string | ArrayBuffer | undefined
): string => {
  if (!body) return ""
  if (typeof body === "string")
    return body.replace(UNSUPPORTED_UNICODES_REGEX, "")
  if (body instanceof ArrayBuffer) {
    return new TextDecoder()
      .decode(body)
      .replace(UNSUPPORTED_UNICODES_REGEX, "")
  }

  return ""
}

const getHoppResponses = (
  responses: Item["responses"]
): HoppRESTRequestResponses => {
  return Object.fromEntries(
    pipe(
      responses.all(),
      A.map((response) => {
        const res = {
          name: response.name,
          status: response.status,
          body: getHoppResponseBody(response.body),
          headers: getHoppReqHeaders(response.headers),
          code: response.code,
          originalRequest: makeHoppRESTResponseOriginalRequest({
            auth: getHoppReqAuth(response.originalRequest?.auth),
            body: getHoppReqBody({
              body: response.originalRequest?.body,
              headers: response.originalRequest?.headers ?? null,
            }) ?? { contentType: null, body: null },
            endpoint: getHoppReqURL(response.originalRequest?.url ?? null),
            headers: getHoppReqHeaders(
              response.originalRequest?.headers ?? null
            ),
            method: response.originalRequest?.method ?? "",
            name: response.originalRequest?.name ?? response.name,
            params: getHoppReqParams(
              response.originalRequest?.url.query ?? null
            ),
            requestVariables: getHoppReqVariables(
              response.originalRequest?.url.variables ?? null
            ),
          }),
        }
        return [response.name, res]
      })
    )
  )
}

type PMRequestAuthDef<
  AuthType extends RequestAuthDefinition["type"] =
    RequestAuthDefinition["type"],
> = AuthType extends RequestAuthDefinition["type"] & string
  ? // eslint-disable-next-line no-unused-vars
    { type: AuthType } & { [x in AuthType]: VariableDefinition[] }
  : { type: AuthType }

const getVariableValue = (defs: VariableDefinition[], key: string) =>
  defs.find((param) => param.key === key)?.value as string | undefined

const getHoppReqAuth = (
  hoppAuth: Item["request"]["auth"] | null
): HoppRESTAuth => {
  if (!hoppAuth) return { authType: "inherit", authActive: true }

  const auth = hoppAuth as unknown as PMRequestAuthDef

  if (auth.type === "noauth") {
    return { authType: "none", authActive: true }
  }

  if (auth.type === "basic") {
    return {
      authType: "basic",
      authActive: true,
      username: replacePMVarTemplating(
        getVariableValue(auth.basic, "username") ?? ""
      ),
      password: replacePMVarTemplating(
        getVariableValue(auth.basic, "password") ?? ""
      ),
    }
  } else if (auth.type === "apikey") {
    return {
      authType: "api-key",
      authActive: true,
      key: replacePMVarTemplating(getVariableValue(auth.apikey, "key") ?? ""),
      value: replacePMVarTemplating(
        getVariableValue(auth.apikey, "value") ?? ""
      ),
      addTo:
        getVariableValue(auth.apikey, "in") === "query"
          ? "QUERY_PARAMS"
          : "HEADERS",
    }
  } else if (auth.type === "bearer") {
    return {
      authType: "bearer",
      authActive: true,
      token: replacePMVarTemplating(
        getVariableValue(auth.bearer, "token") ?? ""
      ),
    }
  } else if (auth.type === "oauth2") {
    const accessTokenURL = replacePMVarTemplating(
      getVariableValue(auth.oauth2, "accessTokenUrl") ?? ""
    )
    const authURL = replacePMVarTemplating(
      getVariableValue(auth.oauth2, "authUrl") ?? ""
    )
    const clientId = replacePMVarTemplating(
      getVariableValue(auth.oauth2, "clientId") ?? ""
    )
    const scope = replacePMVarTemplating(
      getVariableValue(auth.oauth2, "scope") ?? ""
    )
    const token = replacePMVarTemplating(
      getVariableValue(auth.oauth2, "accessToken") ?? ""
    )
    const clientSecret = replacePMVarTemplating(
      getVariableValue(auth.oauth2, "clientSecret") ?? ""
    )

    // Check for PKCE settings
    const usePkce = getVariableValue(auth.oauth2, "usePkce")
    const isPKCE = usePkce === "true"

    // Get challenge algorithm, default to S256 if PKCE is enabled but no algorithm specified
    const challengeAlgorithm = getVariableValue(
      auth.oauth2,
      "challengeAlgorithm"
    )
    let codeVerifierMethod: "plain" | "S256" | undefined

    if (isPKCE) {
      // Postman uses "SHA-256" or "plain" - normalize to our format
      // Default to S256 for any value other than "plain"
      if (challengeAlgorithm === "plain") {
        codeVerifierMethod = "plain"
      } else {
        // Covers "S256", "SHA-256", undefined, and any other value
        codeVerifierMethod = "S256"
      }
    }

    return {
      authType: "oauth-2",
      authActive: true,
      grantTypeInfo: {
        grantType: "AUTHORIZATION_CODE",
        authEndpoint: authURL,
        clientID: clientId,
        scopes: scope,
        token: token,
        tokenEndpoint: accessTokenURL,
        clientSecret: clientSecret,
        isPKCE: isPKCE,
        ...(codeVerifierMethod ? { codeVerifierMethod } : {}),
        authRequestParams: [],
        tokenRequestParams: [],
        refreshRequestParams: [],
      },
      addTo: "HEADERS",
    }
  }

  return { authType: "inherit", authActive: true }
}

const getHoppReqBody = ({
  body,
  headers,
}: {
  body: Item["request"]["body"] | null
  headers: Item["request"]["headers"] | null
}): HoppRESTReqBody => {
  if (!body) return { contentType: null, body: null }

  if (body.mode === "formdata") {
    return {
      contentType: "multipart/form-data",
      body: pipe(
        body.formdata?.all() ?? [],
        A.map(
          (param) =>
            <FormDataKeyValue>{
              key: replacePMVarTemplating(param.key),
              value: replacePMVarTemplating(
                param.type === "text" ? String(param.value) : ""
              ),
              active: !param.disabled,
              isFile: false, // TODO: Preserve isFile state ?
            }
        )
      ),
    }
  } else if (body.mode === "urlencoded") {
    return {
      contentType: "application/x-www-form-urlencoded",
      body: pipe(
        body.urlencoded?.all() ?? [],
        A.map(
          (param) =>
            `${replacePMVarTemplating(
              param.key ?? ""
            )}: ${replacePMVarTemplating(String(param.value ?? ""))}`
        ),
        stringArrayJoin("\n")
      ),
    }
  } else if (body.mode === "raw") {
    return pipe(
      O.Do,

      // Extract content-type
      O.bind("contentType", () =>
        pipe(
          // Get the info from the content-type header
          getHoppReqHeaders(headers),
          A.findFirst(({ key }) => key.toLowerCase() === "content-type"),
          O.map((x) => x.value),

          // Make sure it is a content-type Hopp can work with
          O.filter(
            (contentType): contentType is ValidContentTypes =>
              contentType in knownContentTypes
          ),

          // Back-up plan, assume language from raw language definition
          O.alt(() =>
            pipe(
              body.options?.raw?.language,
              O.fromNullable,
              O.map((lang) => PMRawLanguageOptionsToContentTypeMap[lang])
            )
          ),

          // If that too failed, just assume "text/plain"
          O.getOrElse((): ValidContentTypes => "text/plain"),

          O.of
        )
      ),

      // Extract and parse body
      O.bind("body", () =>
        pipe(body.raw, O.fromNullable, O.map(replacePMVarTemplating))
      ),

      // Return null content-type if failed, else return parsed
      O.match(
        () =>
          <HoppRESTReqBody>{
            contentType: null,
            body: null,
          },
        ({ contentType, body }) =>
          <HoppRESTReqBody>{
            contentType,
            body,
          }
      )
    )
  } else if (body.mode === "graphql") {
    const formattedQuery = {
      // @ts-expect-error - this is a valid option, but seems like the types are not updated
      query: body.graphql?.query,
      variables: pipe(
        // @ts-expect-error - this is a valid option, but seems like the types are not updated
        body.graphql?.variables,
        safeParseJSON,
        O.getOrElse(() => undefined)
      ),
    }

    return {
      contentType: "application/json",
      body: pipe(
        JSON.stringify(formattedQuery, null, 2),
        replacePMVarTemplating
      ),
    }
  }

  // TODO: File

  return { contentType: null, body: null }
}

const getHoppReqURL = (url: Item["request"]["url"] | null): string => {
  if (!url) return ""
  return pipe(
    url.toString(false),
    S.replace(/\?.+/g, ""),
    replacePMVarTemplating
  )
}

/**
 * Extracts script content from a Postman event
 * Handles both string format and exec array format
 */
const extractScriptFromEvent = (event: any): string => {
  if (!event?.script) return ""

  if (typeof event.script === "string") {
    return event.script
  }

  if (event.script.exec && Array.isArray(event.script.exec)) {
    return event.script.exec.join("\n")
  }

  return ""
}

/**
 * Extracts prerequest and test scripts from a Postman ItemGroup (collection or folder).
 *
 * Postman stores scripts in an `event` array at the collection/folder level.
 * Each event has a `listen` field ("prerequest" or "test") and a `script` object.
 *
 * @param ig - The Postman ItemGroup (collection or folder)
 * @returns Object with preRequestScript and testScript strings (empty string if none)
 */
/**
 * Extracts prerequest and test scripts from a Postman ItemGroup (collection or folder).
 * Used by getHoppFolder() and getHoppCollections() to pass inherited scripts down.
 */
const getItemGroupScripts = (
  ig: ItemGroup<Item>
): { preRequestScript: string; testScript: string } => {
  let preRequestScript = ""
  let testScript = ""

  // `events` is the SDK accessor for the event array on ItemGroup
  if (ig.events) {
    const events = ig.events.all()
    events.forEach((event: any) => {
      if (event.listen === "prerequest") {
        preRequestScript = extractScriptFromEvent(event)
      } else if (event.listen === "test") {
        testScript = extractScriptFromEvent(event)
      }
    })
  }

  return { preRequestScript, testScript }
}

/**
 * Merges a parent (inherited) script with a child (own) script.
 *
 * Rules:
 * - Both exist  → parent + "\n\n" + child
 * - Only parent → parent
 * - Only child  → child
 * - Neither     → ""
 *
 * Ensures inherited scripts always run BEFORE the request's own script,
 * matching Postman execution order: collection → folder → request.
 */
const mergeScripts = (parent: string, child: string): string => {
  const p = parent.trim()
  const c = child.trim()
  if (p && c) return `${p}\n\n${c}`
  if (p) return p
  if (c) return c
  return ""
}

const getHoppScripts = (
  item: Item,
  importScripts: boolean
): { preRequestScript: string; testScript: string } => {
  if (!importScripts) {
    return { preRequestScript: "", testScript: "" }
  }

  let preRequestScript = ""
  let testScript = ""

  // Postman stores scripts in the events array
  if (item.events) {
    const events = item.events.all()
    events.forEach((event: any) => {
      if (event.listen === "prerequest") {
        preRequestScript = extractScriptFromEvent(event)
      } else if (event.listen === "test") {
        testScript = extractScriptFromEvent(event)
      }
    })
  }

  return { preRequestScript, testScript }
}

const getCollectionDescription = (
  docField?: string | DescriptionDefinition
): string | null => {
  if (!docField) {
    return null
  }

  if (typeof docField === "string") {
    return docField
  } else if (typeof docField === "object" && "content" in docField) {
    return docField.content || null
  }

  return null
}

const getRequestDescription = (
  docField?: string | DescriptionDefinition
): string | null => {
  if (!docField) {
    return null
  }

  if (typeof docField === "string") {
    return docField
  } else if (typeof docField === "object" && "content" in docField) {
    return docField.content || null
  }

  return null
}

const getHoppRequest = (
  item: Item,
  importScripts: boolean,
  inheritedPreRequest = "",
  inheritedTest = ""
): HoppRESTRequest => {
  const { preRequestScript: ownPre, testScript: ownTest } = getHoppScripts(
    item,
    importScripts
  )

  // Merge: collectionScript + "\n\n" + folderScript + "\n\n" + requestScript
  // inheritedPreRequest already contains the merged collection+folder scripts (done in getHoppFolder)
  const preRequestScript = mergeScripts(inheritedPreRequest, ownPre)
  const testScript = mergeScripts(inheritedTest, ownTest)

  return makeRESTRequest({
    name: item.name,
    endpoint: getHoppReqURL(item.request.url),
    method: item.request.method.toUpperCase(),
    headers: getHoppReqHeaders(item.request.headers),
    params: getHoppReqParams(item.request.url.query),
    auth: getHoppReqAuth(item.request.auth),
    body: getHoppReqBody({
      body: item.request.body,
      headers: item.request.headers,
    }),
    requestVariables: getHoppReqVariables(item.request.url.variables),
    responses: getHoppResponses(item.responses),
    preRequestScript,
    testScript,
    description: getRequestDescription(item.request.description),
  })
}

const getHoppFolder = (
  ig: ItemGroup<Item>,
  importScripts: boolean,
  inheritedPreRequest = "",
  inheritedTest = ""
): HoppCollection => {
  // Extract this folder's own scripts
  const { preRequestScript: folderPre, testScript: folderTest } = importScripts
    ? getItemGroupScripts(ig)
    : { preRequestScript: "", testScript: "" }

  // Emit lint warnings if folder-level scripts are being merged
  if (importScripts && folderPre) {
    console.warn(
      `[PM201] Postman folder-level pre-request script found in folder "${ig.name}" — merged into child requests. Review imported scripts.`
    )
  }
  if (importScripts && folderTest) {
    console.warn(
      `[PM202] Postman folder-level test script found in folder "${ig.name}" — merged into child requests. Review imported scripts.`
    )
  }

  // Build the full inherited scripts for children: collection-inherited + folder-own
  const childInheritedPre = mergeScripts(inheritedPreRequest, folderPre)
  const childInheritedTest = mergeScripts(inheritedTest, folderTest)

  return makeCollection({
    name: ig.name,
    folders: pipe(
      ig.items.all(),
      A.filter(isPMItemGroup),
      A.map((folder) =>
        getHoppFolder(
          folder,
          importScripts,
          childInheritedPre,
          childInheritedTest
        )
      )
    ),
    requests: pipe(
      ig.items.all(),
      A.filter(isPMItem),
      A.map((item) =>
        getHoppRequest(
          item,
          importScripts,
          childInheritedPre,
          childInheritedTest
        )
      )
    ),
    auth: getHoppReqAuth(ig.auth),
    headers: [],
    variables: getHoppCollVariables(ig),
    description: getCollectionDescription(ig.description),
    // Store the folder's OWN scripts on the folder object so the Properties
    // dialog can display and edit them.
    preRequestScript: importScripts ? folderPre : "",
    testScript: importScripts ? folderTest : "",
  } as Parameters<typeof makeCollection>[0])
}

export const getHoppCollections = (
  collections: PMCollection[],
  importScripts: boolean
) => {
  return collections.map((collection) => {
    // Extract collection-level scripts
    const { preRequestScript: collPre, testScript: collTest } = importScripts
      ? getItemGroupScripts(collection as unknown as ItemGroup<Item>)
      : { preRequestScript: "", testScript: "" }

    // Emit lint warnings if collection-level scripts are being merged
    if (importScripts && collPre) {
      console.warn(
        `[PM201] Postman collection-level pre-request script found in "${collection.name}" — merged into all requests. Review imported scripts.`
      )
    }
    if (importScripts && collTest) {
      console.warn(
        `[PM202] Postman collection-level test script found in "${collection.name}" — merged into all requests. Review imported scripts.`
      )
    }

    // Build the top-level HoppCollection directly here.
    // We intentionally do NOT call getHoppFolder(collection, ...) because PMCollection
    // IS an ItemGroup — calling getHoppFolder on it would re-extract its own scripts
    // a second time, causing collection-level scripts to be applied twice.
    return makeCollection({
      name: collection.name,
      folders: pipe(
        collection.items.all(),
        A.filter(isPMItemGroup),
        A.map((folder) =>
          getHoppFolder(folder, importScripts, collPre, collTest)
        )
      ),
      requests: pipe(
        collection.items.all(),
        A.filter(isPMItem),
        A.map((item) =>
          getHoppRequest(item, importScripts, collPre, collTest)
        )
      ),
      auth: getHoppReqAuth(collection.auth),
      headers: [],
      variables: getHoppCollVariables(collection),
      description: getCollectionDescription(collection.description),
      // Store the collection's OWN scripts on the collection object so the
      // Properties dialog can display and edit them.
      preRequestScript: importScripts ? collPre : "",
      testScript: importScripts ? collTest : "",
    } as Parameters<typeof makeCollection>[0])
  })
}

export const hoppPostmanImporter = (
  fileContents: string[],
  importScripts = false
) =>
  pipe(
    // Try reading
    fileContents,
    A.traverse(O.Applicative)(readPMCollection),

    O.map((collections) => {
      // Validate schema version if importing scripts
      if (importScripts && fileContents.length > 0) {
        const schema = getCollectionSchema(fileContents[0])
        const isSupported = isSchemaVersionSupported(schema ?? undefined)

        if (!isSupported) {
          console.warn(
            `[Postman Import] Script import requested but collection schema "${schema ?? "unknown"}" does not support scripts. ` +
              `Only Postman Collection Format v2.0 and v2.1 are supported. Scripts will be skipped.`
          )
          // Skip script import for unsupported versions
          return getHoppCollections(collections, false)
        }
      }

      return getHoppCollections(collections, importScripts)
    }),

    TE.fromOption(() => IMPORTER_INVALID_FILE_FORMAT)
  )
