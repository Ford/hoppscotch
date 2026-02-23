import { Service } from "dioc"
import { ref, watch } from "vue"
import { parseString as setCookieParse } from "set-cookie-parser-es"
import { Cookie } from "@hoppscotch/data"
import { APP_IS_IN_DEV_MODE } from "~/helpers/dev"
import { getService } from "~/modules/dioc"
import type { SecretManagerService } from "./secret-manager.service"

const COOKIE_JAR_STORAGE_KEY = "hoppscotch_cookie_jar"
const MIGRATION_FLAG_KEY = "hoppscotch_cookie_migration_completed"

export class CookieJarService extends Service {
  public static readonly ID = "COOKIE_JAR_SERVICE"

  /**
   * The cookie jar that stores all relevant cookie info.
   * The keys correspond to the domain of the cookie.
   * The cookie strings are stored as an array of strings corresponding to the domain
   */
  public cookieJar = ref(new Map<string, Cookie[]>())

  /**
   * SecretManagerService for storing cookie values securely
   */
  private secretManager: SecretManagerService | null = null

  override async onServiceInit() {
    if (APP_IS_IN_DEV_MODE) {
      console.log('[CookieJar] Service initialized')
    }

    // Load SecretManagerService lazily to avoid circular dependencies
    // Note: Using dynamic import to ensure SecretManagerService is registered first
    // MUST await this to ensure SecretManager is loaded before cookies are stored
    await this.loadSecretManager()

    // Clear any existing old plain-text cookies from storage
    // Only load cookies if they have secret references (meaning they were stored securely)
    this.loadCookiesFromStorage()

    // Watch for changes and persist to storage
    watch(
      () => this.cookieJar.value,
      (newJar) => {
        this.saveCookiesToStorage(newJar)
      },
      { deep: true }
    )
  }

  /**
   * Load SecretManagerService instance
   */
  private async loadSecretManager() {
    try {
      // Dynamic import to avoid circular dependency issues
      const { SecretManagerService } = await import("./secret-manager.service")
      this.secretManager = getService(SecretManagerService)
      if (APP_IS_IN_DEV_MODE) {
        console.log('[CookieJar] SecretManagerService loaded')
      }

      // Perform one-time migration of existing plain text cookies
      await this.migrateExistingCookiesToKeychain()
    } catch (error) {
      console.error('[CookieJar] Failed to load SecretManagerService:', error)
    }
  }

  /**
   * ONE-TIME MIGRATION: Migrate existing plain text cookies to keychain
   * This function runs only once per installation, then never again.
   * 
   * After successful migration, this entire function can be safely removed
   * from the codebase in a future release (e.g., 6 months after deployment).
   */
  private async migrateExistingCookiesToKeychain() {
    // Check if migration already completed
    const migrationCompleted = localStorage.getItem(MIGRATION_FLAG_KEY)
    if (migrationCompleted === 'true') {
      if (APP_IS_IN_DEV_MODE) {
        console.log('[CookieJar] Cookie migration already completed, skipping')
      }
      return
    }

    if (!this.secretManager) {
      console.warn('[CookieJar] Cannot migrate cookies: SecretManagerService not available')
      return
    }

    if (APP_IS_IN_DEV_MODE) {
      console.log('[CookieJar] Starting one-time cookie migration to keychain...')
    }

    let migratedCount = 0
    let errorCount = 0

    try {
      // Iterate through all domains and cookies
      for (const [domain, cookies] of this.cookieJar.value.entries()) {
        for (let i = 0; i < cookies.length; i++) {
          const cookie = cookies[i]

          // Skip if already a secret reference
          if (this.secretManager.isSecretReference(cookie.value)) {
            continue
          }

          // Skip if value is empty
          if (!cookie.value) {
            continue
          }

          try {
            // Generate secret key for this cookie
            const secretBaseName = `cookie_${domain}_${cookie.name}`.replace(/[^a-zA-Z0-9_]/g, '_')

            // Store in keychain and get reference
            const secretRef = await this.secretManager.storeAndGetReference(
              secretBaseName,
              cookie.value
            )

            // Update cookie with secret reference
            cookie.value = secretRef
            migratedCount++

            if (APP_IS_IN_DEV_MODE) {
              console.log(`[CookieJar] Migrated cookie: ${domain}/${cookie.name}`)
            }
          } catch (error) {
            console.error(`[CookieJar] Failed to migrate cookie ${domain}/${cookie.name}:`, error)
            errorCount++
            // Continue with next cookie even if this one fails
          }
        }
      }

      // Trigger save to persist the migrated references
      if (migratedCount > 0) {
        // Force update to trigger watch and save
        this.cookieJar.value = new Map(this.cookieJar.value)
      }

      // Mark migration as completed
      localStorage.setItem(MIGRATION_FLAG_KEY, 'true')

      console.log(
        `[CookieJar] Cookie migration completed: ${migratedCount} migrated, ${errorCount} errors`
      )

      if (APP_IS_IN_DEV_MODE && migratedCount > 0) {
        console.log('[CookieJar] All plain text cookie values are now stored securely in OS keychain')
        console.log('[CookieJar] Migration will not run again')
      }
    } catch (error) {
      console.error('[CookieJar] Cookie migration failed:', error)
      // Don't set migration flag if it failed - will retry on next launch
    }
  }

  /* Only loads cookies with secret references (secure storage)
   * Clears any old plain-text cookies
   */
  private loadCookiesFromStorage() {
    try {
      const stored = localStorage.getItem(COOKIE_JAR_STORAGE_KEY)
      if (!stored) {
        if (APP_IS_IN_DEV_MODE) {
          console.log('[CookieJar] No stored cookies found - starting fresh')
        }
        return
      }

      const parsed = JSON.parse(stored)
      const cookieMap = new Map<string, Cookie[]>()
      let hasPlainTextCookies = false
      let secureCookieCount = 0

      // Only load cookies that have secret references (secure storage)
      // Skip any cookies with plain-text values
      for (const [domain, cookies] of parsed) {
        const secureCookies = cookies.filter((cookie: Cookie) => {
          const isSecure = typeof cookie.value === 'string' && cookie.value.startsWith('{{secret:')
          if (!isSecure && cookie.value) {
            hasPlainTextCookies = true
            if (APP_IS_IN_DEV_MODE) {
              console.log(`[CookieJar] Skipping plain-text cookie: ${cookie.name} (domain: ${domain})`)
            }
          }
          return isSecure
        })

        if (secureCookies.length > 0) {
          cookieMap.set(domain, secureCookies)
          secureCookieCount += secureCookies.length
        }
      }

      if (hasPlainTextCookies) {
        console.warn('[CookieJar] Found and ignored old plain-text cookies. Only secure cookies were loaded.')
        // Clear old storage and save only secure cookies
        if (secureCookieCount > 0) {
          this.cookieJar.value = cookieMap
          this.saveCookiesToStorage(cookieMap)
        } else {
          // No secure cookies, clear storage completely
          localStorage.removeItem(COOKIE_JAR_STORAGE_KEY)
          console.log('[CookieJar] Cleared all old plain-text cookies from storage')
        }
      } else if (secureCookieCount > 0) {
        this.cookieJar.value = cookieMap
        if (APP_IS_IN_DEV_MODE) {
          console.log(`[CookieJar] Loaded ${secureCookieCount} secure cookies from storage. Domains: ${cookieMap.size}`)
        }
      }
    } catch (error) {
      console.error('[CookieJar] Error loading cookies from storage:', error)
      // On error, clear the corrupted storage
      localStorage.removeItem(COOKIE_JAR_STORAGE_KEY
    } catch (error) {
      console.error('[CookieJar] Error loading cookies from storage:', error)
    }
  }

  /**
   * Save cookies to localStorage/platform storage
   */
  private saveCookiesToStorage(cookieJar: Map<string, Cookie[]>) {
    try {
      // Convert Map to array for JSON serialization
      const cookieArray = Array.from(cookieJar.entries())
      localStorage.setItem(COOKIE_JAR_STORAGE_KEY, JSON.stringify(cookieArray))
      if (APP_IS_IN_DEV_MODE) {
        console.log('[CookieJar] Saved cookies to storage. Domains:', cookieJar.size)
      }
    } catch (error) {
      console.error('[CookieJar] Error saving cookies to storage:', error)
    }
  }

  public parseSetCookieString(setCookieString: string) {
    return setCookieParse(setCookieString)
  }

  public bulkApplyCookiesToDomain(cookies: Cookie[], domain: string) {
    const existingDomainEntries = this.cookieJar.value.get(domain) ?? []

    // Create new array reference to trigger Vue reactivity
    const newEntries = [...existingDomainEntries, ...cookies]

    // Create new Map to trigger Vue reactivity
    const newJar = new Map(this.cookieJar.value)
    newJar.set(domain, newEntries)
    this.cookieJar.value = newJar
  }

  /**
   * Extract and store cookies from response Set-Cookie headers
   * @param setCookieHeaders Array of Set-Cookie header values
   * @param requestUrl The URL of the request that generated the response
   */
  public async extractCookiesFromResponse(setCookieHeaders: string[], requestUrl: string) {
    if (APP_IS_IN_DEV_MODE) {
      console.log('[CookieJar] extractCookiesFromResponse called', { headersCount: setCookieHeaders.length, requestUrl })
    }

    if (!setCookieHeaders || setCookieHeaders.length === 0) return

    try {
      const url = new URL(requestUrl)
      const defaultDomain = url.hostname
      if (APP_IS_IN_DEV_MODE) {
        console.log('[CookieJar] Processing cookies for domain:', defaultDomain)
      }

      for (let index = 0; index < setCookieHeaders.length; index++) {
        const setCookieHeader = setCookieHeaders[index]
        if (APP_IS_IN_DEV_MODE) {
          console.log(`[CookieJar] Processing cookie ${index + 1}:`, setCookieHeader)
        }
        const parsedCookie = setCookieParse(setCookieHeader)
        if (parsedCookie) {
          const cookieDomain = parsedCookie.domain || defaultDomain
          if (APP_IS_IN_DEV_MODE) {
            console.log('[CookieJar] Parsed cookie:', { name: parsedCookie.name, domain: cookieDomain })
          }
          await this.addCookie(setCookieHeader, cookieDomain)
        } else {
          console.warn('[CookieJar] Failed to parse cookie:', setCookieHeader)
        }
      }
      if (APP_IS_IN_DEV_MODE) {
        console.log('[CookieJar] Cookie extraction completed. Total domains:', this.cookieJar.value.size)
      }
    } catch (error) {
      console.error("Error extracting cookies from response:", error)
    }
  }

  /**
   * Add a single cookie to the jar
   * @param cookieString The full Set-Cookie header value
   * @param domain The domain for the cookie
   */
  public async addCookie(cookieString: string, domain: string) {
    const existingDomainEntries = this.cookieJar.value.get(domain) ?? []
    if (APP_IS_IN_DEV_MODE) {
      console.log('[CookieJar] addCookie - existing entries:', existingDomainEntries.length)
    }

    // Parse the new cookie
    const parsedCookie = setCookieParse(cookieString)
    if (!parsedCookie || !parsedCookie.name) return

    // Determine the cookie value (either store in keychain or use as-is)
    let cookieValue = parsedCookie.value || ""

    // If SecretManagerService is available and cookie has a value, store it securely
    if (this.secretManager && cookieValue) {
      try {
        // Generate a unique secret key for this cookie
        const secretBaseName = `cookie_${domain}_${parsedCookie.name}`.replace(/[^a-zA-Z0-9_]/g, '_')
        
        // Store the cookie value in keychain and get a reference
        cookieValue = await this.secretManager.storeAndGetReference(secretBaseName, cookieValue)
        
        if (APP_IS_IN_DEV_MODE) {
          console.log(`[CookieJar] Stored cookie value in keychain: ${secretBaseName}`)
        }
      } catch (error) {
        console.error('[CookieJar] Failed to store cookie in keychain, using plain value:', error)
        // Fall back to plain value if keychain storage fails
        cookieValue = parsedCookie.value || ""
      }
    }

    // Convert parsed cookie to Cookie type
    const cookieEntry: Cookie = {
      name: parsedCookie.name,
      value: cookieValue, // This is now a secret reference or plain value
      domain: parsedCookie.domain || domain,
      path: parsedCookie.path || "/",
      expires: parsedCookie.expires ? parsedCookie.expires.toISOString() : undefined,
      maxAge: parsedCookie.maxAge,
      httpOnly: parsedCookie.httpOnly ?? false,
      secure: parsedCookie.secure ?? false,
      sameSite: parsedCookie.sameSite === "none" ? "None" : parsedCookie.sameSite === "lax" ? "Lax" : parsedCookie.sameSite === "strict" ? "Strict" : "None",
    }

    if (APP_IS_IN_DEV_MODE) {
      console.log('[CookieJar] addCookie - new cookie:', { 
        name: cookieEntry.name, 
        domain: cookieEntry.domain, 
        path: cookieEntry.path,
        valueIsSecret: this.secretManager?.isSecretReference(cookieValue) ?? false
      })
    }

    // Remove any existing cookie with the same name and path (and clean up its secret if it exists)
    const filteredEntries = existingDomainEntries.filter((existingCookie) => {
      const shouldRemove = existingCookie.name === cookieEntry.name && existingCookie.path === cookieEntry.path
      
      // If removing and the value was a secret reference, delete from keychain
      if (shouldRemove && this.secretManager?.isSecretReference(existingCookie.value)) {
        const secretKey = this.secretManager.extractSecretKey(existingCookie.value)
        if (secretKey) {
          this.secretManager.deleteSecret(secretKey).catch((error) => {
            console.error('[CookieJar] Failed to delete old cookie secret:', error)
          })
        }
      }
      
      return !shouldRemove
    })

    // Add the new cookie and create a new array reference
    const newEntries = [...filteredEntries, cookieEntry]

    if (APP_IS_IN_DEV_MODE) {
      console.log('[CookieJar] addCookie - new entries count:', newEntries.length)
    }

    // Create new Map to trigger Vue reactivity
    const newJar = new Map(this.cookieJar.value)
    newJar.set(domain, newEntries)
    this.cookieJar.value = newJar

    if (APP_IS_IN_DEV_MODE) {
      console.log('[CookieJar] addCookie - jar updated. Total domains:', this.cookieJar.value.size, 'Cookies in domain:', this.cookieJar.value.get(domain)?.length)
    }
  }

  /**
   * Remove a cookie from the jar and clean up its secret if applicable
   * @param name Cookie name
   * @param domain Cookie domain
   * @param path Cookie path (optional)
   */
  public async removeCookie(name: string, domain: string, path?: string) {
    if (APP_IS_IN_DEV_MODE) {
      console.log('[CookieJar] removeCookie called:', { name, domain, path })
    }
    const domainEntries = this.cookieJar.value.get(domain)
    if (!domainEntries) {
      if (APP_IS_IN_DEV_MODE) {
        console.log('[CookieJar] No entries found for domain:', domain)
      }
      return
    }

    if (APP_IS_IN_DEV_MODE) {
      console.log('[CookieJar] Before removal, entries count:', domainEntries.length)
    }

    // Filter returns a new array, so this already creates a new reference
    // Also clean up secrets for removed cookies
    const filteredEntries = domainEntries.filter((cookie) => {
      let shouldRemove = false
      
      if (path) {
        shouldRemove = cookie.name === name && cookie.path === path
      } else {
        shouldRemove = cookie.name === name
      }
      
      // If removing and the value was a secret reference, delete from keychain
      if (shouldRemove && this.secretManager?.isSecretReference(cookie.value)) {
        const secretKey = this.secretManager.extractSecretKey(cookie.value)
        if (secretKey) {
          this.secretManager.deleteSecret(secretKey).catch((error) => {
            console.error('[CookieJar] Failed to delete cookie secret:', error)
          })
        }
      }
      
      return !shouldRemove
    })

    if (APP_IS_IN_DEV_MODE) {
      console.log('[CookieJar] After filtering, entries count:', filteredEntries.length)
    }

    // Create a completely new Map with all entries copied to ensure Vue reactivity
    const newJar = new Map<string, Cookie[]>()

    // Copy all domains except the one we're modifying
    for (const [key, value] of this.cookieJar.value.entries()) {
      if (key === domain) {
        // Only add the domain back if there are remaining cookies
        if (filteredEntries.length > 0) {
          newJar.set(key, filteredEntries)
        }
      } else {
        // Copy other domains as-is (create new array reference for consistency)
        newJar.set(key, [...value])
      }
    }

    // Assign the new Map to trigger Vue reactivity
    this.cookieJar.value = newJar

    if (APP_IS_IN_DEV_MODE) {
      console.log('[CookieJar] After removal, total domains:', this.cookieJar.value.size)
      console.log('[CookieJar] Remaining cookies for domain:', this.cookieJar.value.get(domain)?.length ?? 0)
    }
  }

  /**
   * Clear all cookies for a specific domain and clean up their secrets
   * @param domain Domain to clear cookies for
   */
  public async clearCookiesForDomain(domain: string) {
    if (APP_IS_IN_DEV_MODE) {
      console.log('[CookieJar] clearCookiesForDomain called for:', domain)
      console.trace('[CookieJar] clearCookiesForDomain stack trace')
    }

    // Clean up secrets for this domain's cookies
    if (this.secretManager) {
      const domainCookies = this.cookieJar.value.get(domain)
      if (domainCookies) {
        for (const cookie of domainCookies) {
          if (this.secretManager.isSecretReference(cookie.value)) {
            const secretKey = this.secretManager.extractSecretKey(cookie.value)
            if (secretKey) {
              try {
                await this.secretManager.deleteSecret(secretKey)
              } catch (error) {
                console.error('[CookieJar] Failed to delete cookie secret:', error)
              }
            }
          }
        }
      }
    }

    // Create new Map to trigger Vue reactivity
    const newJar = new Map(this.cookieJar.value)
    newJar.delete(domain)
    this.cookieJar.value = newJar
    if (APP_IS_IN_DEV_MODE) {
      console.log('[CookieJar] After clear, jar size:', this.cookieJar.value.size)
    }
  }

  /**
   * Clear all cookies and clean up all secrets
   */
  public async clearAllCookies() {
    if (APP_IS_IN_DEV_MODE) {
      console.log('[CookieJar] clearAllCookies called')
      console.trace('[CookieJar] clearAllCookies stack trace')
    }

    // Clean up all cookie secrets before clearing
    if (this.secretManager) {
      for (const [_domain, cookies] of this.cookieJar.value.entries()) {
        for (const cookie of cookies) {
          if (this.secretManager.isSecretReference(cookie.value)) {
            const secretKey = this.secretManager.extractSecretKey(cookie.value)
            if (secretKey) {
              try {
                await this.secretManager.deleteSecret(secretKey)
              } catch (error) {
                console.error('[CookieJar] Failed to delete cookie secret during clearAll:', error)
              }
            }
          }
        }
      }
    }

    // Create new Map to trigger Vue reactivity
    this.cookieJar.value = new Map()
    if (APP_IS_IN_DEV_MODE) {
      console.log('[CookieJar] After clearAll, jar size:', this.cookieJar.value.size)
    }
  }

  /**
   * Get cookies applicable for a given URL, with secret values resolved
   * @param url The URL to get cookies for
   * @returns Array of cookies with resolved values (not secret references)
   */
  public async getCookiesForURL(url: URL | string): Promise<Cookie[]> {
    let urlObj: URL

    try {
      urlObj = typeof url === 'string' ? new URL(url) : url
    } catch {
      // If URL parsing fails, return empty array
      return []
    }

    const relevantDomains = Array.from(this.cookieJar.value.keys()).filter(
      (domain) => {
        // Normalize domain by removing leading dot if present
        const normalized = domain.startsWith(".") ? domain.slice(1) : domain
        // Match if hostname equals normalized domain, or hostname is a subdomain with dot boundary
        return urlObj.hostname === normalized || urlObj.hostname.endsWith(`.${normalized}`)
      }
    )

    const cookies = relevantDomains
      .flatMap((domain) => {
        // Assemble the list of cookie entries from all the relevant domains

        const cookieEntries = this.cookieJar.value.get(domain)! // We know not nullable from how we filter above

        return cookieEntries.map((cookie) => ({
          ...cookie,
          // Parse expires if it's a string to check expiration
          expires: cookie.expires ? new Date(cookie.expires) : undefined,
        }))
      })
      .filter((cookie) => {
        // Perform the required checks on the cookies

        const passesPathCheck = urlObj.pathname.startsWith(cookie.path ?? "/")

        const passesExpiresCheck = !cookie.expires
          ? true
          : cookie.expires.getTime() >= new Date().getTime()

        const passesSecureCheck = !cookie.secure
          ? true
          : urlObj.protocol === "https:"

        return passesPathCheck && passesExpiresCheck && passesSecureCheck
      })

    // Resolve secret references to actual values and convert expires back to string
    if (this.secretManager) {
      const resolvedCookies = await Promise.all(
        cookies.map(async (cookie) => {
          let resolvedValue = cookie.value
          if (this.secretManager?.isSecretReference(cookie.value)) {
            try {
              resolvedValue = await this.secretManager.resolveSecretReference(cookie.value)
            } catch (error) {
              console.error(`[CookieJar] Failed to resolve secret for cookie ${cookie.name}:`, error)
              // Keep reference value if resolution fails
            }
          }
          // Convert expires Date back to ISO string for return type
          return {
            ...cookie,
            value: resolvedValue,
            expires: cookie.expires ? cookie.expires.toISOString() : undefined,
          }
        })
      )
      return resolvedCookies
    }

    // If no SecretManagerService, return cookies with expires converted to string
    return cookies.map(cookie => ({
      ...cookie,
      expires: cookie.expires ? cookie.expires.toISOString() : undefined,
    }))
  }
}
