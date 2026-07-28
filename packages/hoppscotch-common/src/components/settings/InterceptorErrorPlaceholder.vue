<template>
  <HoppSmartPlaceholder
    :src="`/images/states/${colorMode.value}/upload_error.svg`"
    :alt="`${t('error.network_fail')}`"
    :heading="t('error.network_fail')"
  >
    <template #body>
      <!-- Desktop mode: show only a concise error message, no extension guidance -->
      <div v-if="isDesktop" class="my-1 flex flex-col items-center text-secondaryLight">
        <span>{{ t('error.network_fail') }}</span>
      </div>
      <!-- Web mode: show full browser extension install guidance -->
      <template v-else>
        <div class="my-1 flex flex-col items-center text-secondaryLight">
          <span>
            {{ t("error.please_install_extension") }}
          </span>
          <span>
            {{ t("error.check_how_to_add_origin") }}
            <HoppSmartLink
              blank
              to="https://docs.hoppscotch.io/documentation/features/interceptor#browser-extension"
              class="text-accent hover:text-accentDark"
            >
              here
            </HoppSmartLink>
          </span>
        </div>
        <div class="flex flex-col space-y-2 py-4">
          <HoppSmartItem
            to="https://chrome.google.com/webstore/detail/hoppscotch-browser-extens/amknoiejhlmhancpahfcfcfhllgkpbld"
            blank
            :icon="IconChrome"
            label="Chrome"
            :info-icon="hasChromeExtInstalled ? IconCheckCircle : null"
            :active-info-icon="hasChromeExtInstalled"
            outline
          />
          <HoppSmartItem
            to="https://addons.mozilla.org/en-US/firefox/addon/hoppscotch"
            blank
            :icon="IconFirefox"
            label="Firefox"
            :info-icon="hasFirefoxExtInstalled ? IconCheckCircle : null"
            :active-info-icon="hasFirefoxExtInstalled"
            outline
          />
        </div>
        <div class="space-y-4 py-4">
          <div class="flex items-center">
            <HoppSmartToggle
              :on="extensionEnabled"
              @change="extensionEnabled = !extensionEnabled"
            >
              {{ t("settings.extensions_use_toggle") }}
            </HoppSmartToggle>
          </div>
        </div>
      </template>
    </template>
  </HoppSmartPlaceholder>
</template>

<script setup lang="ts">
import IconChrome from "~icons/brands/chrome"
import IconFirefox from "~icons/brands/firefox"
import IconCheckCircle from "~icons/lucide/check-circle"
import { useI18n } from "@composables/i18n"
import { useColorMode } from "@composables/theming"
import { useService } from "dioc/vue"
import { computed } from "vue"
import { KernelInterceptorService } from "~/services/kernel-interceptor.service"
import { ExtensionKernelInterceptorService } from "~/platform/std/kernel-interceptors/extension"
import { platform } from "~/platform"
import { getKernelMode } from "@hoppscotch/kernel"

const colorMode = useColorMode()
const t = useI18n()

const kernelInterceptorService = useService(KernelInterceptorService)
const extensionService = useService(ExtensionKernelInterceptorService)

const hasChromeExtInstalled = extensionService.chromeExtensionInstalled
const hasFirefoxExtInstalled = extensionService.firefoxExtensionInstalled

// Check if running in desktop mode to show appropriate error message
const isDesktop = getKernelMode() === "desktop"

const extensionEnabled = computed({
  get() {
    return kernelInterceptorService.current.value?.id === extensionService.id
  },
  set(active) {
    if (active) {
      kernelInterceptorService.setActive(extensionService.id)
    } else {
      kernelInterceptorService.setActive(platform.kernelInterceptors.default)
    }
  },
})
</script>
