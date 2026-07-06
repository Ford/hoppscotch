import {
  Environment,
  HoppCollection,
  HoppCollectionVariable,
  HoppRESTRequest,
} from "@hoppscotch/data";
import { z } from "zod";

import { TestReport } from "../interfaces/response";
import { HoppCLIError } from "./errors";

export type FormDataEntry = {
  key: string;
  value: string | Blob;
  contentType?: string;
};

export type HoppEnvPair = Environment["variables"][number];

export const HoppEnvKeyPairObject = z.record(z.string(), z.string());

export type HoppEnvs = {
  global: HoppEnvPair[];
  selected: HoppEnvPair[];
};

export type CollectionQueue = {
  path: string;
  collection: HoppCollection;
};

export type RequestReport = {
  path: string;
  tests: TestReport[];
  errors: HoppCLIError[];
  result: boolean;
  duration: { test: number; request: number; preRequest: number };
};

export type ProcessRequestParams = {
  request: HoppRESTRequest;
  envs: HoppEnvs;
  path: string;
  delay: number;
  legacySandbox?: boolean;
  collectionVariables?: HoppCollectionVariable[];
  inheritedPreRequestScripts?: string[];
  inheritedTestScripts?: string[];
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
