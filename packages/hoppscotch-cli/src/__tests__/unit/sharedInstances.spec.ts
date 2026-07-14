/**
 * Jira Story 1 — Shared ProxyAgent/axios instance and HoppFetchHook per run.
 *
 * Acceptance criteria verified here:
 *  1. requestRunner creates agents ONCE before the retry loop (not once per attempt).
 *  2. requestRunner uses sharedAgents when provided, skipping createAxiosAgents entirely.
 *  3. preRequestScriptRunner uses the provided sharedHoppFetchHook instead of calling
 *     createHoppFetchHook() on every request.
 *  4. processRequest threads sharedAgents and sharedHoppFetchHook from ProcessRequestParams
 *     down into requestRunner and preRequestScriptRunner.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AxiosResponse } from "axios";

// ─── vi.mock() calls MUST come before imports ────────────────────────────────

vi.mock("axios", () => {
  const mockFn = vi.fn();
  mockFn.isAxiosError = vi.fn(() => false);
  mockFn.create = vi.fn(() => mockFn);
  return { default: mockFn };
});

vi.mock("axios-cookiejar-support", () => ({
  wrapper: (instance: any) => instance,
}));

vi.mock("tough-cookie", () => ({
  CookieJar: vi.fn(),
}));

vi.mock("../../utils/http-agent", () => ({
  createAxiosAgents: vi.fn(() => ({
    httpAgent: { type: "http-default" },
    httpsAgent: { type: "https-default" },
  })),
  getNetworkErrorHint: vi.fn(() => ""),
}));

vi.mock("../../utils/hopp-fetch", () => ({
  createHoppFetchHook: vi.fn(() => vi.fn()),
}))

// ─── Imports AFTER vi.mock() ─────────────────────────────────────────────────

import { requestRunner } from "../../utils/request";
import { preRequestScriptRunner } from "../../utils/pre-request";
import { processRequest } from "../../utils/request";
import { createAxiosAgents } from "../../utils/http-agent";
import { createHoppFetchHook } from "../../utils/hopp-fetch";
import { getDefaultRESTRequest } from "@hoppscotch/data";
import axios from "axios";
import type { RequestConfig } from "../../interfaces/request";
import type { HoppEnvs } from "../../types/request";

const mockAxiosFn = axios as unknown as ReturnType<typeof vi.fn> & {
  isAxiosError: ReturnType<typeof vi.fn>;
};

const mockCreateAxiosAgents = createAxiosAgents as ReturnType<typeof vi.fn>;
const mockCreateHoppFetchHook = createHoppFetchHook as ReturnType<typeof vi.fn>;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SAMPLE_CONFIG: RequestConfig = {
  url: "https://api.example.com/resource",
  method: "GET",
};

const makeAxiosResponse = (overrides: Partial<AxiosResponse> = {}): AxiosResponse => ({
  data: { ok: true },
  status: 200,
  statusText: "OK",
  headers: {},
  config: SAMPLE_CONFIG as any,
  ...overrides,
});

const makeSocketError = (code = "ECONNRESET") => ({
  name: "AxiosError",
  message: "socket hang up",
  isAxiosError: true,
  config: SAMPLE_CONFIG,
  toJSON: () => ({}),
  request: {},
  code,
});

const DEFAULT_ENVS: HoppEnvs = { global: [], selected: [] };

const DEFAULT_REQUEST = {
  ...getDefaultRESTRequest(),
  name: "Test Request",
  method: "GET",
  endpoint: "https://api.example.com/resource",
  preRequestScript: "",
  testScript: "",
};

// ─────────────────────────────────────────────────────────────────────────────

describe("Story 1 — Shared instances: requestRunner agent creation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAxiosFn.isAxiosError.mockReturnValue(false);
    mockAxiosFn.create.mockReturnValue(mockAxiosFn);
    mockCreateAxiosAgents.mockReturnValue({
      httpAgent: { type: "http-default" },
      httpsAgent: { type: "https-default" },
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // ── sharedAgents bypass ──────────────────────────────────────────────────

  it("skips createAxiosAgents entirely when sharedAgents is provided", async () => {
    mockAxiosFn.mockResolvedValueOnce(makeAxiosResponse());

    const sharedAgents = {
      httpAgent: { type: "shared-http" } as any,
      httpsAgent: { type: "shared-https" } as any,
    };

    await requestRunner(SAMPLE_CONFIG, { sharedAgents })();

    // createAxiosAgents must NOT be called — we're reusing the shared pool
    expect(mockCreateAxiosAgents).not.toHaveBeenCalled();
  });

  it("passes sharedAgents' httpAgent and httpsAgent into axios config", async () => {
    mockAxiosFn.mockResolvedValueOnce(makeAxiosResponse());

    const sharedAgents = {
      httpAgent: { type: "shared-http" } as any,
      httpsAgent: { type: "shared-https" } as any,
    };

    await requestRunner(SAMPLE_CONFIG, { sharedAgents })();

    expect(mockAxiosFn).toHaveBeenCalledWith(
      expect.objectContaining({
        httpAgent: { type: "shared-http" },
        httpsAgent: { type: "shared-https" },
      })
    );
  });

  // ── Agents created once per request, not per retry ───────────────────────

  it("calls createAxiosAgents ONCE even when the first attempt is retried", async () => {
    mockAxiosFn.isAxiosError.mockReturnValue(true);
    // First attempt fails with a retryable error, second succeeds
    mockAxiosFn
      .mockRejectedValueOnce(makeSocketError("ECONNRESET"))
      .mockResolvedValueOnce(makeAxiosResponse());

    await requestRunner(SAMPLE_CONFIG, { retries: 1, retryDelay: 0 })();

    // axios was called twice (original + 1 retry) but agent creation happened only once
    expect(mockAxiosFn).toHaveBeenCalledTimes(2);
    expect(mockCreateAxiosAgents).toHaveBeenCalledTimes(1);
  });

  it("calls createAxiosAgents ONCE even with retries=2 and two failures", async () => {
    mockAxiosFn.isAxiosError.mockReturnValue(true);
    mockAxiosFn
      .mockRejectedValueOnce(makeSocketError("ECONNRESET"))
      .mockRejectedValueOnce(makeSocketError("ECONNRESET"))
      .mockResolvedValueOnce(makeAxiosResponse());

    await requestRunner(SAMPLE_CONFIG, { retries: 2, retryDelay: 0 })();

    expect(mockAxiosFn).toHaveBeenCalledTimes(3);
    expect(mockCreateAxiosAgents).toHaveBeenCalledTimes(1);
  });

  it("falls back to createAxiosAgents when sharedAgents is NOT provided", async () => {
    mockAxiosFn.mockResolvedValueOnce(makeAxiosResponse());

    await requestRunner(SAMPLE_CONFIG)();

    expect(mockCreateAxiosAgents).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Story 1 — Shared instances: preRequestScriptRunner hook injection", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCreateHoppFetchHook.mockReturnValue(vi.fn());
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("calls createHoppFetchHook when NO sharedHoppFetchHook is provided", async () => {
    // Call with no hook → should create one internally
    await preRequestScriptRunner(
      { ...DEFAULT_REQUEST, preRequestScript: "" },
      DEFAULT_ENVS,
      false
    )();

    expect(mockCreateHoppFetchHook).toHaveBeenCalledTimes(1);
  });

  it("does NOT call createHoppFetchHook when sharedHoppFetchHook is provided", async () => {
    const sharedHook = vi.fn(async () => new Response());

    await preRequestScriptRunner(
      { ...DEFAULT_REQUEST, preRequestScript: "" },
      DEFAULT_ENVS,
      false,
      undefined,       // collectionVariables
      [],              // inheritedPreRequestScripts
      sharedHook       // ← shared hook injected
    )();

    expect(mockCreateHoppFetchHook).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Story 1 — Shared instances: processRequest threads shared instances", () => {
  beforeEach(() => {
    // clearAllMocks resets call history but keeps mock implementations —
    // avoids the subtle "vi.resetAllMocks removes implementations" trap.
    vi.clearAllMocks();
    mockAxiosFn.isAxiosError.mockReturnValue(false);
    mockAxiosFn.create.mockReturnValue(mockAxiosFn);
    mockCreateAxiosAgents.mockReturnValue({
      httpAgent: { type: "http-default" },
      httpsAgent: { type: "https-default" },
    });
    mockCreateHoppFetchHook.mockReturnValue(vi.fn());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does NOT call createAxiosAgents when sharedAgents is passed via ProcessRequestParams", async () => {
    mockAxiosFn.mockResolvedValueOnce(makeAxiosResponse());

    const sharedAgents = {
      httpAgent: { type: "shared-http" } as any,
      httpsAgent: { type: "shared-https" } as any,
    };

    await processRequest({
      request: DEFAULT_REQUEST,
      envs: DEFAULT_ENVS,
      path: "collection/Test",
      delay: 0,
      sharedAgents,
    })();

    expect(mockCreateAxiosAgents).not.toHaveBeenCalled();
    expect(mockAxiosFn).toHaveBeenCalledWith(
      expect.objectContaining({
        httpAgent: { type: "shared-http" },
        httpsAgent: { type: "shared-https" },
      })
    );
  });

  it("does NOT call createHoppFetchHook when sharedHoppFetchHook is passed via ProcessRequestParams", async () => {
    mockAxiosFn.mockResolvedValueOnce(makeAxiosResponse());

    const sharedHook = vi.fn(async () => new Response());

    // Capture the call count BEFORE the processRequest call so we detect
    // only calls triggered by THIS invocation (not any prior test residue).
    const callsBefore = mockCreateHoppFetchHook.mock.calls.length;

    await processRequest({
      request: DEFAULT_REQUEST,
      envs: DEFAULT_ENVS,
      path: "collection/Test",
      delay: 0,
      sharedHoppFetchHook: sharedHook,
    })();

    const callsAfter = mockCreateHoppFetchHook.mock.calls.length;
    // No new calls to createHoppFetchHook should have occurred
    expect(callsAfter - callsBefore).toBe(0);
  });

  it("creates its own agents when sharedAgents is NOT provided (backward compat)", async () => {
    mockAxiosFn.mockResolvedValueOnce(makeAxiosResponse());

    await processRequest({
      request: DEFAULT_REQUEST,
      envs: DEFAULT_ENVS,
      path: "collection/Test",
      delay: 0,
    })();

    expect(mockCreateAxiosAgents).toHaveBeenCalledTimes(1);
  });

  it("creates its own HoppFetchHook when sharedHoppFetchHook is NOT provided (backward compat)", async () => {
    mockAxiosFn.mockResolvedValueOnce(makeAxiosResponse());

    const callsBefore = mockCreateHoppFetchHook.mock.calls.length;

    await processRequest({
      request: DEFAULT_REQUEST,
      envs: DEFAULT_ENVS,
      path: "collection/Test",
      delay: 0,
    })();

    const callsAfter = mockCreateHoppFetchHook.mock.calls.length;
    // At least one call to createHoppFetchHook should have occurred
    expect(callsAfter - callsBefore).toBeGreaterThan(0);
  });
});

