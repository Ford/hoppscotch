declare module "@noble/hashes/hmac.js" {
  export function hmac(
    hash: unknown,
    key: Uint8Array | string,
    message: Uint8Array
  ): Uint8Array
}

declare module "@noble/hashes/sha2.js" {
  export function sha256(message: Uint8Array): Uint8Array
}

declare module "@noble/hashes/utils.js" {
  export function bytesToHex(bytes: Uint8Array): string
  export function utf8ToBytes(value: string): Uint8Array
}

