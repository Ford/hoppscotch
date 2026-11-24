<template>
  <HoppSmartModal
    v-if="details"
    dialog
    styles="sm:max-w-3xl"
    :title="t('authorization.oauth.token_details_title')"
    @close="hideOAuthTokenDetails"
  >
    <template #body>
      <div class="flex flex-col">
        <div
          class="flex items-center justify-between border-b border-divider pb-4"
        >
          <span class="font-semibold text-secondaryDark">
            {{ t("authorization.oauth.token_details") }}
          </span>
          <HoppButtonPrimary
            :label="t('authorization.oauth.use_token')"
            @click="hideOAuthTokenDetails"
          />
        </div>

        <div class="max-h-[60vh] overflow-y-auto">
          <div
            v-for="row in rows"
            :key="row.key"
            class="group grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-4 border-b border-dividerLight py-2"
          >
            <span class="break-words text-secondaryLight">{{ row.label }}</span>
            <div class="flex items-start gap-2">
              <span
                class="flex-1 select-text whitespace-pre-wrap break-all text-secondaryDark"
              >
                {{
                  row.masked && !revealed[row.key]
                    ? "•".repeat(Math.min(row.value.length, 24))
                    : row.value
                }}
              </span>
              <div v-if="row.value" class="flex shrink-0 items-center">
                <HoppButtonSecondary
                  v-if="row.masked"
                  v-tippy="{ theme: 'tooltip' }"
                  :title="
                    revealed[row.key] ? t('hide.password') : t('show.password')
                  "
                  :icon="revealed[row.key] ? IconEyeOff : IconEye"
                  class="!p-1"
                  @click="revealed[row.key] = !revealed[row.key]"
                />
                <HoppButtonSecondary
                  v-tippy="{ theme: 'tooltip' }"
                  :title="t('action.copy')"
                  :icon="IconCopy"
                  class="!p-1"
                  @click="copyValue(row.value)"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </HoppSmartModal>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from "vue"
import { useI18n } from "~/composables/i18n"
import { useToast } from "~/composables/toast"
import { copyToClipboard } from "~/helpers/utils/clipboard"
import {
  hideOAuthTokenDetails,
  latestOAuthTokenDetails,
} from "~/services/oauth/token-details"
import IconCopy from "~icons/lucide/copy"
import IconEye from "~icons/lucide/eye"
import IconEyeOff from "~icons/lucide/eye-off"

type Row = {
  key: string
  label: string
  value: string
  masked: boolean
}

const t = useI18n()
const toast = useToast()

const details = latestOAuthTokenDetails

const MASKED_KEYS = ["client_secret", "password"]

const revealed = reactive<Record<string, boolean>>({})

watch(details, () => {
  Object.keys(revealed).forEach((key) => delete revealed[key])
})

const stringifyValue = (value: unknown) => {
  if (value === undefined || value === null) return ""
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

const rows = computed<Row[]>(() => {
  if (!details.value) return []

  const { response, request, timestamp } = details.value

  const row = (key: string, value: unknown, label = key): Row => ({
    key,
    label,
    value: stringifyValue(value),
    masked: MASKED_KEYS.includes(key),
  })

  const otherResponseRows = Object.entries(response)
    .filter(([key]) => key !== "access_token" && key !== "token_type")
    .map(([key, value]) => row(`response.${key}`, value, key))

  return [
    row(
      "access_token",
      response.access_token,
      t("authorization.oauth.label_access_token")
    ),
    row(
      "token_type",
      response.token_type,
      t("authorization.oauth.label_token_type")
    ),
    ...otherResponseRows,
    ...Object.entries(request).map(([key, value]) => row(key, value)),
    row("timestamp", timestamp),
  ]
})

const copyValue = (value: string) => {
  copyToClipboard(value)
  toast.success(t("state.copied_to_clipboard"))
}
</script>
