import {
  HoppCollection,
  HoppCollectionVariable,
  HoppRESTHeaders,
  HoppRESTRequest,
} from "@hoppscotch/data"
import { Service } from "dioc"
import { hasActualScript } from "~/helpers/scripting"
import * as E from "fp-ts/Either"
import { cloneDeep } from "lodash-es"
import { nextTick, Ref } from "vue"
import {
  captureInitialEnvironmentState,
  runTestRunnerRequest,
} from "~/helpers/RequestRunner"
import {
  HoppTestRunnerDocument,
  TestRunnerConfig,
} from "~/helpers/rest/document"
import { HoppRESTResponse } from "~/helpers/types/HoppRESTResponse"
import { HoppTestData, HoppTestResult } from "~/helpers/types/HoppTestResult"
import { HoppTab } from "../tab"
import { populateValuesInInheritedCollectionVars } from "~/helpers/utils/inheritedCollectionVarTransformer"

export type TestRunnerOptions = {
  stopRef: Ref<boolean>
} & TestRunnerConfig

export type TestRunnerRequest = HoppRESTRequest & {
  type: "test-response"
  response?: HoppRESTResponse | null
  testResults?: HoppTestResult | null
  isLoading?: boolean
  error?: string
  renderResults?: boolean
  passedTests: number
  failedTests: number
}

function delay(timeMS: number) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, timeMS)
    return () => {
      clearTimeout(timeout)
      reject(new Error("Operation cancelled"))
    }
  })
}

export class TestRunnerService extends Service {
  public static readonly ID = "TEST_RUNNER_SERVICE"

  public runTests(
    tab: Ref<HoppTab<HoppTestRunnerDocument>>,
    collection: HoppCollection,
    options: TestRunnerOptions,
    ancestorPreRequestScripts: string[] = [],
    ancestorTestScripts: string[] = []
  ) {
    // Reset the result collection
    tab.value.document.status = "running"
    tab.value.document.resultCollection = {
      v: collection.v,
      id: collection.id,
      name: collection.name,
      auth: collection.auth,
      headers: collection.headers,
      folders: [],
      requests: [],
      variables: [],
      description: collection.description ?? null,
      preRequestScript: collection.preRequestScript ?? "",
      testScript: collection.testScript ?? "",
    }

    this.runTestsWithIterations(tab, collection, options)
      .then(() => {
        tab.value.document.status = "stopped"
      })
      .catch((error) => {
        if (
          error instanceof Error &&
          error.message === "Test execution stopped"
        ) {
          tab.value.document.status = "stopped"
        } else {
          tab.value.document.status = "error"
          console.error("Test runner failed:", error)
        }
      })
      .finally(() => {
        tab.value.document.status = "stopped"
      })
  }

  private async runTestsWithIterations(
    tab: Ref<HoppTab<HoppTestRunnerDocument>>,
    collection: HoppCollection,
    options: TestRunnerOptions
  ) {
    const dataset = options.dataset
    const hasDataset =
      dataset?.enabled && dataset.data && dataset.data.length > 0

    // Always use the user's iteration value
    const iterations = options.iterations || 1

    for (let iteration = 0; iteration < iterations; iteration++) {
      if (options.stopRef?.value) {
        tab.value.document.status = "stopped"
        throw new Error("Test execution stopped")
      }

      // For iterations after the first, we don't reset the result collection
      // This allows us to accumulate results across iterations
      const shouldResetCollection = iteration === 0

      // Get current iteration data if dataset is enabled
      // If iteration exceeds dataset length, reuse the last dataset row
      let iterationData: any = undefined
      if (hasDataset && dataset.data) {
        const dataIndex = Math.min(iteration, dataset.data.length - 1)
        iterationData = dataset.data[dataIndex]
      }

      // Run the collection for this iteration
      if (options.requestOrder && options.requestOrder.length > 0) {
        // Custom execution order: use flat order with resolved context
        await this.runTestsInCustomOrder(
          tab,
          collection,
          options,
          shouldResetCollection,
          iterationData
        )
      } else {
        // Default: recursive traversal in natural collection order
        await this.runTestCollection(
          tab,
          collection,
          options,
          [],
          undefined,
          undefined,
          [],
          undefined,
          shouldResetCollection,
          iterationData
        )
      }

      // Add delay between iterations (except after the last one)
      if (iteration < iterations - 1 && options.delay && options.delay > 0) {
        try {
          await delay(options.delay)
        } catch (error) {
          if (options.stopRef?.value) {
            tab.value.document.status = "stopped"
            throw new Error("Test execution stopped")
          }
        }
      }
    }
  }

  private async runTestCollection(
    tab: Ref<HoppTab<HoppTestRunnerDocument>>,
    collection: HoppCollection,
    options: TestRunnerOptions,
    parentPath: number[] = [],
    parentHeaders?: HoppRESTHeaders,
    parentAuth?: HoppRESTRequest["auth"],
    parentVariables: HoppCollection["variables"] = [],
    parentID?: string,
    shouldResetFoldersAndRequests: boolean = false,
    iterationData?: any,
    parentPreRequestScripts: string[] = [],
    parentTestScripts: string[] = []
  ) {
    try {
      // Compute inherited auth and headers for this collection
      const inheritedAuth =
        collection.auth?.authType === "inherit" && collection.auth.authActive
          ? parentAuth || { authType: "none", authActive: false }
          : collection.auth || { authType: "none", authActive: false }

      const inheritedHeaders: HoppRESTHeaders = [
        ...(parentHeaders || []),
        ...collection.headers,
      ]

      const inheritedVariables = [
        ...(populateValuesInInheritedCollectionVars(
          parentVariables,
          parentID || collection._ref_id || collection.id
        ) || []),
        ...(populateValuesInInheritedCollectionVars(
          collection.variables,
          collection._ref_id || collection.id
        ) || []),
      ]

      const inheritedPreRequestScripts = [
        ...parentPreRequestScripts,
        ...(hasActualScript(collection.preRequestScript)
          ? [collection.preRequestScript]
          : []),
      ]
      const inheritedTestScripts = [
        ...parentTestScripts,
        ...(hasActualScript(collection.testScript)
          ? [collection.testScript]
          : []),
      ]

      // Process folders progressively
      for (let i = 0; i < collection.folders.length; i++) {
        if (options.stopRef?.value) {
          tab.value.document.status = "stopped"
          throw new Error("Test execution stopped")
        }

        const folder = collection.folders[i]
        const currentPath = [...parentPath, i]

        // Add folder to the result collection only on first iteration
        if (shouldResetFoldersAndRequests) {
          this.addFolderToPath(
            tab.value.document.resultCollection!,
            currentPath,
            {
              ...cloneDeep(folder),
              folders: [],
              requests: [],
            }
          )
        }

        await this.runTestCollection(
          tab,
          folder,
          options,
          currentPath,
          inheritedHeaders,
          inheritedAuth,
          inheritedVariables,
          collection._ref_id || collection.id,
          shouldResetFoldersAndRequests,
          iterationData,
          inheritedPreRequestScripts,
          inheritedTestScripts
        )
      }

      // Process requests progressively
      for (let i = 0; i < collection.requests.length; i++) {
        if (options.stopRef?.value) {
          tab.value.document.status = "stopped"
          throw new Error("Test execution stopped")
        }

        // Check if this request should be executed based on selection state
        const requestPath = this.buildRequestPath(parentPath, i)
        const shouldExecute = this.shouldExecuteRequest(
          requestPath,
          options.requestSelection
        )

        if (!shouldExecute) {
          continue // Skip this request if not selected
        }

        const request = collection.requests[i] as TestRunnerRequest
        const currentPath = [...parentPath, i]

        // Add request to the result collection - appending for iterations
        this.appendRequestToPath(
          tab.value.document.resultCollection!,
          currentPath,
          cloneDeep(request),
          shouldResetFoldersAndRequests
        )

        // Update the request with inherited headers and auth before execution
        const finalRequest = {
          ...request,
          auth:
            request.auth.authType === "inherit" && request.auth.authActive
              ? inheritedAuth
              : request.auth,
          headers: [...inheritedHeaders, ...request.headers],
        }

        await this.runTestRequest(
          tab,
          finalRequest,
          collection,
          options,
          currentPath,
          inheritedVariables,
          shouldResetFoldersAndRequests,
          iterationData,
          inheritedPreRequestScripts,
          inheritedTestScripts
        )

        if (options.delay && options.delay > 0) {
          try {
            await delay(options.delay)
          } catch (_error) {
            if (options.stopRef?.value) {
              tab.value.document.status = "stopped"
              throw new Error("Test execution stopped")
            }
          }
        }
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "Test execution stopped"
      ) {
        throw error
      }
      tab.value.document.status = "error"
      console.error("Collection execution failed:", error)
      throw error
    }
  }

  private addFolderToPath(
    collection: HoppCollection,
    path: number[],
    folder: HoppCollection
  ) {
    let current = collection

    // Navigate to the parent folder
    for (let i = 0; i < path.length - 1; i++) {
      current = current.folders[path[i]]
    }

    // Add the folder at the specified index
    if (path.length > 0) {
      current.folders[path[path.length - 1]] = folder
    }
  }

  private appendRequestToPath(
    collection: HoppCollection,
    path: number[],
    request: TestRunnerRequest,
    shouldReplaceAtIndex: boolean = false
  ) {
    let current = collection

    // Navigate to the parent folder
    for (let i = 0; i < path.length - 1; i++) {
      current = current.folders[path[i]]
    }

    // Add or append the request
    if (path.length > 0) {
      const index = path[path.length - 1]
      if (shouldReplaceAtIndex) {
        // First iteration: set at index
        current.requests[index] = request
      } else {
        // Subsequent iterations: append
        current.requests.push(request)
      }
    }
  }

  private updateRequestAtPath(
    collection: HoppCollection,
    path: number[],
    updates: Partial<TestRunnerRequest>,
    isAppendMode: boolean = false
  ) {
    let current = collection

    // Navigate to the parent folder
    for (let i = 0; i < path.length - 1; i++) {
      current = current.folders[path[i]]
    }

    // Update the request
    if (path.length > 0) {
      const index = path[path.length - 1]
      if (isAppendMode) {
        // In append mode, update the last request in the array
        const lastIndex = current.requests.length - 1
        current.requests[lastIndex] = {
          ...current.requests[lastIndex],
          ...updates,
        } as TestRunnerRequest
      } else {
        // Normal mode: update at the specified index
        current.requests[index] = {
          ...current.requests[index],
          ...updates,
        } as TestRunnerRequest
      }
    }
  }

  private async runTestRequest(
    tab: Ref<HoppTab<HoppTestRunnerDocument>>,
    request: TestRunnerRequest,
    collection: HoppCollection,
    options: TestRunnerOptions,
    path: number[],
    inheritedVariables: HoppCollectionVariable[] = [],
    isFirstIteration: boolean = true,
    iterationData?: any,
    inheritedPreRequestScripts: string[] = [],
    inheritedTestScripts: string[] = []
  ) {
    if (options.stopRef?.value) {
      throw new Error("Test execution stopped")
    }

    const isAppendMode = !isFirstIteration

    try {
      // Update request status in the result collection
      this.updateRequestAtPath(
        tab.value.document.resultCollection!,
        path,
        {
          isLoading: true,
          error: undefined,
        },
        isAppendMode
      )

      // Force Vue to flush DOM updates before starting async work.
      // This ensures components consuming the isLoading state (such as those rendering the Send/Cancel button) update immediately.
      // Performance impact: nextTick() waits for microtask queue drain (actual latency varies based on pending microtasks)
      // but is necessary to prevent UI flicker and ensure loading indicators appear before long-running network requests.
      await nextTick()

      // Capture the initial environment state for a test run so that it remains consistent and unchanged when current environment changes
      const initialEnvironmentState = captureInitialEnvironmentState()

      const results = await runTestRunnerRequest(
        request,
        options.keepVariableValues,
        inheritedVariables,
        initialEnvironmentState,
        iterationData,
        inheritedPreRequestScripts,
        inheritedTestScripts
      )

      if (options.stopRef?.value) {
        throw new Error("Test execution stopped")
      }

      if (results && E.isRight(results)) {
        const { response, testResult, updatedRequest } = results.right
        const { passed, failed } = this.getTestResultInfo(testResult)

        tab.value.document.testRunnerMeta.totalTests += passed + failed
        tab.value.document.testRunnerMeta.passedTests += passed
        tab.value.document.testRunnerMeta.failedTests += failed

        // Update request with results and propagate pre-request script changes in the result collection
        this.updateRequestAtPath(
          tab.value.document.resultCollection!,
          path,
          {
            ...updatedRequest,
            testResults: testResult,
            response: options.persistResponses ? response : null,
            isLoading: false,
          },
          isAppendMode
        )

        if (response.type === "success" || response.type === "fail") {
          tab.value.document.testRunnerMeta.totalTime +=
            response.meta.responseDuration
          tab.value.document.testRunnerMeta.completedRequests += 1
        }
      } else {
        const errorMsg = "Request execution failed"

        // Update request with error in the result collection
        this.updateRequestAtPath(
          tab.value.document.resultCollection!,
          path,
          {
            error: errorMsg,
            isLoading: false,
            response: {
              type: "network_fail",
              error: "Unknown",
              req: request,
            },
          },
          isAppendMode
        )

        if (options.stopOnError) {
          tab.value.document.status = "stopped"
          throw new Error("Test execution stopped due to error")
        }
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "Test execution stopped"
      ) {
        throw error
      }

      const errorMsg =
        error instanceof Error ? error.message : "Unknown error occurred"

      // Update request with error in the result collection
      this.updateRequestAtPath(
        tab.value.document.resultCollection!,
        path,
        {
          error: errorMsg,
          isLoading: false,
        },
        isAppendMode
      )

      if (options.stopOnError) {
        tab.value.document.status = "stopped"
        throw new Error("Test execution stopped due to error")
      }
    }
  }

  private getTestResultInfo(testResult: HoppTestData) {
    let passed = 0
    let failed = 0

    for (const result of testResult.expectResults) {
      if (result.status === "pass") {
        passed++
      } else if (result.status === "fail") {
        failed++
      }
    }

    for (const nestedTest of testResult.tests) {
      const nestedResult = this.getTestResultInfo(nestedTest)
      passed += nestedResult.passed
      failed += nestedResult.failed
    }

    return { passed, failed }
  }

  /**
   * Resolves a string path (e.g. "folder_0/folder_1/request_2") to the actual
   * request plus its inherited auth, headers, and parent path array.
   */
  private resolveRequestContext(
    collection: HoppCollection,
    pathStr: string
  ): {
    request: TestRunnerRequest
    parentPath: number[]
    requestIndex: number
    inheritedAuth: HoppRESTRequest["auth"]
    inheritedHeaders: HoppRESTHeaders
    inheritedPreRequestScripts: string[]
    inheritedTestScripts: string[]
  } | null {
    const parts = pathStr.split("/")
    let current: HoppCollection = collection
    const parentPath: number[] = []

    // Start with root-level auth/headers/scripts
    let inheritedAuth: HoppRESTRequest["auth"] =
      collection.auth?.authType === "inherit"
        ? { authType: "none", authActive: false }
        : collection.auth || { authType: "none", authActive: false }

    let inheritedHeaders: HoppRESTHeaders = [...(collection.headers || [])]

    // Collect root-level collection scripts
    const inheritedPreRequestScripts: string[] = hasActualScript(
      collection.preRequestScript
    )
      ? [collection.preRequestScript]
      : []

    const inheritedTestScripts: string[] = hasActualScript(
      collection.testScript
    )
      ? [collection.testScript]
      : []

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isLast = i === parts.length - 1

      if (part.startsWith("folder_")) {
        const folderIdx = parseInt(part.replace("folder_", ""), 10)
        if (isLast) return null // path ends in folder, not a request

        const folder = current.folders[folderIdx]
        if (!folder) return null

        // Accumulate auth/headers from this folder
        inheritedAuth =
          folder.auth?.authType === "inherit" && folder.auth?.authActive
            ? inheritedAuth
            : folder.auth || { authType: "none", authActive: false }

        inheritedHeaders = [...inheritedHeaders, ...(folder.headers || [])]

        // Accumulate scripts from this folder (root → request order)
        if (hasActualScript((folder as HoppCollection).preRequestScript)) {
          inheritedPreRequestScripts.push(
            (folder as HoppCollection).preRequestScript
          )
        }
        if (hasActualScript((folder as HoppCollection).testScript)) {
          inheritedTestScripts.push((folder as HoppCollection).testScript)
        }

        parentPath.push(folderIdx)
        current = folder as HoppCollection
      } else if (part.startsWith("request_")) {
        const reqIdx = parseInt(part.replace("request_", ""), 10)
        const request = current.requests[reqIdx]
        if (!request) return null

        return {
          request: request as TestRunnerRequest,
          parentPath,
          requestIndex: reqIdx,
          inheritedAuth,
          inheritedHeaders,
          inheritedPreRequestScripts,
          inheritedTestScripts,
        }
      } else {
        return null // unknown segment
      }
    }

    return null
  }

  /**
   * Pre-populates all folder nodes in the result collection from the source
   * collection. This is required before custom-order execution so that
   * appendRequestToPath / updateRequestAtPath can navigate into sub-folders.
   */
  private buildFolderSkeleton(
    resultCollection: HoppCollection,
    sourceCollection: HoppCollection,
    path: number[] = []
  ): void {
    sourceCollection.folders.forEach((folder, i) => {
      const folderPath = [...path, i]
      this.addFolderToPath(resultCollection, folderPath, {
        ...cloneDeep(folder),
        folders: [],
        requests: [],
      })
      this.buildFolderSkeleton(
        resultCollection,
        folder as HoppCollection,
        folderPath
      )
    })
  }

  /**
   * Executes requests in the user-defined flat order stored in options.requestOrder.
   * Auth/header inheritance is resolved for each request individually.
   */
  private async runTestsInCustomOrder(
    tab: Ref<HoppTab<HoppTestRunnerDocument>>,
    collection: HoppCollection,
    options: TestRunnerOptions,
    shouldResetFoldersAndRequests: boolean,
    iterationData?: any
  ) {
    // On the first iteration, pre-populate the folder tree in the result collection
    // so that appendRequestToPath can navigate into sub-folders safely.
    if (shouldResetFoldersAndRequests) {
      this.buildFolderSkeleton(tab.value.document.resultCollection!, collection)
    }

    // Sequential per-folder insertion counter so that the result collection always
    // stores requests in the dragged custom order — not by their original array index.
    // Without this, shouldReplaceAtIndex=true (first iteration) would write each
    // request at its ORIGINAL index, recreating the default order on run 1.
    const folderRequestCounters = new Map<string, number>()

    for (const requestPath of options.requestOrder!) {
      if (options.stopRef?.value) {
        tab.value.document.status = "stopped"
        throw new Error("Test execution stopped")
      }

      // Honour selection: skip deselected requests
      const shouldExecute = this.shouldExecuteRequest(
        requestPath,
        options.requestSelection
      )
      if (!shouldExecute) continue

      // Resolve the request and its inherited context from the collection tree
      const ctx = this.resolveRequestContext(collection, requestPath)
      if (!ctx) continue

      const { request, parentPath, inheritedAuth, inheritedHeaders, inheritedPreRequestScripts, inheritedTestScripts } = ctx

      // Use a sequential per-folder counter as the insertion index.
      // This keeps the result collection in custom order regardless of the
      // request's original position in the source collection.
      const folderKey = parentPath.join("/")
      const seqIndex = folderRequestCounters.get(folderKey) ?? 0
      folderRequestCounters.set(folderKey, seqIndex + 1)

      const fullPath = [...parentPath, seqIndex]

      // Add request slot to the result collection
      this.appendRequestToPath(
        tab.value.document.resultCollection!,
        fullPath,
        cloneDeep(request),
        shouldResetFoldersAndRequests
      )

      // Apply inherited auth and headers
      const finalRequest: TestRunnerRequest = {
        ...request,
        auth:
          request.auth.authType === "inherit" && request.auth.authActive
            ? inheritedAuth
            : request.auth,
        headers: [...inheritedHeaders, ...request.headers],
      }

      await this.runTestRequest(
        tab,
        finalRequest,
        collection,
        options,
        fullPath,
        [], // inherited variables — simplified for custom order
        shouldResetFoldersAndRequests,
        iterationData,
        inheritedPreRequestScripts, // resolved from collection tree path
        inheritedTestScripts        // resolved from collection tree path
      )

      if (options.delay && options.delay > 0) {
        try {
          await delay(options.delay)
        } catch (_error) {
          if (options.stopRef?.value) {
            tab.value.document.status = "stopped"
            throw new Error("Test execution stopped")
          }
        }
      }
    }
  }

  /**
   * Builds a request path string from a path array
   * Example: [0, 1, 2] -> "folder_0/folder_1/request_2"
   */
  private buildRequestPath(parentPath: number[], requestIndex: number): string {
    const folderPath = parentPath.map((idx) => `folder_${idx}`).join("/")
    const requestPath = `request_${requestIndex}`
    return folderPath ? `${folderPath}/${requestPath}` : requestPath
  }

  /**
   * Checks if a request should be executed based on selection state
   * If no selection state is provided, all requests are executed
   */
  private shouldExecuteRequest(
    requestPath: string,
    selectionState?: Record<string, boolean>
  ): boolean {
    if (!selectionState || Object.keys(selectionState).length === 0) {
      return true // Execute all if no selection state
    }
    return selectionState[requestPath] ?? false
  }
}
