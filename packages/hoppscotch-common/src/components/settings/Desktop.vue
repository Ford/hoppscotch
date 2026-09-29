<template>
  <!-- Three-column grid identical to the shared settings page's other
       sections (General / Theme / Kernel interceptor), so this section
       aligns with them and declares no column widths of its own. -->
  <div class="md:grid md:grid-cols-3 md:gap-4">
    <div class="p-8 md:col-span-1">
      <h3 class="heading">
        {{ t("settings.desktop") }}
      </h3>
      <p class="my-1 text-secondaryLight">
        {{ t("settings.desktop_description") }}
      </p>
    </div>
    <div class="space-y-8 p-8 md:col-span-2">
      <!-- The stored value is a total request deadline, and the bundle
           download client multiplies it by ten. The description states both
           numbers because a user reading only the preset would expect a
           120s pick to abort a download at two minutes. Rust reads the
           value once at startup, so the description also states the restart
           requirement. FE-1188 replaces the single deadline with separate
           connect, read, and total bounds. -->
      <section>
        <h4 class="font-semibold text-secondaryDark">
          {{ t("settings.desktop_connection") }}
        </h4>

        <div class="mt-4">
          <label class="text-secondaryLight">{{
            t("settings.connection_timeout")
          }}</label>
          <div class="mt-3 w-[15rem]">
            <tippy
              interactive
              trigger="click"
              theme="popover"
              :on-shown="() => timeoutTippyActions?.focus()"
            >
              <HoppSmartSelectWrapper>
                <HoppButtonSecondary
                  class="!min-w-[15rem] !justify-start pr-8"
                  :label="selectedTimeoutLabel"
                  outline
                />
              </HoppSmartSelectWrapper>
              <template #content="{ hide }">
                <div
                  ref="timeoutTippyActions"
                  class="flex flex-col focus:outline-none"
                  tabindex="0"
                  @keyup.escape="hide()"
                >
                  <HoppSmartItem
                    v-for="option in connectionTimeoutOptions"
                    :key="`timeout-${option.ms}`"
                    :label="option.label"
                    :info-icon="option.selected ? IconLucideCheck : null"
                    :active-info-icon="option.selected"
                    @click="() => selectConnectionTimeout(option.ms, hide)"
                  />
                </div>
              </template>
            </tippy>
          </div>
          <p class="mt-3 text-xs text-secondaryLight">
            {{ t("settings.connection_timeout_description") }}
          </p>
        </div>
      </section>

      <!-- Each radio has a one-line description so the user can pick
           without trial and error. Selection writes to
           `keyboardLayoutStrategy` through the desktop settings composable,
           which mirrors it into the keyboard-strategy holder so the next
           keypress respects the change. -->
      <section>
        <h4 class="font-semibold text-secondaryDark">
          {{ t("settings.desktop_keyboard") }}
        </h4>

        <div class="mt-4">
          <p class="text-secondaryLight">
            {{ t("settings.desktop_keyboard_strategy_label") }}
          </p>
          <p class="mt-1 text-xs text-secondaryLight">
            {{ t("settings.desktop_keyboard_strategy_description") }}
          </p>

          <div class="mt-4 space-y-4">
            <div v-for="option in keyboardStrategyOptions" :key="option.value">
              <HoppSmartRadio
                :value="option.value"
                :label="option.label"
                :selected="
                  desktopSettings.settings.keyboardLayoutStrategy ===
                  option.value
                "
                class="!px-0 hover:bg-transparent"
                @change="setKeyboardStrategy(option.value)"
              />
              <p class="ml-8 mt-1 text-xs text-secondaryLight">
                {{ option.description }}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section>
        <h4 class="font-semibold text-secondaryDark">
          {{ t("settings.desktop_display") }}
        </h4>

        <!-- The steps start at 100% because the AppHeader's macOS
             traffic-light clearance is hardcoded for an unscaled header, so
             anything below 100% overlaps the traffic lights (see
             FE-1261). -->
        <div class="mt-4">
          <label class="text-secondaryLight">{{
            t("settings.zoom_level")
          }}</label>
          <div class="mt-3">
            <HoppSmartRadioGroup
              :radios="zoomPresets"
              :model-value="selectedZoomPreset"
              class="!flex-row"
              @update:model-value="setZoomPreset"
            />
          </div>
          <p class="mt-3 text-xs text-secondaryLight">
            {{ t("settings.zoom_level_description") }}
          </p>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue"
import {
  HoppButtonSecondary,
  HoppSmartItem,
  HoppSmartRadio,
  HoppSmartRadioGroup,
  HoppSmartSelectWrapper,
} from "@hoppscotch/ui"
import { useI18n } from "~/composables/i18n"
import {
  DESKTOP_SETTINGS_SCHEMA,
  type DesktopSettings,
} from "~/platform/desktop-settings"

import IconLucideCheck from "~icons/lucide/check"

import { useDesktopSettings } from "~/composables/desktop-settings"

// The shared settings page iterates `additionalSettingsSections`
// with `:key="item.id"`. Without an explicit `id` on the component
// options, Vue would use `undefined` as the key, which causes
// keyed-list warnings at runtime and means the renderer loses its
// cross-update identity for this node (so a re-registration by any
// consumer would force a full remount instead of a reconcile).
// Registering a stable `id` closes that.
defineOptions({
  name: "DesktopSettingsSection",
  id: "desktop-settings",
})

const t = useI18n()

const desktopSettings = useDesktopSettings()

// Milliseconds because the schema field, the Rust bridge, and the TS race
// all read that unit, so nothing converts at a boundary. Array order is the
// order the popup renders.
const CONNECTION_TIMEOUT_PRESETS_MS = [30_000, 60_000, 90_000, 120_000]

// Reading the default off the schema keeps the "(default)" marker
// correct when `connectionTimeoutMs`'s default changes. A repeated
// 30_000 here would leave the marker on the old preset.
const DEFAULT_CONNECTION_TIMEOUT_MS = DESKTOP_SETTINGS_SCHEMA.parse(
  {}
).connectionTimeoutMs

// Labels derive from the stored value, so a store holding something
// off-preset (hand edited, or written by a schema that widens the range)
// shows the timeout actually in effect.
const timeoutLabel = (ms: number): string => {
  const seconds = Math.round(ms / 1000)
  return ms === DEFAULT_CONNECTION_TIMEOUT_MS
    ? t("settings.connection_timeout_seconds_default", { seconds })
    : t("settings.connection_timeout_seconds", { seconds })
}

const connectionTimeoutOptions = computed(() =>
  CONNECTION_TIMEOUT_PRESETS_MS.map((ms) => ({
    ms,
    label: timeoutLabel(ms),
    selected: desktopSettings.settings.connectionTimeoutMs === ms,
  }))
)

const selectedTimeoutLabel = computed(() =>
  timeoutLabel(desktopSettings.settings.connectionTimeoutMs)
)

// Tippy focuses this element on open so Escape closes the popup, the same
// wiring `smart/ChangeLanguage.vue` uses.
const timeoutTippyActions = ref<HTMLElement | null>(null)

// The popup item calls this from a click handler that discards the returned
// promise, so a rejection would escape as an unhandled rejection Vue cannot
// route to its error handler. `update()` already logs the failure and rolls
// the reactive value back, so the catch here only stops the rethrow from
// leaving the handler. `close` runs in `finally` so the popup shuts whether
// the write succeeds or fails.
async function selectConnectionTimeout(
  ms: number,
  close: () => void
): Promise<void> {
  try {
    await desktopSettings.update("connectionTimeoutMs", ms)
  } catch {
    // handled in the composable
  } finally {
    close()
  }
}

// Order is recommended-first so users without a preference get the smart
// default. Labels and descriptions are i18n keys, rebuilt as a `computed`
// so a locale change updates the rendered text.
type KeyboardStrategy = DesktopSettings["keyboardLayoutStrategy"]

const keyboardStrategyOptions = computed<
  Array<{ value: KeyboardStrategy; label: string; description: string }>
>(() => [
  {
    value: "hybrid",
    label: t("settings.desktop_keyboard_strategy_hybrid"),
    description: t("settings.desktop_keyboard_strategy_hybrid_description"),
  },
  {
    value: "key",
    label: t("settings.desktop_keyboard_strategy_key"),
    description: t("settings.desktop_keyboard_strategy_key_description"),
  },
  {
    value: "code",
    label: t("settings.desktop_keyboard_strategy_code"),
    description: t("settings.desktop_keyboard_strategy_code_description"),
  },
])

async function setKeyboardStrategy(value: KeyboardStrategy): Promise<void> {
  await desktopSettings.update("keyboardLayoutStrategy", value)
}

// `value` is the string id the radio group emits, kept distinct from the
// stored float so the radio's `model-value` comparison never trips on float
// equality. The float-to-string mapping stays in `zoomPresets` alone and
// `setZoomPreset()` inverts it when the user picks an option.
const zoomPresets = computed(() => [
  { value: "1.0", label: t("settings.zoom_level_100") },
  { value: "1.1", label: t("settings.zoom_level_110") },
  { value: "1.25", label: t("settings.zoom_level_125") },
  { value: "1.5", label: t("settings.zoom_level_150") },
])

// Maps the persisted float back to a radio id. Falls through to "1.0"
// for any value not in the preset set (a future schema migration could
// introduce values outside the shipped range, and the control reads as
// 100% rather than as no-selection in that case).
const selectedZoomPreset = computed(() => {
  const stored = desktopSettings.settings.zoomLevel
  const match = zoomPresets.value.find(
    (preset) => parseFloat(preset.value) === stored
  )
  return match?.value ?? "1.0"
})

async function setZoomPreset(value: string): Promise<void> {
  const factor = parseFloat(value)
  if (Number.isNaN(factor)) return
  await desktopSettings.update("zoomLevel", factor)
}
</script>
