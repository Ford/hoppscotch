/**
 * Multi-Certificate Registry — types and helpers.
 *
 * Each `ClientCertEntry` maps one hostname pattern to one client certificate.
 * The registry lives at the store level (not inside per-domain settings) so
 * that a single cert can cover multiple sub-paths / ports on the same host.
 *
 * Matching rules (per Jira story):
 *  - Exact match:   host === entry.hostname
 *  - Suffix match:  host ends with `.${entry.hostname}`
 *  - Precedence:    longest hostname wins (most specific)
 *  - No match:      request proceeds without a client certificate
 */

import type { StoreFile } from "@hoppscotch/kernel"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ClientCertPEM = {
  kind: "pem"
  cert?: StoreFile // .pem / .crt file bytes
  key?: StoreFile // .pem / .key file bytes
}

export type ClientCertPFX = {
  kind: "pfx"
  data?: StoreFile // .pfx / .p12 file bytes
  passphrase?: string // AES-GCM encrypted — never plain text at rest
}

export type ClientCertEntry = {
  /** Unique identifier for edit / delete operations */
  id: string
  /** Hostname or hostname pattern this cert applies to, e.g. "api.example.com" */
  hostname: string
} & (ClientCertPEM | ClientCertPFX)

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/**
 * Returns the best matching cert entry for the given `host`, or `undefined`
 * if no entry matches.  "Best" means the longest (most specific) hostname.
 */
export function findMatchingCert(
  host: string,
  certs: ClientCertEntry[]
): ClientCertEntry | undefined {
  const h = host.toLowerCase()
  return certs
    .filter((c) => {
      const pattern = c.hostname.toLowerCase()
      return h === pattern || h.endsWith(`.${pattern}`)
    })
    .sort((a, b) => b.hostname.length - a.hostname.length)[0]
}

// ---------------------------------------------------------------------------
// Conversion helpers (to RelayRequest.security.certificates.client shape)
// ---------------------------------------------------------------------------

/**
 * Converts a `ClientCertEntry` (plus its already-decrypted passphrase for PFX)
 * to the shape expected by `InputDomainSetting.security.certificates.client`.
 * Returns `undefined` when the entry is incomplete and should be skipped.
 */
export function certEntryToInputClient(
  entry: ClientCertEntry,
  decryptedPassphrase: string
):
  | { kind: "pem"; cert?: StoreFile; key?: StoreFile }
  | { kind: "pfx"; data?: StoreFile; password?: string }
  | undefined {
  if (entry.kind === "pem") {
    if (!entry.cert && !entry.key) return undefined
    return { kind: "pem", cert: entry.cert, key: entry.key }
  } else {
    if (!entry.data) return undefined
    return { kind: "pfx", data: entry.data, password: decryptedPassphrase }
  }
}

