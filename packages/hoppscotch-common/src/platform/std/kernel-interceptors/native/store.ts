import { Service } from "dioc"
import type { RelayRequest } from "@hoppscotch/kernel"
import { Store } from "~/kernel/store"
import * as E from "fp-ts/Either"
import {
  InputDomainSetting,
  convertDomainSetting,
} from "~/helpers/functional/domain-settings"
import {
  ClientCertEntry,
  findMatchingCert,
  certEntryToInputClient,
} from "~/helpers/functional/cert-registry"
import { decryptPassphrase } from "~/helpers/functional/cert-crypto"

const STORE_NAMESPACE = "interceptors.native.v1"

const STORE_KEYS = {
  SETTINGS: "settings",
} as const

interface StoredData {
  version: string
  domains: Record<string, InputDomainSetting>
  /** Multi-certificate registry — each entry maps a hostname pattern to one cert */
  clientCerts: ClientCertEntry[]
  lastUpdated: string
}

const defaultDomainConfig: InputDomainSetting = {
  version: "v1",
  security: {
    verifyHost: true,
    verifyPeer: true,
  },
  proxy: undefined,
  options: {
    followRedirects: true,
  },
}

export class KernelInterceptorNativeStore extends Service {
  public static readonly ID = "KERNEL_NATIVE_INTERCEPTOR_STORE"
  private static readonly GLOBAL_DOMAIN = "*"
  private static readonly DEFAULT_GLOBAL_SETTINGS: InputDomainSetting = {
    ...defaultDomainConfig,
    version: "v1",
  }

  private domainSettings = new Map<string, InputDomainSetting>()

  /** In-memory multi-certificate registry */
  private clientCertsRegistry: ClientCertEntry[] = []

  async onServiceInit(): Promise<void> {
    const initResult = await Store.init()
    if (E.isLeft(initResult)) {
      console.error(
        "[NativeStore] Failed to initialize store:",
        initResult.left
      )
      return
    }

    await this.loadStore()
    this.setupWatchers()
  }

  private async loadStore(): Promise<void> {
    const loadResult = await Store.get<StoredData>(
      STORE_NAMESPACE,
      STORE_KEYS.SETTINGS
    )

    if (E.isRight(loadResult) && loadResult.right) {
      const storedData = loadResult.right
      this.domainSettings = new Map(Object.entries(storedData.domains))
      this.clientCertsRegistry = storedData.clientCerts ?? []
    }

    if (!this.domainSettings.has(KernelInterceptorNativeStore.GLOBAL_DOMAIN)) {
      this.domainSettings.set(
        KernelInterceptorNativeStore.GLOBAL_DOMAIN,
        KernelInterceptorNativeStore.DEFAULT_GLOBAL_SETTINGS
      )
      await this.persistStore()
    }
  }

  private async setupWatchers() {
    const watcher = await Store.watch(STORE_NAMESPACE, STORE_KEYS.SETTINGS)
    watcher.on("change", async ({ value }: { value: unknown }) => {
      if (value) {
        const store = value as StoredData
        this.domainSettings = new Map(Object.entries(store.domains))
        this.clientCertsRegistry = store.clientCerts ?? []
      }
    })
  }

  private async persistStore(): Promise<void> {
    const store: StoredData = {
      version: "v1",
      domains: Object.fromEntries(this.domainSettings),
      clientCerts: this.clientCertsRegistry,
      lastUpdated: new Date().toISOString(),
    }

    const saveResult = await Store.set(
      STORE_NAMESPACE,
      STORE_KEYS.SETTINGS,
      store
    )
    if (E.isLeft(saveResult)) {
      console.error("[AgentStore] Failed to save store:", saveResult.left)
    }
  }

  private mergeSecurity(
    ...settings: (Required<InputDomainSetting>["security"] | undefined)[]
  ): Required<InputDomainSetting>["security"] | undefined {
    return settings.reduce(
      (acc, setting) => (setting ? { ...acc, ...setting } : acc),
      undefined as Required<RelayRequest>["security"] | undefined
    )
  }

  private mergeProxy(
    ...settings: (Required<InputDomainSetting>["proxy"] | undefined)[]
  ): Required<InputDomainSetting>["proxy"] | undefined {
    return settings.reduce(
      (acc, setting) => (setting ? { ...acc, ...setting } : acc),
      undefined as Required<InputDomainSetting>["proxy"] | undefined
    )
  }

  private mergeOptions(
    ...settings: (Required<InputDomainSetting>["options"] | undefined)[]
  ): Required<InputDomainSetting>["options"] | undefined {
    return settings.reduce(
      (acc, setting) => (setting ? { ...acc, ...setting } : acc),
      undefined as Required<InputDomainSetting>["options"] | undefined
    )
  }

  private getMergedSettings(domain: string): InputDomainSetting {
    const domainSettings = this.domainSettings.get(domain)
    const globalSettings =
      domain !== KernelInterceptorNativeStore.GLOBAL_DOMAIN
        ? this.domainSettings.get(KernelInterceptorNativeStore.GLOBAL_DOMAIN)
        : undefined

    const result = {
      security: this.mergeSecurity(
        globalSettings?.security,
        domainSettings?.security
      ),
      proxy: this.mergeProxy(globalSettings?.proxy, domainSettings?.proxy),
      options: this.mergeOptions(
        globalSettings?.options,
        domainSettings?.options
      ),
    }

    return { version: "v1", ...result }
  }

  public async completeRequest(
    request: Omit<RelayRequest, "proxy" | "security" | "meta">
  ): Promise<RelayRequest> {
    const host = new URL(request.url).host
    const settings = this.getMergedSettings(host)

    // --- Multi-cert registry lookup (longest-match hostname wins) ---
    const matchingCert = findMatchingCert(host, this.clientCertsRegistry)
    if (matchingCert) {
      const certFile =
        matchingCert.kind === "pem"
          ? matchingCert.cert?.name ?? "unknown"
          : matchingCert.data?.name ?? "unknown"
      console.debug(
        `[CertManager/Native] 🔐 "${host}" → matched cert for pattern "${matchingCert.hostname}" (${matchingCert.kind.toUpperCase()}: ${certFile})`
      )
      const decryptedPassphrase =
        matchingCert.kind === "pfx" && matchingCert.passphrase
          ? await decryptPassphrase(matchingCert.passphrase)
          : ""
      const clientCert = certEntryToInputClient(matchingCert, decryptedPassphrase)
      if (clientCert) {
        settings.security = settings.security ?? {}
        settings.security.certificates = settings.security.certificates ?? {}
        settings.security.certificates.client = clientCert
      }
    } else {
      console.debug(
        `[CertManager/Native] ℹ️ "${host}" → no matching client certificate`
      )
    }
    // ----------------------------------------------------------------

    this.bypassProxyForDomains(host, settings.proxy?.no_proxy, settings)
    const effective = convertDomainSetting(settings)

    if (E.isLeft(effective)) {
      throw effective.left
    }

    // Preserve the original request options (including followRedirects)
    return {
      ...request,
      ...effective.right,
      options: (request as any).options,
    }
  }

  private bypassProxyForDomains(
    host: string,
    domainsString: string | null | undefined,
    settings: InputDomainSetting
  ): void {
    if (!domainsString || !settings.proxy) {
      return
    }

    const domainsToBypass: string[] = domainsString
      .split(",")
      .map((domain) => domain.trim())

    const shouldBypass = domainsToBypass.some((domain) =>
      host.toLowerCase().endsWith(domain.toLowerCase())
    )

    if (shouldBypass && settings.proxy) {
      // Set url to empty string to disable proxy for this domain
      settings.proxy.url = ""
    }
  }

  // ---------------------------------------------------------------------------
  // Client Certificate Registry — public CRUD API
  // ---------------------------------------------------------------------------

  public getClientCerts(): ClientCertEntry[] {
    return [...this.clientCertsRegistry]
  }

  public async addClientCert(entry: ClientCertEntry): Promise<void> {
    this.clientCertsRegistry = [...this.clientCertsRegistry, entry]
    await this.persistStore()
  }

  public async updateClientCert(
    id: string,
    updated: ClientCertEntry
  ): Promise<void> {
    this.clientCertsRegistry = this.clientCertsRegistry.map((e) =>
      e.id === id ? updated : e
    )
    await this.persistStore()
  }

  public async deleteClientCert(id: string): Promise<void> {
    this.clientCertsRegistry = this.clientCertsRegistry.filter(
      (e) => e.id !== id
    )
    await this.persistStore()
  }

  // ---------------------------------------------------------------------------
  // Domain Settings
  // ---------------------------------------------------------------------------

  public getDomainSettings(domain: string): InputDomainSetting {
    return (
      this.domainSettings.get(domain) ?? {
        ...defaultDomainConfig,
        version: "v1",
      }
    )
  }

  public async saveDomainSettings(
    domain: string,
    settings: Partial<InputDomainSetting>
  ): Promise<void> {
    const updatedSettings: InputDomainSetting = {
      ...settings,
      version: "v1",
    }

    this.domainSettings.set(domain, updatedSettings)
    await this.persistStore()
  }

  public async clearDomainSettings(domain: string): Promise<void> {
    this.domainSettings.delete(domain)
    await this.persistStore()
  }

  public getDomains(): string[] {
    return Array.from(this.domainSettings.keys())
  }

  public getAllDomainSettings(): Map<string, InputDomainSetting> {
    return new Map(this.domainSettings)
  }
}
