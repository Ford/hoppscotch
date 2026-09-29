import { describe, expect, it } from "vitest"
import { getDefaultSettings, performSettingsDataMigrations } from "../settings"

describe("experimental feature defaults", () => {
  it("starts documentation and unified GraphQL requests disabled", () => {
    const defaults = getDefaultSettings()

    expect(defaults.ENABLE_EXPERIMENTAL_DOCUMENTATION).toBe(false)
    expect(defaults.ENABLE_GQL_IN_REST_WORKSPACE).toBe(false)
  })

  it("preserves saved choices when migrating settings", () => {
    const migrated = performSettingsDataMigrations({
      ENABLE_EXPERIMENTAL_DOCUMENTATION: true,
      ENABLE_GQL_IN_REST_WORKSPACE: true,
    })

    expect(migrated.ENABLE_EXPERIMENTAL_DOCUMENTATION).toBe(true)
    expect(migrated.ENABLE_GQL_IN_REST_WORKSPACE).toBe(true)
  })
})
