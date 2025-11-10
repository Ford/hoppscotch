<template>
  <div class="flex flex-1 flex-col">
    <div
      class="sticky z-10 flex flex-shrink-0 items-center justify-between overflow-x-auto border-b border-dividerLight bg-primary pl-4"
      :class="[
        isCollectionProperty
          ? 'top-propertiesPrimaryStickyFold'
          : 'top-upperMobileSecondaryStickyFold sm:top-upperSecondaryStickyFold',
      ]"
    >
      <label class="truncate font-semibold text-secondaryLight">
        {{ t("cookies.modal.cookie_string") }}
      </label>
      <div class="flex">
        <HoppButtonSecondary
          v-tippy="{ theme: 'tooltip' }"
          to="https://docs.hoppscotch.io/documentation/features/cookies"
          blank
          :title="t('app.wiki')"
          :icon="IconHelpCircle"
        />
        <HoppButtonSecondary
          v-tippy="{ theme: 'tooltip' }"
          :title="t('action.clear_all')"
          :icon="IconTrash2"
          @click="clearAllCookies()"
        />
        <HoppButtonSecondary
          v-tippy="{ theme: 'tooltip' }"
          :title="t('cookies.modal.set')"
          :icon="IconPlus"
          @click="openCookiesModal"
        />
      </div>
    </div>

    <div v-if="cookiesByDomain.length === 0" class="flex flex-1">
      <HoppSmartPlaceholder
        :src="`/images/states/${colorMode.value}/add_category.svg`"
        :alt="`${t('cookies.modal.no_cookies_in_domain')}`"
        :text="t('cookies.modal.no_cookies_in_domain')"
      >
        <template #body>
          <HoppButtonSecondary
            filled
            :label="`${t('cookies.modal.set')}`"
            :icon="IconPlus"
            @click="openCookiesModal"
          />
        </template>
      </HoppSmartPlaceholder>
    </div>

    <div v-else class="divide-y divide-dividerLight">
      <div
        v-for="(domainGroup, domainIndex) in cookiesByDomain"
        :key="domainIndex"
        class="flex flex-col"
      >
        <!-- Domain Header -->
        <div class="sticky z-10 bg-primary px-4 py-2 border-b border-dividerLight">
          <div class="flex items-center justify-between">
            <h3 class="font-semibold text-secondaryDark">
              {{ domainGroup.domain }}
            </h3>
            <span class="text-tiny text-secondaryLight">
              {{ domainGroup.cookies.length }} {{
                domainGroup.cookies.length === 1 ? 'cookie' : 'cookies'
              }}
            </span>
          </div>
        </div>

        <!-- Cookies for this domain -->
        <div
          v-for="(cookie, cookieIndex) in domainGroup.cookies"
          :key="`${domainIndex}-${cookieIndex}`"
          class="group flex divide-x divide-dividerLight border-b border-dividerLight hover:bg-primaryLight"
        >
          <!-- Cookie Name -->
          <div class="flex-1 px-4 py-3">
            <div class="flex items-center justify-between">
              <span class="font-medium text-secondaryDark">
                {{ cookie.name }}
              </span>
              <div class="flex items-center space-x-2">
                <span
                  v-if="cookie.httpOnly"
                  v-tippy="{ theme: 'tooltip' }"
                  title="HTTP Only"
                  class="px-1 py-0.5 text-tiny bg-yellow-100 text-yellow-800 rounded"
                >
                  HTTP
                </span>
                <span
                  v-if="cookie.secure"
                  v-tippy="{ theme: 'tooltip' }"
                  title="Secure"
                  class="px-1 py-0.5 text-tiny bg-green-100 text-green-800 rounded"
                >
                  SSL
                </span>
              </div>
            </div>
            <div class="text-secondary text-body truncate mt-1">
              {{ cookie.value }}
            </div>
            <div class="flex items-center space-x-4 mt-1 text-tiny text-secondaryLight">
              <span v-if="cookie.path">Path: {{ cookie.path }}</span>
              <span v-if="cookie.expires">
                Expires: {{ formatExpiration(cookie.expires) }}
              </span>
              <span v-if="cookie.sameSite">
                SameSite: {{ cookie.sameSite }}
              </span>
            </div>
          </div>

          <!-- Actions -->
          <div class="flex items-center px-2">
            <HoppButtonSecondary
              v-tippy="{ theme: 'tooltip' }"
              :title="t('action.edit')"
              :icon="IconEdit2"
              @click="editCookie(cookie, domainGroup.domain)"
            />
            <HoppButtonSecondary
              v-tippy="{ theme: 'tooltip' }"
              :title="t('action.remove')"
              :icon="IconTrash2"
              @click="removeCookie(cookie, domainGroup.domain)"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"
import { useI18n } from "@composables/i18n"
import { useColorMode } from "@composables/theming"
import { useToast } from "@composables/toast"
import { useService } from "dioc/vue"
import { CookieJarService } from "~/services/cookie-jar.service"
import IconHelpCircle from "~icons/lucide/help-circle"
import IconTrash2 from "~icons/lucide/trash-2"
import IconPlus from "~icons/lucide/plus"
import IconEdit2 from "~icons/lucide/edit-2"

const t = useI18n()
const toast = useToast()
const colorMode = useColorMode()

const props = defineProps<{
  url?: string
  isCollectionProperty?: boolean
}>()

const cookieJarService = useService(CookieJarService)

// Get cookies grouped by domain
const cookiesByDomain = computed(() => {
  const allCookies = cookieJarService.getCookiesForURL(props.url || "")

  // Group cookies by domain
  const grouped = allCookies.reduce((acc, cookie) => {
    const domain = cookie.domain || "localhost"
    if (!acc[domain]) {
      acc[domain] = []
    }
    acc[domain].push(cookie)
    return acc
  }, {} as Record<string, any[]>)

  // Convert to array format
  return Object.entries(grouped).map(([domain, cookies]) => ({
    domain,
    cookies
  }))
})

const formatExpiration = (expires: Date | string) => {
  if (!expires) return "Session"
  const date = typeof expires === "string" ? new Date(expires) : expires
  if (date.getTime() < Date.now()) return "Expired"
  return date.toLocaleDateString()
}

const openCookiesModal = () => {
  // TODO: Implement modal opening when action is available
  toast.info("Cookie management modal will be available soon")
}

const editCookie = (cookie: any, domain: string) => {
  // TODO: Implement cookie editing
  toast.info("Cookie editing will be implemented in the next step")
}

const removeCookie = (cookie: any, domain: string) => {
  cookieJarService.removeCookie(cookie.name, domain)
  toast.success(`${t("state.deleted")}`)
}

const clearAllCookies = () => {
  if (props.url) {
    const url = new URL(props.url)
    cookieJarService.clearCookiesForDomain(url.hostname)
  } else {
    cookieJarService.clearAllCookies()
  }
  toast.success(`${t("action.clear_all")}`)
}
</script>
