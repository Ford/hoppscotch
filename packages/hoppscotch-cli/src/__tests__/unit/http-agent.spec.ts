import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock proxy-agent BEFORE any imports ─────────────────────────────────────
// vi.mock() is hoisted by Vitest — factories MUST NOT reference external vars.
// ProxyAgent is used with `new`, so the mock must be a regular constructor
// function (arrow functions cannot be used as constructors).
vi.mock("proxy-agent", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ProxyAgent: vi.fn(function (this: any, opts?: any) {
    if (opts) Object.assign(this, opts);
    this.type = "ProxyAgent";
  }),
}));

// Import mocked module AFTER vi.mock() to get the typed mock reference
import { ProxyAgent } from "proxy-agent";
import { isNoProxy, createAxiosAgents } from "../../utils/http-agent";

// Cast to vi mock type so we can call .mockClear(), inspect .mock.calls, etc.
const MockProxyAgent = ProxyAgent as unknown as ReturnType<typeof vi.fn>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const setEnv = (vars: Record<string, string | undefined>) => {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
};

const clearProxyEnv = () =>
  setEnv({
    HTTP_PROXY: undefined,
    http_proxy: undefined,
    HTTPS_PROXY: undefined,
    https_proxy: undefined,
    ALL_PROXY: undefined,
    all_proxy: undefined,
    NO_PROXY: undefined,
    no_proxy: undefined,
    NODE_TLS_REJECT_UNAUTHORIZED: undefined,
  });

// ─────────────────────────────────────────────────────────────────────────────
describe("isNoProxy", () => {
  beforeEach(clearProxyEnv);
  afterEach(clearProxyEnv);

  it("returns false when NO_PROXY is not set", () => {
    expect(isNoProxy("ford3.na1.ondemand.vertexinc.com")).toBe(false);
  });

  it("returns true for an exact hostname match", () => {
    setEnv({ NO_PROXY: "ford3.na1.ondemand.vertexinc.com" });
    expect(isNoProxy("ford3.na1.ondemand.vertexinc.com")).toBe(true);
  });

  it("returns false for a hostname NOT in the list", () => {
    setEnv({ NO_PROXY: "localhost,127.0.0.1,example.com" });
    expect(isNoProxy("ford3.na1.ondemand.vertexinc.com")).toBe(false);
  });

  it("returns true when wildcard .domain matches a subdomain", () => {
    setEnv({ NO_PROXY: ".ford.com" });
    expect(isNoProxy("api.ford.com")).toBe(true);
  });

  it("returns true when wildcard .domain matches the apex domain itself", () => {
    setEnv({ NO_PROXY: ".ford.com" });
    expect(isNoProxy("ford.com")).toBe(true);
  });

  it("returns false when wildcard .domain does NOT match an unrelated host", () => {
    setEnv({ NO_PROXY: ".ford.com" });
    expect(isNoProxy("ford3.na1.ondemand.vertexinc.com")).toBe(false);
  });

  it("returns true when * is in the list (match all)", () => {
    setEnv({ NO_PROXY: "*" });
    expect(isNoProxy("anything.example.com")).toBe(true);
  });

  it("is case-insensitive", () => {
    setEnv({ NO_PROXY: "Ford3.NA1.ondemand.vertexinc.com" });
    expect(isNoProxy("ford3.na1.ondemand.vertexinc.com")).toBe(true);
  });

  it("reads lowercase no_proxy env var", () => {
    setEnv({ no_proxy: "ford3.na1.ondemand.vertexinc.com" });
    expect(isNoProxy("ford3.na1.ondemand.vertexinc.com")).toBe(true);
  });

  it("trims spaces around comma-separated entries", () => {
    setEnv({ NO_PROXY: "localhost , ford3.na1.ondemand.vertexinc.com , 127.0.0.1" });
    expect(isNoProxy("ford3.na1.ondemand.vertexinc.com")).toBe(true);
  });

  it("ignores CIDR entries — does NOT match a hostname against a CIDR range", () => {
    setEnv({ NO_PROXY: "10.0.0.0/8,172.16.0.0/12,192.168.0.0/16" });
    expect(isNoProxy("ford3.na1.ondemand.vertexinc.com")).toBe(false);
  });

  it("works with the full Ford NO_PROXY list when host is NOT in the list", () => {
    setEnv({
      NO_PROXY:
        "localhost,127.0.0.0/8,19.0.0.0/8,10.0.0.0/8,172.16.0.0/12," +
        ".fordcredit.com,.fordpro.com,.ford.com,.googleapis.com,.gcr.io,.run.app",
    });
    // ford3.na1.ondemand.vertexinc.com is NOT in this list
    expect(isNoProxy("ford3.na1.ondemand.vertexinc.com")).toBe(false);
  });

  it("works with the full Ford NO_PROXY list when host IS explicitly in the list", () => {
    setEnv({
      NO_PROXY:
        "localhost,127.0.0.0/8,10.0.0.0/8,.ford.com,ford3.na1.ondemand.vertexinc.com",
    });
    expect(isNoProxy("ford3.na1.ondemand.vertexinc.com")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("createAxiosAgents", () => {
  beforeEach(() => {
    clearProxyEnv();
    MockProxyAgent.mockClear();
  });
  afterEach(clearProxyEnv);

  // Helper: get the instance produced by the most recent `new ProxyAgent()`
  const getInstance = () => MockProxyAgent.mock.instances[0] as any;

  // ── No proxy configured ───────────────────────────────────────────────────

  it("returns plain http/https agents when no proxy env vars are set", () => {
    const { httpAgent, httpsAgent } = createAxiosAgents("https://example.com");
    expect(MockProxyAgent).not.toHaveBeenCalled();
    expect(httpAgent).toBeDefined();
    expect(httpsAgent).toBeDefined();
  });

  // ── Automatic proxy from env vars ─────────────────────────────────────────

  it("uses ProxyAgent when HTTPS_PROXY is set and host is NOT in NO_PROXY", () => {
    setEnv({ HTTPS_PROXY: "http://internet.ford.com:83" });
    const { httpAgent, httpsAgent } = createAxiosAgents(
      "https://ford3.na1.ondemand.vertexinc.com/api"
    );
    expect(MockProxyAgent).toHaveBeenCalledTimes(1);
    const inst = getInstance();
    expect(httpAgent).toBe(inst);
    expect(httpsAgent).toBe(inst);
  });

  it("skips proxy when HTTPS_PROXY is set BUT host IS in NO_PROXY", () => {
    setEnv({
      HTTPS_PROXY: "http://internet.ford.com:83",
      NO_PROXY: "ford3.na1.ondemand.vertexinc.com",
    });
    createAxiosAgents("https://ford3.na1.ondemand.vertexinc.com/api");
    expect(MockProxyAgent).not.toHaveBeenCalled();
  });

  it("reads HTTP_PROXY when HTTPS_PROXY is not set", () => {
    setEnv({ HTTP_PROXY: "http://internet.ford.com:83" });
    createAxiosAgents("https://ford3.na1.ondemand.vertexinc.com/api");
    expect(MockProxyAgent).toHaveBeenCalledTimes(1);
  });

  // ── forcedProxyUrl — equivalent to curl --proxy ───────────────────────────

  it("forcedProxyUrl bypasses NO_PROXY (like curl --proxy)", () => {
    setEnv({ NO_PROXY: "ford3.na1.ondemand.vertexinc.com" });
    const { httpAgent, httpsAgent } = createAxiosAgents(
      "https://ford3.na1.ondemand.vertexinc.com/api",
      false,
      undefined,
      "http://internet.ford.com:83"
    );
    expect(MockProxyAgent).toHaveBeenCalledTimes(1);
    const inst = getInstance();
    expect(httpAgent).toBe(inst);
    expect(httpsAgent).toBe(inst);
  });

  it("forcedProxyUrl getProxyForUrl always returns the forced URL", () => {
    createAxiosAgents(
      "https://ford3.na1.ondemand.vertexinc.com/api",
      false,
      undefined,
      "http://internet.ford.com:83"
    );
    const constructorOpts = MockProxyAgent.mock.calls[0][0] as any;
    expect(constructorOpts.getProxyForUrl("https://anything.com")).toBe(
      "http://internet.ford.com:83"
    );
  });

  it("forcedProxyUrl works even when no proxy env vars are set", () => {
    createAxiosAgents(
      "https://ford3.na1.ondemand.vertexinc.com/api",
      false,
      undefined,
      "http://internet.ford.com:83"
    );
    expect(MockProxyAgent).toHaveBeenCalledTimes(1);
  });

  // ── TLS / insecure ────────────────────────────────────────────────────────

  it("sets rejectUnauthorized=false when insecure=true", () => {
    const { httpsAgent } = createAxiosAgents("https://example.com", true);
    expect(MockProxyAgent).not.toHaveBeenCalled();
    expect((httpsAgent as any).options?.rejectUnauthorized).toBe(false);
  });

  it("sets rejectUnauthorized=false when NODE_TLS_REJECT_UNAUTHORIZED=0", () => {
    setEnv({ NODE_TLS_REJECT_UNAUTHORIZED: "0" });
    const { httpsAgent } = createAxiosAgents("https://example.com");
    expect((httpsAgent as any).options?.rejectUnauthorized).toBe(false);
  });

  it("sets rejectUnauthorized=true by default (secure)", () => {
    const { httpsAgent } = createAxiosAgents("https://example.com");
    expect((httpsAgent as any).options?.rejectUnauthorized).toBe(true);
  });
});

