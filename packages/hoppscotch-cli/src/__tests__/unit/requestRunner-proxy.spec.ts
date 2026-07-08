/**
 * Tests for the updated requestRunner.
 * Covers: proxy/TLS agent wiring, enriched socket-error hints,
 * timeout config, HTTP-vs-socket error distinction, and retry logic.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AxiosResponse } from "axios";

// ─── All vi.mock() calls MUST come before any imports ────────────────────────
// vi.mock() is hoisted — factories must NOT reference external variables.

vi.mock("axios", () => {
  const mockFn = vi.fn();
  mockFn.isAxiosError = vi.fn(() => false);
  return { default: mockFn };
});

vi.mock("../../utils/http-agent", () => ({
  createAxiosAgents: vi.fn(() => ({
    httpAgent: { type: "http" },
    httpsAgent: { type: "https" },
  })),
  getNetworkErrorHint: vi.fn((code: string | undefined) => {
    if (code === "ECONNRESET")
      return "socket hang up — check proxy settings (HTTP_PROXY / HTTPS_PROXY env vars). If the host is in NO_PROXY but requires a proxy, remove it from NO_PROXY.";
    return "";
  }),
}));

// ─── Imports AFTER vi.mock() ─────────────────────────────────────────────────
import { requestRunner } from "../../utils/request";
import { createAxiosAgents } from "../../utils/http-agent";
import axios from "axios";
import type { RequestConfig } from "../../interfaces/request";

const mockAxiosFn = axios as unknown as ReturnType<typeof vi.fn> & {
  isAxiosError: ReturnType<typeof vi.fn>;
};

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SAMPLE_CONFIG: RequestConfig = {
  url: "https://ford3.na1.ondemand.vertexinc.com/vertex-ws/services/CalculateTax90",
  method: "POST",
};

const makeAxiosResponse = (overrides: Partial<AxiosResponse> = {}): AxiosResponse => ({
  data: { result: "ok" },
  status: 200,
  statusText: "OK",
  headers: { "content-type": "application/json" },
  config: SAMPLE_CONFIG as any,
  ...overrides,
});

const makeSocketError = (code = "ECONNRESET") => ({
  name: "AxiosError",
  message: "socket hang up",
  isAxiosError: true,
  config: SAMPLE_CONFIG,
  toJSON: () => ({}),
  request: {},   // request was sent, no response = socket-level failure
  code,
});

const makeHttpError = (status: number) => ({
  name: "AxiosError",
  message: `Request failed with status code ${status}`,
  isAxiosError: true,
  config: SAMPLE_CONFIG,
  toJSON: () => ({}),
  response: {
    data: {},
    status,
    statusText: String(status),
    headers: {},
    config: SAMPLE_CONFIG,
  } as AxiosResponse,
});

// ─────────────────────────────────────────────────────────────────────────────
describe("requestRunner", () => {
  beforeEach(() => {
    // resetAllMocks clears BOTH call history AND the "once" implementation queue,
    // preventing un-consumed mockResolvedValueOnce from leaking across tests.
    vi.resetAllMocks();
    // Re-initialize mocks whose return values are relied on by the code under test
    mockAxiosFn.isAxiosError.mockReturnValue(false);
    // createAxiosAgents is called inside attemptRequest — must return a valid object
    // after resetAllMocks() cleared the factory implementation.
    (createAxiosAgents as ReturnType<typeof vi.fn>).mockReturnValue({
      httpAgent: { type: "http" },
      httpsAgent: { type: "https" },
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // ── Happy path ───────────────────────────────────────────────────────────

  it("returns Right with response on a successful HTTP call", async () => {
    mockAxiosFn.mockResolvedValueOnce(makeAxiosResponse());

    const result = await requestRunner(SAMPLE_CONFIG)();

    expect(result._tag).toBe("Right");
    if (result._tag === "Right") {
      expect(result.right.status).toBe(200);
      expect(result.right.body).toEqual({ result: "ok" });
    }
  });

  // ── Proxy / agent wiring ─────────────────────────────────────────────────

  it("passes httpAgent and httpsAgent from createAxiosAgents into axios", async () => {
    mockAxiosFn.mockResolvedValueOnce(makeAxiosResponse());

    await requestRunner(SAMPLE_CONFIG, { proxy: "http://internet.ford.com:83" })();

    expect(createAxiosAgents).toHaveBeenCalledWith(
      expect.any(String),
      undefined,
      undefined,
      "http://internet.ford.com:83"
    );
    expect(mockAxiosFn).toHaveBeenCalledWith(
      expect.objectContaining({
        httpAgent: { type: "http" },
        httpsAgent: { type: "https" },
        proxy: false,
      })
    );
  });

  it("always sets proxy: false in axios config to disable built-in proxy", async () => {
    mockAxiosFn.mockResolvedValueOnce(makeAxiosResponse());
    await requestRunner(SAMPLE_CONFIG)();
    expect(mockAxiosFn).toHaveBeenCalledWith(expect.objectContaining({ proxy: false }));
  });

  // ── Timeout ──────────────────────────────────────────────────────────────

  it("passes specified timeout to axios", async () => {
    mockAxiosFn.mockResolvedValueOnce(makeAxiosResponse());
    await requestRunner(SAMPLE_CONFIG, { timeout: 5000 })();
    expect(mockAxiosFn).toHaveBeenCalledWith(expect.objectContaining({ timeout: 5000 }));
  });

  it("uses the default 30s timeout when no timeout option is provided", async () => {
    mockAxiosFn.mockResolvedValueOnce(makeAxiosResponse());
    await requestRunner(SAMPLE_CONFIG)();
    expect(mockAxiosFn).toHaveBeenCalledWith(expect.objectContaining({ timeout: 30_000 }));
  });

  it("omits timeout from axios config when timeout=0 (no timeout)", async () => {
    mockAxiosFn.mockResolvedValueOnce(makeAxiosResponse());
    await requestRunner(SAMPLE_CONFIG, { timeout: 0 })();
    const calledWith = mockAxiosFn.mock.calls[0][0];
    expect(calledWith).not.toHaveProperty("timeout");
  });

  // ── HTTP-level errors (server returned a response) ───────────────────────

  it("returns Right for HTTP 404 — server responded, test script should still run", async () => {
    mockAxiosFn.isAxiosError.mockReturnValue(true);
    mockAxiosFn.mockRejectedValueOnce(makeHttpError(404));

    const result = await requestRunner(SAMPLE_CONFIG)();

    expect(result._tag).toBe("Right");
    if (result._tag === "Right") expect(result.right.status).toBe(404);
  });

  it("returns Right for HTTP 500 — server responded, test script should still run", async () => {
    mockAxiosFn.isAxiosError.mockReturnValue(true);
    mockAxiosFn.mockRejectedValueOnce(makeHttpError(500));

    const result = await requestRunner(SAMPLE_CONFIG)();
    expect(result._tag).toBe("Right");
  });

  // ── Socket-level / network errors ────────────────────────────────────────

  it("returns Left with REQUEST_ERROR for ECONNRESET (socket hang up)", async () => {
    mockAxiosFn.isAxiosError.mockReturnValue(true);
    mockAxiosFn.mockRejectedValueOnce(makeSocketError("ECONNRESET"));

    const result = await requestRunner(SAMPLE_CONFIG)();

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") expect(result.left.code).toBe("REQUEST_ERROR");
  });

  it("enriches the ECONNRESET error message with a proxy hint", async () => {
    mockAxiosFn.isAxiosError.mockReturnValue(true);
    mockAxiosFn.mockRejectedValueOnce(makeSocketError("ECONNRESET"));

    const result = await requestRunner(SAMPLE_CONFIG)();

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      const msg = (result.left as any).data?.message ?? "";
      expect(msg).toMatch(/proxy/i);
    }
  });

  it("returns Left for unknown non-axios errors", async () => {
    mockAxiosFn.isAxiosError.mockReturnValue(false);
    mockAxiosFn.mockRejectedValueOnce(new Error("unexpected"));

    const result = await requestRunner(SAMPLE_CONFIG)();

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") expect(result.left.code).toBe("REQUEST_ERROR");
  });

  // ── Retry logic ──────────────────────────────────────────────────────────

  it("retries once on ECONNRESET (retries=1) and succeeds on second attempt", async () => {
    mockAxiosFn.isAxiosError.mockReturnValue(true);
    // Fail first, succeed second — if retry works, result is Right
    mockAxiosFn
      .mockRejectedValueOnce(makeSocketError("ECONNRESET"))
      .mockResolvedValueOnce(makeAxiosResponse());

    const result = await requestRunner(SAMPLE_CONFIG, { retries: 1, retryDelay: 0 })();

    // Key assertion: retry happened and the second attempt succeeded → Right
    expect(result._tag).toBe("Right");
    if (result._tag === "Right") {
      expect(result.right.status).toBe(200);
    }
  });

  it("does NOT retry when retries=0 — fails immediately on ECONNRESET", async () => {
    mockAxiosFn.isAxiosError.mockReturnValue(true);
    mockAxiosFn.mockRejectedValueOnce(makeSocketError("ECONNRESET"));

    const result = await requestRunner(SAMPLE_CONFIG, { retries: 0, retryDelay: 0 })();

    expect(mockAxiosFn).toHaveBeenCalledTimes(1);
    expect(result._tag).toBe("Left");
  });

  it("returns Left when all retry attempts are exhausted", async () => {
    mockAxiosFn.isAxiosError.mockReturnValue(true);
    // Supply enough rejections for all attempts (original + retries)
    mockAxiosFn
      .mockRejectedValueOnce(makeSocketError("ECONNRESET"))
      .mockRejectedValueOnce(makeSocketError("ECONNRESET"))
      .mockRejectedValueOnce(makeSocketError("ECONNRESET"));

    const result = await requestRunner(SAMPLE_CONFIG, { retries: 2, retryDelay: 0 })();

    // All attempts failed → Left
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left.code).toBe("REQUEST_ERROR");
    }
  });

  it("does NOT retry on HTTP-level errors (only socket-level errors are retried)", async () => {
    mockAxiosFn.isAxiosError.mockReturnValue(true);
    mockAxiosFn.mockRejectedValueOnce(makeHttpError(500));

    const result = await requestRunner(SAMPLE_CONFIG, { retries: 3, retryDelay: 0 })();

    // HTTP 500 = server responded → not retried
    expect(mockAxiosFn).toHaveBeenCalledTimes(1);
    expect(result._tag).toBe("Right");
  });
});

