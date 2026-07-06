export type TestCmdOptions = {
  env?: string;
  delay?: string;
  token?: string;
  server?: string;
  reporterJunit?: string;
  iterationCount?: number;
  iterationData?: string;
  legacySandbox?: boolean;
  /** Request timeout in milliseconds. 0 = no timeout. Default: 30000 */
  timeout?: number;
  /** Number of retries on transient socket errors. Default: 0 */
  retries?: number;
  /** Disable TLS certificate validation (equivalent to NODE_TLS_REJECT_UNAUTHORIZED=0) */
  insecure?: boolean;
  /** Path to a custom CA certificate bundle (PEM file) */
  caCert?: string;
  /**
   * Force a specific proxy URL, bypassing NO_PROXY (equivalent to curl --proxy).
   * Use when the target host is in NO_PROXY but is only reachable through the proxy.
   */
  proxy?: string;
};

// Consumed in the collection `file_path_or_id` argument action handler
export type TestCmdCollectionOptions = Omit<TestCmdOptions, "env" | "delay">;

// Consumed in the `--env, -e` flag action handler
export type TestCmdEnvironmentOptions = Omit<TestCmdOptions, "env"> & {
  env: string;
};

export type HOPP_ENV_FILE_EXT = "json";
