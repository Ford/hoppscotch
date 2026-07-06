import { HoppCollection } from "@hoppscotch/data";
import { HoppEnvPair, HoppEnvs } from "./request";

export type CollectionRunnerParam = {
  collections: HoppCollection[];
  envs: HoppEnvs;
  delay?: number;
  iterationData?: IterationDataItem[][];
  iterationCount?: number;
  legacySandbox: boolean;
  /** Request timeout in milliseconds. 0 = no timeout. Default: 30000 */
  timeout?: number;
  /** Number of retries on transient socket errors. Default: 0 */
  retries?: number;
  /** Disable TLS certificate validation */
  insecure?: boolean;
  /** Path to a custom CA certificate bundle (PEM file) */
  caCert?: string;
  /**
   * Force a specific proxy URL, bypassing NO_PROXY (equivalent to curl --proxy).
   */
  proxy?: string;
};

export type HoppCollectionFileExt = "json";

// Indicates the shape each iteration data entry gets transformed into
export type IterationDataItem = Extract<HoppEnvPair, { value: string }>;
