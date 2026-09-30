import { TestContainer } from "dioc/testing"
import { describe, expect, it, vi } from "vitest"
import { Store } from "~/kernel/store"
import { KernelInterceptorNativeStore } from "../store"

vi.mock("~/kernel/store", () => ({
  Store: {
    init: vi.fn().mockResolvedValue({ _tag: "Right", right: undefined }),
    get: vi.fn().mockResolvedValue({ _tag: "Right", right: null }),
    set: vi.fn().mockResolvedValue({ _tag: "Right", right: undefined }),
    watch: vi.fn().mockResolvedValue({ on: vi.fn() }),
  },
}))

describe("native interceptor proxy bypass", () => {
  it("skips the proxy for matching hosts without changing saved settings", async () => {
    const store = new TestContainer().bind(KernelInterceptorNativeStore)
    await store.onServiceInit()
    await store.saveDomainSettings("*", {
      proxy: {
        url: "http://proxy.example:8080",
        no_proxy: " localhost, .example.com, ",
      },
    })

    const request = (url: string) =>
      store.completeRequest({
        id: 1,
        url,
        method: "GET",
        version: "HTTP/1.1",
      })

    expect((await request("http://localhost:3000")).proxy).toBeUndefined()
    expect((await request("https://EXAMPLE.com")).proxy).toBeUndefined()
    expect(
      (await request("https://api.example.com:8443")).proxy
    ).toBeUndefined()
    expect((await request("https://notexample.com")).proxy?.url).toBe(
      "http://proxy.example:8080"
    )
    expect((await request("https://example.com.evil.test")).proxy?.url).toBe(
      "http://proxy.example:8080"
    )
    expect(store.getDomainSettings("*").proxy?.url).toBe(
      "http://proxy.example:8080"
    )
    expect(store.getDomainSettings("*").proxy?.no_proxy).toBe(
      " localhost, .example.com, "
    )
    expect((await request("https://other.test")).proxy?.url).toBe(
      "http://proxy.example:8080"
    )
    expect(Store.set).toHaveBeenCalledWith(
      "interceptors.native.v1",
      "settings",
      expect.objectContaining({
        domains: expect.objectContaining({
          "*": expect.objectContaining({
            proxy: {
              url: "http://proxy.example:8080",
              no_proxy: " localhost, .example.com, ",
            },
          }),
        }),
      })
    )
  })

  it("allows a domain override to replace the global bypass list", async () => {
    const store = new TestContainer().bind(KernelInterceptorNativeStore)
    await store.onServiceInit()
    await store.saveDomainSettings("*", {
      proxy: { url: "http://proxy.example:8080", no_proxy: "api.example.com" },
    })
    await store.saveDomainSettings("api.example.com", {
      proxy: { url: "http://proxy.example:8080", no_proxy: "other.test" },
    })

    expect(
      (
        await store.completeRequest({
          id: 1,
          url: "https://api.example.com",
          method: "GET",
          version: "HTTP/1.1",
        })
      ).proxy?.url
    ).toBe("http://proxy.example:8080")
  })

  it("uses a proxy if the bypass list is empty", async () => {
    const store = new TestContainer().bind(KernelInterceptorNativeStore)
    await store.onServiceInit()
    await store.saveDomainSettings("*", {
      proxy: { url: "http://proxy.example:8080" },
    })

    const request = () =>
      store.completeRequest({
        id: 1,
        url: "https://example.com",
        method: "GET",
        version: "HTTP/1.1",
      })

    expect((await request()).proxy?.url).toBe("http://proxy.example:8080")
    await store.saveDomainSettings("*", {
      proxy: { url: "http://proxy.example:8080", no_proxy: " , . , " },
    })
    expect((await request()).proxy?.url).toBe("http://proxy.example:8080")
  })
})
