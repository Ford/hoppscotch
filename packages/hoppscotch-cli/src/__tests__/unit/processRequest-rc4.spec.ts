/**
 * RC-4 fix: processRequest must NOT run the test script when the request
 * fails at the socket/network level (no HTTP response was received).
 *
 * Before the fix: test script always ran, even against an empty stub body,
 * producing a misleading "TEST_SCRIPT_ERROR: TypeError: not a function"
 * that obscured the real root cause.
 *
 * After the fix: test script is skipped on network-level failure, so only
 * REQUEST_ERROR appears in the report.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AxiosResponse } from "axios";

// ─── All vi.mock() calls BEFORE imports ──────────────────────────────────────

vi.mock("axios", () => {
  const mockFn = vi.fn();
  mockFn.isAxiosError = vi.fn(() => false);
  // axios.create() is called by hopp-fetch (cookiejar support)
  mockFn.create = vi.fn(() => mockFn);
  return { default: mockFn };
});

// axios-cookiejar-support wraps an axios instance — return it unchanged
vi.mock("axios-cookiejar-support", () => ({
  wrapper: (instance: any) => instance,
}));

vi.mock("tough-cookie", () => ({
  CookieJar: vi.fn(),
}));

vi.mock("../../utils/http-agent", () => ({
  createAxiosAgents: vi.fn(() => ({
    httpAgent: { type: "http" },
    httpsAgent: { type: "https" },
  })),
  getNetworkErrorHint: vi.fn(() => ""),
}));

// ─── Imports AFTER vi.mock() ─────────────────────────────────────────────────
import { getDefaultRESTRequest } from "@hoppscotch/data";
import { processRequest } from "../../utils/request";
import { createAxiosAgents } from "../../utils/http-agent";
import axios from "axios";
import type { HoppEnvs } from "../../types/request";

const mockAxiosFn = axios as unknown as ReturnType<typeof vi.fn> & {
  isAxiosError: ReturnType<typeof vi.fn>;
};

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const DEFAULT_REQUEST = {
  ...getDefaultRESTRequest(),
  name: "Health Check",
  method: "POST",
  endpoint:
    "https://ford3.na1.ondemand.vertexinc.com/vertex-ws/services/CalculateTax90",
  preRequestScript: "",
  testScript: "",
};

const DEFAULT_ENVS: HoppEnvs = { global: [], selected: [] };

const makeAxiosResponse = (overrides: Partial<AxiosResponse> = {}): AxiosResponse => ({
  data: { status: "ok" },
  status: 200,
  statusText: "OK",
  headers: {},
  config: {} as any,
  ...overrides,
});

const makeSocketError = () => ({
  name: "AxiosError",
  message: "socket hang up",
  isAxiosError: true,
  config: {},
  toJSON: () => ({}),
  request: {},    // request sent, no response received = socket-level failure
  code: "ECONNRESET",
});

// ─────────────────────────────────────────────────────────────────────────────
describe("processRequest — RC-4: test runner skipped on socket-level failure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAxiosFn.isAxiosError.mockReturnValue(false);
    mockAxiosFn.create.mockReturnValue(mockAxiosFn);
  });

  // ── Baseline: happy path ──────────────────────────────────────────────────

  it("runs the test script and reports a pass when request succeeds (HTTP 200)", async () => {
    mockAxiosFn.mockResolvedValueOnce(makeAxiosResponse());

    const result = await processRequest({
      request: {
        ...DEFAULT_REQUEST,
        testScript: `
          pw.test("status is 200", () => {
            pw.expect(pw.response.status).toBe(200);
          });
        `,
      },
      envs: DEFAULT_ENVS,
      path: "collection/Health Check",
      delay: 0,
    })();

    expect(result.report.result).toBe(true);
    expect(result.report.tests.length).toBeGreaterThan(0);
    expect(result.report.errors).toHaveLength(0);
  });

  it("still runs the test script for HTTP 4xx (server sent a response)", async () => {
    mockAxiosFn.isAxiosError.mockReturnValue(true);
    mockAxiosFn.mockRejectedValueOnce({
      name: "AxiosError",
      message: "404",
      isAxiosError: true,
      config: {},
      toJSON: () => ({}),
      response: {
        data: {},
        status: 404,
        statusText: "NOT FOUND",
        headers: {},
        config: {},
      },
    });

    const result = await processRequest({
      request: {
        ...DEFAULT_REQUEST,
        testScript: `
          pw.test("got 404", () => {
            pw.expect(pw.response.status).toBe(404);
          });
        `,
      },
      envs: DEFAULT_ENVS,
      path: "collection/Health Check",
      delay: 0,
    })();

    // Test script DID run
    expect(result.report.tests.length).toBeGreaterThan(0);
    // No TEST_SCRIPT_ERROR
    expect(result.report.errors.filter((e) => e.code === "TEST_SCRIPT_ERROR")).toHaveLength(0);
  });

  // ── RC-4 fix: socket-level failure ───────────────────────────────────────

  it("does NOT run the test script when request fails at socket level (ECONNRESET)", async () => {
    mockAxiosFn.isAxiosError.mockReturnValue(true);
    mockAxiosFn.mockRejectedValueOnce(makeSocketError());

    // A test script that would throw TypeError if run against empty body
    const result = await processRequest({
      request: {
        ...DEFAULT_REQUEST,
        testScript: `
          pw.test("check body", () => {
            pw.expect(pw.response.body.someMethod()).toBe("value");
          });
        `,
      },
      envs: DEFAULT_ENVS,
      path: "collection/Health Check",
      delay: 0,
    })();

    const requestErrors = result.report.errors.filter((e) => e.code === "REQUEST_ERROR");
    const scriptErrors  = result.report.errors.filter((e) => e.code === "TEST_SCRIPT_ERROR");

    expect(requestErrors).toHaveLength(1);
    expect(scriptErrors).toHaveLength(0);   // ← RC-4 fix: no cascade
    expect(result.report.result).toBe(false);
  });

  it("produces EXACTLY one error (REQUEST_ERROR) on socket hang up — no cascade", async () => {
    mockAxiosFn.isAxiosError.mockReturnValue(true);
    mockAxiosFn.mockRejectedValueOnce(makeSocketError());

    const result = await processRequest({
      request: DEFAULT_REQUEST,
      envs: DEFAULT_ENVS,
      path: "collection/Health Check",
      delay: 0,
    })();

    expect(result.report.errors).toHaveLength(1);
    expect(result.report.errors[0].code).toBe("REQUEST_ERROR");
  });

  it("leaves the test report empty (no phantom test cases) after a socket error", async () => {
    mockAxiosFn.isAxiosError.mockReturnValue(true);
    mockAxiosFn.mockRejectedValueOnce(makeSocketError());

    const result = await processRequest({
      request: {
        ...DEFAULT_REQUEST,
        testScript: "pw.test('x', () => pw.expect(1).toBe(1));",
      },
      envs: DEFAULT_ENVS,
      path: "collection/Health Check",
      delay: 0,
    })();

    // No phantom "0 failed 0 passed" test suites
    expect(result.report.tests).toHaveLength(0);
  });

  // ── --proxy option threads through ───────────────────────────────────────

  it("passes the --proxy option through to createAxiosAgents", async () => {
    mockAxiosFn.mockResolvedValueOnce(makeAxiosResponse());

    await processRequest({
      request: DEFAULT_REQUEST,
      envs: DEFAULT_ENVS,
      path: "collection/Health Check",
      delay: 0,
      proxy: "http://internet.ford.com:83",
    })();

    expect(createAxiosAgents).toHaveBeenCalledWith(
      expect.any(String),
      undefined,
      undefined,
      "http://internet.ford.com:83"
    );
  });
});

