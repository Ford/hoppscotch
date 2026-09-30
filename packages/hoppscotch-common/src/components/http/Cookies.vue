<template>
  <div class="flex flex-col">
    <div
      class="flex items-center justify-between border-b border-dividerLight px-4"
    >
      <span class="truncate font-semibold text-secondaryLight">
        {{ t("app.cookies") }}
      </span>
      <HoppButtonSecondary
        v-if="cookies.length > 0"
        v-tippy="{ theme: 'tooltip' }"
        :title="t('action.clear_all')"
        :icon="IconTrash2"
        @click="clearCookies"
      />
    </div>
    <div v-if="!requestURL" class="p-4 text-secondaryLight">
      {{ t("cookies.modal.enter_request_url") }}
    </div>
    <div v-else-if="cookies.length === 0" class="p-4 text-secondaryLight">
      {{ t("cookies.modal.no_cookies_in_domain") }}
    </div>
    <div v-else class="divide-y divide-dividerLight">
      <div
        v-for="cookie in cookies"
        :key="`${cookie.domain}:${cookie.path}:${cookie.name}`"
        class="flex items-center justify-between gap-4 px-4 py-2"
      >
        <div class="min-w-0 flex-1">
          <div class="truncate font-semibold text-secondaryDark">
            {{ cookie.name }}
          </div>
          <div class="truncate font-mono text-secondary">
            {{ cookie.value }}
          </div>
          <div class="truncate text-tiny text-secondaryLight">
            {{ cookie.domain }}{{ cookie.path }}
          </div>
        </div>
        <HoppButtonSecondary
          v-tippy="{ theme: 'tooltip' }"
          :title="t('action.remove')"
          :icon="IconX"
          @click="removeCookie(cookie)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Cookie } from "@hoppscotch/data"
import { useService } from "dioc/vue"
import { computed } from "vue"
import { useI18n } from "~/composables/i18n"
import { CookieJarService } from "~/services/cookie-jar.service"
import IconTrash2 from "~icons/lucide/trash-2"
import IconX from "~icons/lucide/x"

const props = defineProps<{ url: string }>()
const t = useI18n()
const cookieJar = useService(CookieJarService)

const requestURL = computed(() => {
  if (!URL.canParse(props.url)) return null
  const url = new URL(props.url)
  return url.protocol === "http:" || url.protocol === "https:" ? url : null
})

const cookies = computed(() => {
  if (!requestURL.value) return []
  return cookieJar.getCookiesForURL(requestURL.value)
})

const removeCookie = async (cookie: Cookie) => {
  await cookieJar.deleteCookies([cookie])
}

const clearCookies = async () => {
  await cookieJar.deleteCookies(cookies.value)
}
</script>
