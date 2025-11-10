import { Service } from "dioc"
import { ref } from "vue"
import { parseString as setCookieParse } from "set-cookie-parser-es"

export type CookieDef = {
  name: string
  value: string
  domain: string
  path: string
  expires: string
}

export class CookieJarService extends Service {
  public static readonly ID = "COOKIE_JAR_SERVICE"

  /**
   * The cookie jar that stores all relevant cookie info.
   * The keys correspond to the domain of the cookie.
   * The cookie strings are stored as an array of strings corresponding to the domain
   */
  public cookieJar = ref(new Map<string, string[]>())

  public parseSetCookieString(setCookieString: string) {
    return setCookieParse(setCookieString)
  }

  public bulkApplyCookiesToDomain(cookies: string[], domain: string) {
    const existingDomainEntries = this.cookieJar.value.get(domain) ?? []
    existingDomainEntries.push(...cookies)

    this.cookieJar.value.set(domain, existingDomainEntries)
  }

  /**
   * Extract and store cookies from response Set-Cookie headers
   * @param setCookieHeaders Array of Set-Cookie header values
   * @param requestUrl The URL of the request that generated the response
   */
  public extractCookiesFromResponse(setCookieHeaders: string[], requestUrl: string) {
    if (!setCookieHeaders || setCookieHeaders.length === 0) return

    try {
      const url = new URL(requestUrl)
      const defaultDomain = url.hostname

      setCookieHeaders.forEach((setCookieHeader) => {
        const parsedCookie = setCookieParse(setCookieHeader)
        if (parsedCookie) {
          const cookieDomain = parsedCookie.domain || defaultDomain
          this.addCookie(setCookieHeader, cookieDomain)
        }
      })
    } catch (error) {
      console.error("Error extracting cookies from response:", error)
    }
  }

  /**
   * Add a single cookie to the jar
   * @param cookieString The full Set-Cookie header value
   * @param domain The domain for the cookie
   */
  public addCookie(cookieString: string, domain: string) {
    const existingDomainEntries = this.cookieJar.value.get(domain) ?? []

    // Parse the new cookie to check for duplicates
    const newCookie = setCookieParse(cookieString)
    if (!newCookie) return

    // Remove any existing cookie with the same name and path
    const filteredEntries = existingDomainEntries.filter((existingCookieString) => {
      const existingCookie = setCookieParse(existingCookieString)
      return !(existingCookie?.name === newCookie.name && existingCookie?.path === newCookie.path)
    })

    // Add the new cookie
    filteredEntries.push(cookieString)
    this.cookieJar.value.set(domain, filteredEntries)
  }

  /**
   * Remove a cookie from the jar
   * @param name Cookie name
   * @param domain Cookie domain
   * @param path Cookie path (optional)
   */
  public removeCookie(name: string, domain: string, path?: string) {
    const domainEntries = this.cookieJar.value.get(domain)
    if (!domainEntries) return

    const filteredEntries = domainEntries.filter((cookieString) => {
      const cookie = setCookieParse(cookieString)
      if (!cookie) return true

      if (path) {
        return !(cookie.name === name && cookie.path === path)
      }
      return cookie.name !== name
    })

    this.cookieJar.value.set(domain, filteredEntries)
  }

  /**
   * Clear all cookies for a specific domain
   * @param domain Domain to clear cookies for
   */
  public clearCookiesForDomain(domain: string) {
    this.cookieJar.value.delete(domain)
  }

  /**
   * Clear all cookies
   */
  public clearAllCookies() {
    this.cookieJar.value.clear()
  }

  /**
   * Get cookies for a URL (overloaded to handle both string and URL)
   * @param url URL string or URL object
   */
  public getCookiesForURL(url: string | URL) {
    let urlObj: URL

    try {
      urlObj = typeof url === 'string' ? new URL(url) : url
    } catch {
      // If URL parsing fails, return empty array
      return []
    }

    const relevantDomains = Array.from(this.cookieJar.value.keys()).filter(
      (domain) => urlObj.hostname.endsWith(domain)
    )

    return relevantDomains
      .flatMap((domain) => {
        // Assemble the list of cookie entries from all the relevant domains

        const cookieStrings = this.cookieJar.value.get(domain)! // We know not nullable from how we filter above

        return cookieStrings.map((cookieString) => {
          const cookie = this.parseSetCookieString(cookieString)
          return {
            ...cookie,
            domain, // Ensure domain is set for display purposes
          }
        })
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
  }
}
