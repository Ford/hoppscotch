/**
 * SecretManagerService - Secure secret storage and retrieval service
 *
 * This service provides a high-level API for storing sensitive data (passwords, tokens, API keys, etc.)
 * using the operating system's native keychain services.
 *
 * ## Architecture
 *
 * ```
 * ┌──────────────────────────────────────────────────────────┐
 * │ Application Layer                                        │
 * │ (CookieJarService, Collections, OAuth, etc.)             │
 * └──────────────────┬───────────────────────────────────────┘
 *                    │
 *                    │ Uses secret references: "{{secret:key}}"
 *                    │
 * ┌──────────────────▼───────────────────────────────────────┐
 * │ SecretManagerService (THIS FILE)                         │
 * │ - Generates secret references                            │
 * │ - Resolves references to actual values                   │
 * │ - Detects platform (desktop vs web)                      │
 * └──────────────────┬───────────────────────────────────────┘
 *                    │
 *                    │ invoke('store_secret', ...)
 *                    │
 * ┌──────────────────▼───────────────────────────────────────┐
 * │ Tauri Backend (Rust) - Desktop Only                      │
 * │ packages/hoppscotch-desktop/src-tauri/src/secrets.rs     │
 * └──────────────────┬───────────────────────────────────────┘
 *                    │
 *                    │ keyring::Entry API
 *                    │
 * ┌──────────────────▼───────────────────────────────────────┐
 * │ OS Keychain (Native)                                     │
 * │ - macOS: Keychain Services (AES-256 encrypted)           │
 * │ - Windows: Credential Manager (DPAPI encrypted)          │
 * │ - Linux: Secret Service (gnome-keyring, KWallet)         │
 * └──────────────────────────────────────────────────────────┘
 * ```
 *
 * ## Secret References Pattern
 *
 * Instead of storing actual secret values in Tauri Store (JSON file), we store
 * references that point to secrets in the keychain:
 *
 * ```typescript
 * // Before (INSECURE - plain text in JSON):
 * {
 *   "clientSecret": "sk_live_51HabcXYZ123..."
 * }
 *
 * // After (SECURE - reference in JSON, value in encrypted keychain):
 * {
 *   "clientSecret": "{{secret:oauth_prod_client_secret}}"
 * }
 * ```
 *
 * ## Usage Examples
 *
 * ### Storing a secret
 * ```typescript
 * const secretManager = getService(SecretManagerService)
 *
 * // Generate a unique key
 * const secretKey = secretManager.generateSecretKey('oauth_client_secret')
 * // Returns: "oauth_client_secret_a1b2c3d4"
 *
 * // Store the secret in keychain
 * await secretManager.storeSecret(secretKey, 'sk_live_51HabcXYZ123...')
 *
 * // Get a reference to use in collections
 * const reference = secretManager.createSecretReference(secretKey)
 * // Returns: "{{secret:oauth_client_secret_a1b2c3d4}}"
 *
 * // Store the reference in your data
 * collection.auth.clientSecret = reference
 * ```
 *
 * ### Retrieving a secret
 * ```typescript
 * const secretManager = getService(SecretManagerService)
 *
 * // Check if it's a secret reference
 * if (secretManager.isSecretReference(collection.auth.clientSecret)) {
 *   // Resolve the reference to get the actual value
 *   const actualSecret = await secretManager.resolveSecretReference(
 *     collection.auth.clientSecret
 *   )
 *   // Use actualSecret for API call
 * }
 * ```
 *
 * ### Batch resolution
 * ```typescript
 * const data = {
 *   clientId: "abc123",
 *   clientSecret: "{{secret:oauth_prod_client_secret}}",
 *   apiKey: "{{secret:api_key_prod}}",
 *   username: "john.doe"
 * }
 *
 * // Resolve all secret references in the object
 * const resolved = await secretManager.resolveSecretsInObject(data)
 * // Returns:
 * // {
 * //   clientId: "abc123",
 * //   clientSecret: "sk_live_51HabcXYZ123...",  // Resolved!
 * //   apiKey: "ak_live_xyz789...",               // Resolved!
 * //   username: "john.doe"
 * // }
 * ```
 *
 * ## Platform Detection
 *
 * This service automatically detects the platform:
 * - **Desktop**: Uses Tauri commands to access OS keychain
 * - **Web**: Falls back to localStorage (not encrypted, but isolated by origin)
 *
 * ## Security Features
 *
 * 1. **Encryption at rest**: All secrets encrypted by OS (not by this service)
 * 2. **User isolation**: Only accessible by the user who stored them
 * 3. **Memory safety**: Secrets loaded into memory only when needed
 * 4. **Reference pattern**: Prevents accidental logging/exposure of secrets
 * 5. **Platform-aware**: Degrades gracefully on web platform
 *
 * @module services/secret-manager.service
 */

import { Service } from "dioc"
import { invoke } from "@tauri-apps/api/core"
import { APP_IS_IN_DEV_MODE } from "~/helpers/dev"
import { platform } from "~/platform"

/**
 * Secret reference pattern: {{secret:key_name}}
 * This regex matches the pattern and captures the key name
 */
const SECRET_REFERENCE_PATTERN = /^\{\{secret:([^}]+)\}\}$/

/**
 * Error thrown when secret operations fail
 */
export class SecretError extends Error {
  constructor(
    message: string,
    public code: string,
    public originalError?: unknown
  ) {
    super(message)
    this.name = "SecretError"
  }
}

/**
 * SecretManagerService - Manages secure storage and retrieval of sensitive data
 */
export class SecretManagerService extends Service {
  public static readonly ID = "SECRET_MANAGER_SERVICE"

  /**
   * Whether the current platform supports OS keychain integration
   */
  private isDesktop = false

  override onServiceInit() {
    // Detect if we're running in Tauri desktop app
    this.isDesktop = platform === "desktop"

    if (APP_IS_IN_DEV_MODE) {
      console.log(
        `[SecretManager] Service initialized (platform: ${
          this.isDesktop ? "desktop" : "web"
        })`
      )
    }

    if (!this.isDesktop) {
      console.warn(
        "[SecretManager] Running on web platform - secrets will be stored in localStorage (not encrypted)"
      )
    }
  }

  /**
   * Generate a unique secret key with optional prefix and suffix
   *
   * @param baseName - Base name for the secret (e.g., 'oauth_client_secret')
   * @param includeTimestamp - Whether to include timestamp for uniqueness
   * @returns Unique secret key (e.g., 'oauth_client_secret_1707750123')
   *
   * @example
   * ```typescript
   * const key1 = generateSecretKey('api_key')
   * // Returns: "api_key_1707750123"
   *
   * const key2 = generateSecretKey('cookie_session', false)
   * // Returns: "cookie_session"
   * ```
   */
  public generateSecretKey(
    baseName: string,
    includeTimestamp = true
  ): string {
    // Sanitize base name (remove special characters)
    const sanitized = baseName.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase()

    if (includeTimestamp) {
      const timestamp = Date.now()
      return `${sanitized}_${timestamp}`
    }

    return sanitized
  }

  /**
   * Create a secret reference string that can be stored in place of actual value
   *
   * @param secretKey - The key used to store the secret in keychain
   * @returns Secret reference string (e.g., '{{secret:oauth_client_secret}}')
   *
   * @example
   * ```typescript
   * const ref = createSecretReference('api_key_prod')
   * // Returns: "{{secret:api_key_prod}}"
   *
   * // Store this reference instead of the actual secret
   * collection.auth.apiKey = ref
   * ```
   */
  public createSecretReference(secretKey: string): string {
    return `{{secret:${secretKey}}}`
  }

  /**
   * Check if a string is a secret reference
   *
   * @param value - String to check
   * @returns True if it's a secret reference, false otherwise
   *
   * @example
   * ```typescript
   * isSecretReference("{{secret:api_key}}") // true
   * isSecretReference("regular_value")      // false
   * isSecretReference("abc123")              // false
   * ```
   */
  public isSecretReference(value: unknown): boolean {
    if (typeof value !== "string") return false
    return SECRET_REFERENCE_PATTERN.test(value)
  }

  /**
   * Extract the secret key from a secret reference
   *
   * @param reference - Secret reference string
   * @returns The secret key, or null if not a valid reference
   *
   * @example
   * ```typescript
   * extractSecretKey("{{secret:api_key}}") // "api_key"
   * extractSecretKey("regular_value")      // null
   * ```
   */
  public extractSecretKey(reference: string): string | null {
    const match = reference.match(SECRET_REFERENCE_PATTERN)
    return match ? match[1] : null
  }

  /**
   * Store a secret in the OS keychain (desktop) or localStorage (web)
   *
   * @param key - Unique identifier for the secret
   * @param value - The actual secret value to store
   * @throws {SecretError} If storage fails
   *
   * @example
   * ```typescript
   * await secretManager.storeSecret('oauth_prod', 'sk_live_51HabcXYZ123...')
   * ```
   */
  public async storeSecret(key: string, value: string): Promise<void> {
    try {
      if (this.isDesktop) {
        // Desktop: Use Tauri command to store in OS keychain
        await invoke<void>("store_secret", { key, value })

        if (APP_IS_IN_DEV_MODE) {
          console.log(
            `[SecretManager] Stored secret in OS keychain: ${key} (${value.length} chars)`
          )
        }
      } else {
        // Web: Fall back to localStorage (not encrypted, but better than nothing)
        localStorage.setItem(`hopp_secret_${key}`, value)

        if (APP_IS_IN_DEV_MODE) {
          console.log(
            `[SecretManager] Stored secret in localStorage: ${key} (${value.length} chars)`
          )
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new SecretError(
        `Failed to store secret: ${message}`,
        "STORE_FAILED",
        error
      )
    }
  }

  /**
   * Retrieve a secret from the OS keychain (desktop) or localStorage (web)
   *
   * @param key - The secret key used during storage
   * @returns The decrypted secret value
   * @throws {SecretError} If secret not found or retrieval fails
   *
   * @example
   * ```typescript
   * const secret = await secretManager.getSecret('oauth_prod')
   * // Returns: "sk_live_51HabcXYZ123..."
   * ```
   */
  public async getSecret(key: string): Promise<string> {
    try {
      if (this.isDesktop) {
        // Desktop: Use Tauri command to get from OS keychain
        const value = await invoke<string>("get_secret", { key })

        if (APP_IS_IN_DEV_MODE) {
          console.log(
            `[SecretManager] Retrieved secret from OS keychain: ${key} (${value.length} chars)`
          )
        }

        return value
      } else {
        // Web: Get from localStorage
        const value = localStorage.getItem(`hopp_secret_${key}`)

        if (value === null) {
          throw new Error(`Secret not found: ${key}`)
        }

        if (APP_IS_IN_DEV_MODE) {
          console.log(
            `[SecretManager] Retrieved secret from localStorage: ${key} (${value.length} chars)`
          )
        }

        return value
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new SecretError(
        `Failed to retrieve secret: ${message}`,
        "GET_FAILED",
        error
      )
    }
  }

  /**
   * Delete a secret from the OS keychain (desktop) or localStorage (web)
   *
   * @param key - The secret key to delete
   * @throws {SecretError} If deletion fails (but not if secret doesn't exist)
   *
   * @example
   * ```typescript
   * await secretManager.deleteSecret('oauth_prod')
   * ```
   */
  public async deleteSecret(key: string): Promise<void> {
    try {
      if (this.isDesktop) {
        // Desktop: Use Tauri command to delete from OS keychain
        await invoke<void>("delete_secret", { key })

        if (APP_IS_IN_DEV_MODE) {
          console.log(`[SecretManager] Deleted secret from OS keychain: ${key}`)
        }
      } else {
        // Web: Remove from localStorage
        localStorage.removeItem(`hopp_secret_${key}`)

        if (APP_IS_IN_DEV_MODE) {
          console.log(`[SecretManager] Deleted secret from localStorage: ${key}`)
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new SecretError(
        `Failed to delete secret: ${message}`,
        "DELETE_FAILED",
        error
      )
    }
  }

  /**
   * Check if a secret exists in storage
   *
   * @param key - The secret key to check
   * @returns True if secret exists, false otherwise
   *
   * @example
   * ```typescript
   * if (await secretManager.hasSecret('oauth_prod')) {
   *   console.log('Secret exists')
   * }
   * ```
   */
  public async hasSecret(key: string): Promise<boolean> {
    try {
      if (this.isDesktop) {
        // Desktop: Use Tauri command to check OS keychain
        return await invoke<boolean>("has_secret", { key })
      } else {
        // Web: Check localStorage
        return localStorage.getItem(`hopp_secret_${key}`) !== null
      }
    } catch (error) {
      // If check fails, assume doesn't exist
      return false
    }
  }

  /**
   * List all secret keys stored by Hoppscotch
   *
   * @returns Array of secret keys (not values)
   *
   * @example
   * ```typescript
   * const keys = await secretManager.listSecretKeys()
   * // Returns: ["oauth_prod", "api_key_dev", "cookie_session"]
   * ```
   */
  public async listSecretKeys(): Promise<string[]> {
    try {
      if (this.isDesktop) {
        // Desktop: Use Tauri command to list keys from registry
        return await invoke<string[]>("list_secret_keys")
      } else {
        // Web: List from localStorage
        const keys: string[] = []
        const prefix = "hopp_secret_"

        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i)
          if (key?.startsWith(prefix)) {
            keys.push(key.substring(prefix.length))
          }
        }

        return keys
      }
    } catch (error) {
      console.error("[SecretManager] Failed to list secret keys:", error)
      return []
    }
  }

  /**
   * Resolve a secret reference to its actual value
   *
   * @param reference - Secret reference string (e.g., '{{secret:api_key}}')
   * @returns The actual secret value
   * @throws {SecretError} If reference is invalid or secret not found
   *
   * @example
   * ```typescript
   * const value = await resolveSecretReference('{{secret:api_key}}')
   * // Returns: "ak_live_xyz789..."
   * ```
   */
  public async resolveSecretReference(reference: string): Promise<string> {
    const key = this.extractSecretKey(reference)

    if (!key) {
      throw new SecretError(
        `Invalid secret reference: ${reference}`,
        "INVALID_REFERENCE"
      )
    }

    return await this.getSecret(key)
  }

  /**
   * Resolve all secret references in an object (deeply nested)
   *
   * This function recursively traverses an object and replaces all secret references
   * with their actual values from the keychain.
   *
   * @param obj - Object containing potential secret references
   * @returns New object with all secret references resolved
   *
   * @example
   * ```typescript
   * const data = {
   *   auth: {
   *     clientId: "abc123",
   *     clientSecret: "{{secret:oauth_prod}}"
   *   },
   *   apiKey: "{{secret:api_key}}"
   * }
   *
   * const resolved = await resolveSecretsInObject(data)
   * // Returns:
   * // {
   * //   auth: {
   * //     clientId: "abc123",
   * //     clientSecret: "sk_live_51HabcXYZ123..."
   * //   },
   * //   apiKey: "ak_live_xyz789..."
   * // }
   * ```
   */
  public async resolveSecretsInObject<T>(obj: T): Promise<T> {
    if (obj === null || obj === undefined) {
      return obj
    }

    // Handle arrays
    if (Array.isArray(obj)) {
      return (await Promise.all(
        obj.map((item) => this.resolveSecretsInObject(item))
      )) as T
    }

    // Handle objects
    if (typeof obj === "object") {
      const resolved: any = {}

      for (const [key, value] of Object.entries(obj)) {
        if (this.isSecretReference(value)) {
          // Resolve the secret reference
          try {
            resolved[key] = await this.resolveSecretReference(value as string)
          } catch (error) {
            console.error(
              `[SecretManager] Failed to resolve secret reference in key "${key}":`,
              error
            )
            // Keep the reference if resolution fails
            resolved[key] = value
          }
        } else if (typeof value === "object" && value !== null) {
          // Recursively resolve nested objects
          resolved[key] = await this.resolveSecretsInObject(value)
        } else {
          // Keep non-secret values as-is
          resolved[key] = value
        }
      }

      return resolved as T
    }

    // Primitive values - return as-is
    return obj
  }

  /**
   * Store a value and return its secret reference
   *
   * This is a convenience method that combines secret key generation,
   * storage, and reference creation in one call.
   *
   * @param baseName - Base name for the secret key
   * @param value - The secret value to store
   * @returns Secret reference string to use in place of the value
   *
   * @example
   * ```typescript
   * const ref = await storeAndGetReference('oauth_client_secret', 'sk_live_123')
   * // Returns: "{{secret:oauth_client_secret_1707750123}}"
   *
   * // Now use this reference in your data
   * collection.auth.clientSecret = ref
   * ```
   */
  public async storeAndGetReference(
    baseName: string,
    value: string
  ): Promise<string> {
    const key = this.generateSecretKey(baseName)
    await this.storeSecret(key, value)
    return this.createSecretReference(key)
  }

  /**
   * Migrate a plain-text value to a secret reference
   *
   * This is useful for migrating existing data to use secret storage.
   *
   * @param baseName - Base name for the secret key
   * @param plainTextValue - The plain-text value to migrate
   * @returns Secret reference string
   *
   * @example
   * ```typescript
   * // Migrate existing plain-text secret
   * if (!secretManager.isSecretReference(collection.auth.clientSecret)) {
   *   collection.auth.clientSecret = await secretManager.migrateToSecretReference(
   *     'oauth_client_secret',
   *     collection.auth.clientSecret
   *   )
   * }
   * ```
   */
  public async migrateToSecretReference(
    baseName: string,
    plainTextValue: string
  ): Promise<string> {
    // If already a reference, return as-is
    if (this.isSecretReference(plainTextValue)) {
      return plainTextValue
    }

    // Store and get reference
    return await this.storeAndGetReference(baseName, plainTextValue)
  }
}
