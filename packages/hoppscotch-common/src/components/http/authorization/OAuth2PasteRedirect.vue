<template>
  <HoppSmartModal
    v-if="show"
    dialog
    :title="t('authorization.oauth.external_login_title')"
    @close="emit('cancel')"
  >
    <template #body>
      <div class="flex flex-col space-y-4">
        <p class="text-secondaryLight">
          {{ t("authorization.oauth.external_login_description") }}
        </p>

        <div class="flex flex-col space-y-1">
          <label class="font-semibold text-secondaryLight">
            {{ t("authorization.oauth.external_login_callback_url") }}
          </label>
          <code
            class="break-all rounded border border-dividerLight bg-primaryLight px-2 py-1 text-secondaryDark"
          >
            {{ callbackUrl }}
          </code>
        </div>

        <HoppSmartInput
          v-model="pastedURL"
          placeholder=" "
          :label="t('authorization.oauth.external_login_redirected_url')"
          input-styles="floating-input !border-0"
          styles="border border-divider rounded"
          :autofocus="true"
          @submit="submit"
        />

        <p v-if="showValidationError" class="text-red-500">
          {{ t("authorization.oauth.external_login_invalid_url") }}
        </p>
      </div>
    </template>
    <template #footer>
      <div class="flex flex-1 justify-between">
        <HoppButtonSecondary
          :label="t('authorization.oauth.external_login_open_again')"
          :icon="IconExternalLink"
          outline
          @click="emit('open-again')"
        />
        <span class="flex space-x-2">
          <HoppButtonPrimary
            :label="t('authorization.oauth.external_login_get_token')"
            :loading="loading"
            :disabled="!pastedURL.trim()"
            outline
            @click="submit"
          />
          <HoppButtonSecondary
            :label="t('action.cancel')"
            outline
            filled
            @click="emit('cancel')"
          />
        </span>
      </div>
    </template>
  </HoppSmartModal>
</template>

<script setup lang="ts">
import { ref, watch } from "vue"
import { useI18n } from "~/composables/i18n"
import { isValidCallbackURL } from "~/services/oauth/external-callback"
import IconExternalLink from "~icons/lucide/external-link"

const t = useI18n()

const props = withDefaults(
  defineProps<{
    show: boolean
    callbackUrl: string
    loading?: boolean
  }>(),
  {
    loading: false,
  }
)

const emit = defineEmits<{
  (e: "submit", callbackURL: string): void
  (e: "open-again"): void
  (e: "cancel"): void
}>()

const pastedURL = ref("")
const showValidationError = ref(false)

watch(
  () => props.show,
  (show) => {
    if (show) {
      pastedURL.value = ""
      showValidationError.value = false
    }
  }
)

watch(pastedURL, () => {
  showValidationError.value = false
})

const submit = () => {
  if (props.loading || !pastedURL.value.trim()) return

  if (!isValidCallbackURL(pastedURL.value, props.callbackUrl)) {
    showValidationError.value = true
    return
  }

  emit("submit", pastedURL.value.trim())
}
</script>
