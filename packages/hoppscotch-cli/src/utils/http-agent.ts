import * as https from "https";
import * as http from "http";
import * as fs from "fs";
// proxy-agent is an external ESM package — static import is required
// (require() does not exist in the ESM output produced by tsup)
import { ProxyAgent } from "proxy-agent";

/**
 * Returns the first non-empty value from a list of environment variable names.
 */
const getEnvVar = (...names: string[]): string | undefined => {
  for (const name of names) {
    const val = process.env[name];
    if (val && val.trim() !== "") return val.trim();
  }
  return undefined;
};

/**
 * Check whether a given hostname is covered by the NO_PROXY / no_proxy list.
 *
 * Supports:
 *  - Exact host match:       "example.com"
 *  - Wildcard subdomain:     ".example.com"
 *  - All hosts:              "*"
 *
 * Note: CIDR range entries (e.g. "10.0.0.0/8") are left to proxy-agent's
 * built-in resolver for IP-addressed requests; they are intentionally skipped
 * here (a hostname won't accidentally match a CIDR string).
 */
export const isNoProxy = (hostname: string): boolean => {
  const noProxy = getEnvVar("NO_PROXY", "no_proxy");
  if (!noProxy) return false;

  const entries = noProxy.split(",").map((e) => e.trim().toLowerCase());
  const host = hostname.toLowerCase();

  return entries.some((entry) => {
    // Skip CIDR-notation entries (e.g. "10.0.0.0/8") — only relevant for IPs
    if (/\/\d+$/.test(entry)) return false;
    if (entry === "*") return true;
    // Leading dot = match the domain and all its subdomains
    if (entry.startsWith("."))
      return host === entry.slice(1) || host.endsWith(entry);
    // Exact host OR the hostname is a subdomain of the entry
    return host === entry || host.endsWith(`.${entry}`);
  });
};

/**
 * Creates HTTP / HTTPS agents for axios requests.
 *
 * Behaviour:
 *  1. If `forcedProxyUrl` is provided (--proxy flag), that proxy is used
 *     unconditionally — NO_PROXY is ignored, matching curl --proxy behaviour.
 *  2. Otherwise, if HTTPS_PROXY / HTTP_PROXY / ALL_PROXY is set AND the target
 *     host is NOT in NO_PROXY, requests are routed through that proxy.
 *  3. If `insecure` is true (--insecure or NODE_TLS_REJECT_UNAUTHORIZED=0),
 *     TLS certificate validation is disabled.
 *  4. Custom CA certificates from `caCertPath` are loaded when provided.
 *  5. Both agents use `keepAlive: true` to avoid socket churn.
 *
 * IMPORTANT for Ford/corporate environments:
 *  - If the target host is in NO_PROXY AND the network blocks direct connections,
 *    either remove the host from NO_PROXY or use the --proxy flag to force routing.
 *  - `curl --proxy http://internet.ford.com:83 <url>` → CLI: --proxy http://internet.ford.com:83
 */
export const createAxiosAgents = (
  targetUrl?: string,
  insecure?: boolean,
  caCertPath?: string,
  forcedProxyUrl?: string
): { httpAgent: http.Agent; httpsAgent: https.Agent } => {
  // Determine TLS rejectUnauthorized setting
  const rejectUnauthorized =
    !insecure && process.env["NODE_TLS_REJECT_UNAUTHORIZED"] !== "0";

  // Load custom CA bundle if provided
  let ca: Buffer | undefined;
  if (caCertPath) {
    try {
      ca = fs.readFileSync(caCertPath);
    } catch {
      console.warn(
        `[hopp] Warning: Could not read CA certificate at "${caCertPath}". Ignoring.`
      );
    }
  }

  // Resolve hostname from the target URL for NO_PROXY checking
  const hostname = targetUrl
    ? (() => {
        try {
          return new URL(targetUrl).hostname;
        } catch {
          return "";
        }
      })()
    : "";

  // --proxy flag overrides everything (no NO_PROXY check), matching curl --proxy
  if (forcedProxyUrl) {
    const proxyAgent = new ProxyAgent({
      getProxyForUrl: () => forcedProxyUrl,
    }) as unknown as http.Agent;
    return {
      httpAgent: proxyAgent,
      httpsAgent: proxyAgent as unknown as https.Agent,
    };
  }

  // Check if this host is explicitly excluded from proxying
  const skipProxy = isNoProxy(hostname);

  // Determine the proxy URL from standard environment variables
  const proxyUrl = skipProxy
    ? undefined
    : getEnvVar(
        "HTTPS_PROXY",
        "https_proxy",
        "HTTP_PROXY",
        "http_proxy",
        "ALL_PROXY",
        "all_proxy"
      );

  if (proxyUrl) {
    // Use proxy-agent for this request.
    // proxy-agent handles HTTP CONNECT tunnelling for HTTPS targets automatically.
    // We provide a fixed getProxyForUrl so our own NO_PROXY resolution takes effect
    // rather than proxy-agent re-reading the env (it already read it above).
    const proxyAgent = new ProxyAgent({
      getProxyForUrl: () => proxyUrl,
    }) as unknown as http.Agent;

    return {
      httpAgent: proxyAgent,
      httpsAgent: proxyAgent as unknown as https.Agent,
    };
  }

  // No proxy — direct connection with keep-alive and optional TLS overrides
  const httpAgent = new http.Agent({ keepAlive: true });
  const httpsAgent = new https.Agent({
    keepAlive: true,
    rejectUnauthorized,
    ...(ca ? { ca } : {}),
  });

  return { httpAgent, httpsAgent };
};

/**
 * Returns a human-readable hint for common Node.js socket/network error codes.
 */
export const getNetworkErrorHint = (code: string | undefined): string => {
  switch (code) {
    case "ECONNRESET":
      return (
        "socket hang up — check proxy settings " +
        "(HTTP_PROXY / HTTPS_PROXY env vars). If the host is in NO_PROXY but " +
        "requires a proxy, remove it from NO_PROXY."
      );
    case "ECONNABORTED":
      return (
        "request timed out — the server did not respond within the allowed time. " +
        "Use --timeout <ms> to increase it, or --timeout 0 to disable the timeout."
      );
    case "ECONNREFUSED":
      return "connection refused — is the target server running and reachable?";
    case "ETIMEDOUT":
      return "connection timed out — the server did not respond in time";
    case "ENOTFOUND":
      return "DNS lookup failed — verify the hostname is correct";
    case "EPROTO":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "CERT_HAS_EXPIRED":
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
    case "SELF_SIGNED_CERT_IN_CHAIN":
      return (
        "TLS/SSL certificate error — use --insecure to skip certificate " +
        "validation or --ca-cert <path> to supply a custom CA bundle"
      );
    default:
      return "";
  }
};
