import {
  Environment,
  HoppCollection,
  HoppRESTRequest,
  RESTReqSchemaVersion,
} from "@hoppscotch/data";
import axios, { Method } from "axios";
import * as A from "fp-ts/Array";
import * as E from "fp-ts/Either";
import * as T from "fp-ts/Task";
import * as TE from "fp-ts/TaskEither";
import { pipe } from "fp-ts/function";
import * as S from "fp-ts/string";
import { hrtime } from "process";
import { URL } from "url";
import { EffectiveHoppRESTRequest, RequestConfig } from "../interfaces/request";
import { RequestRunnerResponse } from "../interfaces/response";
import { HoppCLIError, error } from "../types/errors";
import {
  HoppEnvs,
  ProcessRequestParams,
  RequestReport,
} from "../types/request";
import { RequestMetrics } from "../types/response";
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_REQUEST_RETRIES,
  RETRYABLE_ERROR_CODES,
} from "./constants";
import {
  printPreRequestRunner,
  printRequestRunner,
  printTestRunner,
} from "./display";
import { getDurationInSeconds, getMetaDataPairs } from "./getters";
import { createAxiosAgents, getNetworkErrorHint } from "./http-agent";
import { preRequestScriptRunner } from "./pre-request";
import { getTestScriptParams, hasAllTestsPassed, testRunner } from "./test";

/**
 * Processes given variable, which includes checking for secret variables
 * and getting value from system environment
 * @param variable Variable to be processed
 * @returns Updated variable with value from system environment
 */
const processVariables = (variable: Environment["variables"][number]) => {
  if (variable.secret) {
    return {
      ...variable,
      currentValue:
        "currentValue" in variable && variable.currentValue !== ""
          ? variable.currentValue
          : process.env[variable.key] || variable.initialValue,
    };
  }
  return variable;
};

/**
 * Processes given envs, which includes processing each variable in global
 * and selected envs
 * @param envs Global + selected envs used by requests with in collection
 * @returns Processed envs with each variable processed
 */
const processEnvs = (envs: Partial<HoppEnvs>) => {
  // This can take the shape `{ global: undefined, selected: undefined }` when no environment is supplied
  const processedEnvs = {
    global: envs.global?.map(processVariables) ?? [],
    selected: envs.selected?.map(processVariables) ?? [],
  };

  return processedEnvs;
};

/**
 * Transforms given request data to request-config used by request-runner to
 * perform HTTP request.
 * @param req Effective request data with parsed ENVs.
 * @returns Request config with data related to HTTP request.
 */
export const createRequest = (req: EffectiveHoppRESTRequest): RequestConfig => {
  const config: RequestConfig = {
    displayUrl: req.effectiveFinalDisplayURL,
  };

  const { finalBody, finalEndpoint, finalHeaders, finalParams } = getRequest;

  const reqParams = finalParams(req);
  const reqHeaders = finalHeaders(req);

  config.url = finalEndpoint(req);
  config.method = req.method as Method;
  config.params = getMetaDataPairs(reqParams);
  config.headers = getMetaDataPairs(reqHeaders);

  config.data = finalBody(req);

  return config;
};

/**
 * Options that control transport behaviour for a single request execution.
 */
export interface RequestRunnerOptions {
  /** Timeout in ms. 0 = no timeout. Default: DEFAULT_REQUEST_TIMEOUT_MS */
  timeout?: number;
  /** Number of retries on transient socket errors. Default: 0 */
  retries?: number;
  /** Disable TLS certificate validation (equivalent to NODE_TLS_REJECT_UNAUTHORIZED=0) */
  insecure?: boolean;
  /** Path to a custom CA certificate bundle (PEM file) */
  caCert?: string;
  /**
   * Force a specific proxy URL for all requests, ignoring NO_PROXY.
   * Equivalent to curl --proxy.  Use this when the target host is listed
   * in NO_PROXY but is only reachable through the proxy.
   */
  proxy?: string;
}

/**
 * Performs a single axios request attempt, returning either a RunnerResponse
 * (Right) or a structured error (Left).  Network-level socket errors are
 * distinguished from HTTP-level error responses so callers can decide whether
 * to retry or skip dependent scripts.
 */
const attemptRequest = async (
  requestConfig: RequestConfig,
  opts: RequestRunnerOptions,
  start: ReturnType<typeof hrtime>
): Promise<E.Either<{ err: HoppCLIError; isSocketError: boolean }, RequestRunnerResponse>> => {
  try {
    // NOTE: Temporary parsing check for request endpoint.
    requestConfig.url = new URL(requestConfig.url ?? "").toString();

    // Wire up proxy agent and TLS options
    const { httpAgent, httpsAgent } = createAxiosAgents(
      requestConfig.url,
      opts.insecure,
      opts.caCert,
      opts.proxy
    );

    const effectiveTimeout =
      opts.timeout !== undefined ? opts.timeout : DEFAULT_REQUEST_TIMEOUT_MS;

    const axiosConfig = {
      ...requestConfig,
      httpAgent,
      httpsAgent,
      // Disable axios's own proxy handling – our agent already handles it
      proxy: false as const,
      ...(effectiveTimeout > 0 ? { timeout: effectiveTimeout } : {}),
    };

    const baseResponse = await axios(axiosConfig);
    const { config } = baseResponse;

    const end = hrtime(start);
    const duration = getDurationInSeconds(end);
    const responseTime = duration * 1000;

    const transformedHeaders: { key: string; value: string }[] = [];
    if (baseResponse.headers) {
      for (const [key, value] of Object.entries(baseResponse.headers)) {
        if (value !== undefined) {
          transformedHeaders.push({
            key,
            value: Array.isArray(value) ? value.join(", ") : String(value),
          });
        }
      }
    }

    const runnerResponse: RequestRunnerResponse = {
      endpoint: getRequest.endpoint(config.url),
      method: getRequest.method(config.method),
      body: baseResponse.data,
      responseTime,
      duration,
      status: baseResponse.status,
      statusText: baseResponse.statusText,
      headers: transformedHeaders,
    };

    return E.right(runnerResponse);
  } catch (e) {
    if (axios.isAxiosError(e)) {
      // HTTP-level error (server sent a response with an error status)
      if (e.response) {
        const { data, status, statusText, headers } = e.response;
        const transformedHeaders: { key: string; value: string }[] = [];
        if (headers) {
          for (const [key, value] of Object.entries(headers)) {
            if (value !== undefined) {
              transformedHeaders.push({
                key,
                value: Array.isArray(value) ? value.join(", ") : String(value),
              });
            }
          }
        }
        const end = hrtime(start);
        const duration = getDurationInSeconds(end);
        return E.right(<RequestRunnerResponse>{
          endpoint: e.config?.url ?? "",
          method: getRequest.method(e.config?.method),
          body: data,
          statusText,
          status,
          headers: transformedHeaders,
          duration,
          responseTime: duration * 1000,
        });
      }

      // Network / socket-level error — no HTTP response received
      if (e.request) {
        const code = (e.cause as NodeJS.ErrnoException | undefined)?.code ?? e.code;
        const hint = getNetworkErrorHint(code);
        const baseMsg = e.message ?? "socket hang up";
        const fullMsg = hint ? `${baseMsg} — ${hint}` : baseMsg;
        const enrichedError = new Error(fullMsg);
        return E.left({
          err: error({ code: "REQUEST_ERROR", data: enrichedError }),
          isSocketError: true,
        });
      }
    }

    // Unknown error
    return E.left({
      err: error({ code: "REQUEST_ERROR", data: E.toError(e) }),
      isSocketError: false,
    });
  }
};

/**
 * Performs http request using axios with given requestConfig axios parameters.
 * Supports proxy agents (HTTP_PROXY/HTTPS_PROXY), TLS options and retry logic.
 *
 * @param requestConfig The axios request config.
 * @param opts          Transport behaviour options (timeout, retries, insecure, caCert).
 * @returns If successfully ran, we get runner-response including HTTP response data.
 * Else, HoppCLIError with appropriate error code & data.
 */
export const requestRunner =
  (
    requestConfig: RequestConfig,
    opts: RequestRunnerOptions = {}
  ): TE.TaskEither<HoppCLIError, RequestRunnerResponse> =>
  async () => {
    const maxRetries = opts.retries ?? DEFAULT_REQUEST_RETRIES;
    const start = hrtime();
    let lastLeft: { err: HoppCLIError; isSocketError: boolean } | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        // Brief back-off before retry
        await new Promise<void>((res) => setTimeout(res, 500));
      }

      const result = await attemptRequest(requestConfig, opts, start);

      if (E.isRight(result)) {
        return result;
      }

      lastLeft = result.left;

      // Only retry on socket-level / transient errors
      const errData = (result.left.err as { code: string; data?: unknown }).data as NodeJS.ErrnoException | Error | undefined;
      const errCode = (errData as NodeJS.ErrnoException | undefined)?.code;
      const isRetryable =
        result.left.isSocketError && errCode !== undefined && RETRYABLE_ERROR_CODES.has(errCode);

      if (!isRetryable) break;
    }

    return E.left(lastLeft!.err);
  };

/**
 * Getter object methods for request-runner.
 */
const getRequest = {
  method: (value: string | undefined) =>
    value ? (value.toUpperCase() as Method) : "GET",

  endpoint: (value: string | undefined): string => (value ? value : ""),

  finalEndpoint: (req: EffectiveHoppRESTRequest): string =>
    S.isEmpty(req.effectiveFinalURL) ? req.endpoint : req.effectiveFinalURL,

  finalHeaders: (req: EffectiveHoppRESTRequest) =>
    A.isNonEmpty(req.effectiveFinalHeaders)
      ? req.effectiveFinalHeaders
      : req.headers,

  finalParams: (req: EffectiveHoppRESTRequest) =>
    A.isNonEmpty(req.effectiveFinalParams)
      ? req.effectiveFinalParams
      : req.params,

  finalBody: (req: EffectiveHoppRESTRequest) =>
    req.effectiveFinalBody ? req.effectiveFinalBody : req.body.body,
};

/**
 * Processes given request, which includes executing pre-request-script,
 * running request & executing test-script.
 * @param request Request to be processed.
 * @param envs Global + selected envs used by requests with in collection.
 * @returns Updated envs and current request's report.
 */
export const processRequest =
  (
    params: ProcessRequestParams
  ): T.Task<{ envs: HoppEnvs; report: RequestReport }> =>
  async () => {
    const {
      envs,
      path,
      request,
      delay,
      legacySandbox,
      collectionVariables,
      inheritedPreRequestScripts = [],
      inheritedTestScripts = [],
      timeout,
      retries,
      insecure,
      caCert,
      proxy,
    } = params;

    // Initialising updatedEnvs with given parameter envs, will eventually get updated.
    const result = {
      envs: <HoppEnvs>envs,
      report: <RequestReport>{},
    };

    // Initial value for current request's report with default values for properties.
    const report: RequestReport = {
      path: path,
      tests: [],
      errors: [],
      result: true,
      duration: { test: 0, request: 0, preRequest: 0 },
    };

    // Initial value for effective-request with default values for properties.
    let effectiveRequest = <EffectiveHoppRESTRequest>{
      ...request,
      effectiveFinalBody: null,
      effectiveFinalHeaders: [],
      effectiveFinalParams: [],
      effectiveFinalURL: "",
    };

    // Fetch values for secret environment variables from system environment
    const processedEnvs = processEnvs(envs);

    // Default envs to the pre-script state so downstream consumers
    // (test-runner, effectiveRequest builder) receive a well-shaped
    // HoppEnvs even if the pre-request script fails.
    let updatedEnvs: HoppEnvs = processedEnvs;

    const preRequestRes = await preRequestScriptRunner(
      request,
      processedEnvs,
      legacySandbox ?? false,
      collectionVariables,
      inheritedPreRequestScripts
    )();
    if (E.isLeft(preRequestRes)) {
      printPreRequestRunner.fail();

      // Updating report for errors & current result
      report.errors.push(preRequestRes.left);

      // Ensure, the CLI fails with a non-zero exit code if there are any errors
      report.result = false;
    } else {
      // Updating effective-request and consuming updated envs after pre-request script execution
      ({ effectiveRequest, updatedEnvs } = preRequestRes.right);
    }

    // Creating request-config for request-runner.
    const requestConfig = createRequest(effectiveRequest);

    printRequestRunner.start(requestConfig);

    // Default value for request-runner's response.
    let _requestRunnerRes: RequestRunnerResponse = {
      endpoint: "",
      method: "GET",
      headers: [],
      status: 400,
      statusText: "",
      responseTime: 0,
      body: Object(null),
      duration: 0,
    };

    // RC-1/RC-2/RC-3/RC-5: pass transport options (proxy, timeout, retries, TLS)
    const runnerOpts: RequestRunnerOptions = { timeout, retries, insecure, caCert, proxy };

    // Executing request-runner.
    const requestRunnerRes = await delayPromiseFunction<
      E.Either<HoppCLIError, RequestRunnerResponse>
    >(requestRunner(requestConfig, runnerOpts), delay);

    // RC-4: track whether this was a network/socket-level failure so we can
    // skip running the test script against an empty stub response.
    let isNetworkLevelFailure = false;

    if (E.isLeft(requestRunnerRes)) {
      // Updating report for errors & current result
      report.errors.push(requestRunnerRes.left);

      // Ensure, the CLI fails with a non-zero exit code if there are any errors
      report.result = false;

      printRequestRunner.fail();

      // Determine if this is a socket/network failure (no HTTP response was received)
      isNetworkLevelFailure = true;
    } else {
      _requestRunnerRes = requestRunnerRes.right;
      report.duration.request = _requestRunnerRes.duration;
      printRequestRunner.success(_requestRunnerRes);
    }

    // RC-4: Skip the test runner when the request never got a response.
    // Running scripts against an empty stub body always produces misleading
    // "TypeError: not a function" cascades that obscure the real REQUEST_ERROR.
    // The test script will still run for HTTP-level errors (4xx / 5xx) because
    // those do have a real response body for assertions.
    if (isNetworkLevelFailure) {
      result.report = report;
      return result;
    }

    const testScriptParams = getTestScriptParams(
      _requestRunnerRes,
      effectiveRequest,
      updatedEnvs,
      legacySandbox ?? false,
      inheritedTestScripts
    );

    // Executing test-runner.
    const testRunnerRes = await testRunner(testScriptParams)();
    if (E.isLeft(testRunnerRes)) {
      printTestRunner.fail();

      // Updating report with current errors & result.
      report.errors.push(testRunnerRes.left);

      // Ensure, the CLI fails with a non-zero exit code if there are any errors
      report.result = false;
    } else {
      const { envs, testsReport, duration } = testRunnerRes.right;
      const _allTestsPassed = hasAllTestsPassed(testsReport);

      // Check if any tests have uncaught runtime errors (e.g., ReferenceError, TypeError)
      // Don't include validation errors (they're reported as individual testcases)
      const testScriptErrors = testsReport.flatMap((testReport) =>
        testReport.expectResults
          .filter(
            (result) =>
              result.status === "error" &&
              /^(ReferenceError|TypeError|SyntaxError|RangeError|URIError|EvalError|AggregateError|InternalError|Error):/.test(
                result.message
              )
          )
          .map((result) => result.message)
      );

      // If there are runtime errors, add them to report.errors
      if (testScriptErrors.length > 0) {
        const errorMessages = testScriptErrors.join("; ");

        report.errors.push(
          error({
            code: "TEST_SCRIPT_ERROR",
            data: errorMessages,
          })
        );

        report.result = false;
      }

      // Updating report with current tests, result and duration.
      report.tests = testsReport;
      report.result = report.result && _allTestsPassed;
      report.duration.test = duration;

      // Updating resulting envs from test-runner.
      result.envs = envs;

      // Printing tests-report, when test-runner executes successfully.
      printTestRunner.success(testsReport, duration);
    }

    result.report = report;

    return result;
  };

/**
 * Generates new request without any missing/invalid data using
 * current request object.
 * @param request Hopp rest request to be processed.
 * @returns Updated request object free of invalid/missing data.
 */
export const preProcessRequest = (
  request: HoppRESTRequest,
  collection: HoppCollection
): HoppRESTRequest => {
  const tempRequest = Object.assign({}, request);
  const { headers: parentHeaders, auth: parentAuth } = collection;

  if (!tempRequest.v) {
    tempRequest.v = RESTReqSchemaVersion;
  }
  if (!tempRequest.name) {
    tempRequest.name = "Untitled Request";
  }
  if (!tempRequest.method) {
    tempRequest.method = "GET";
  }
  if (!tempRequest.endpoint) {
    tempRequest.endpoint = "";
  }
  if (!tempRequest.params) {
    tempRequest.params = [];
  }

  if (parentHeaders?.length) {
    // Filter out header entries present in the parent (folder/collection) under the same name
    // This ensures the child headers take precedence over the parent headers
    const filteredEntries = parentHeaders.filter((parentHeaderEntries) => {
      return !tempRequest.headers.some(
        (reqHeaderEntries) => reqHeaderEntries.key === parentHeaderEntries.key
      );
    });
    tempRequest.headers.push(...filteredEntries);
  } else if (!tempRequest.headers) {
    tempRequest.headers = [];
  }

  if (!tempRequest.preRequestScript) {
    tempRequest.preRequestScript = "";
  }
  if (!tempRequest.testScript) {
    tempRequest.testScript = "";
  }

  if (tempRequest.auth?.authType === "inherit") {
    tempRequest.auth = parentAuth;
  } else if (!tempRequest.auth) {
    tempRequest.auth = { authActive: false, authType: "none" };
  }

  if (!tempRequest.body) {
    tempRequest.body = { contentType: null, body: null };
  }
  return tempRequest;
};

/**
 * Get request-metrics object (stats+duration) based on existence of REQUEST_ERROR code
 * in hopp-errors list.
 * @param errors List of errors to check for REQUEST_ERROR.
 * @param duration Time taken (in seconds) to execute the request.
 * @returns Object containing details of request's execution stats i.e., failed/passed
 * data and duration.
 */
export const getRequestMetrics = (
  errors: HoppCLIError[],
  duration: number
): RequestMetrics =>
  pipe(
    errors,
    A.some(({ code }) => code === "REQUEST_ERROR"),
    (hasReqErrors) =>
      hasReqErrors ? { failed: 1, passed: 0 } : { failed: 0, passed: 1 },
    (requests) => <RequestMetrics>{ requests, duration }
  );

/**
 * A function to execute promises with specific delay in milliseconds.
 * @param func Function with promise with return type T.
 * @param delay TIme in milliseconds to delay function.
 * @returns Promise of type same as func.
 */
export const delayPromiseFunction = <T>(
  func: () => Promise<T>,
  delay: number
): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(func()), delay));
