<template>
  <div class="flex flex-col space-y-4">
    <!-- Certificate list -->
    <div v-if="modelValue.length > 0" class="border border-divider rounded">
      <div
        v-for="(entry, index) in modelValue"
        :key="entry.id"
        class="flex items-center justify-between px-4 py-3"
        :class="{ 'border-t border-divider': index !== 0 }"
      >
        <div class="flex flex-col min-w-0 flex-1">
          <span class="font-medium text-secondary truncate">
            {{ entry.hostname }}
          </span>
          <span class="text-tiny text-secondaryLight mt-0.5">
            {{ entry.kind.toUpperCase() }} ·
            {{
              entry.kind === "pem"
                ? entry.cert?.name ?? t("settings.no_file_selected")
                : entry.data?.name ?? t("settings.no_file_selected")
            }}
          </span>
        </div>
        <div class="flex items-center space-x-1 flex-shrink-0 ml-2">
          <HoppButtonSecondary
            v-tippy="{ theme: 'tooltip' }"
            :icon="IconPencil"
            :title="t('action.edit')"
            @click="startEdit(entry)"
          />
          <HoppButtonSecondary
            v-tippy="{ theme: 'tooltip' }"
            :icon="IconTrash"
            :title="t('action.delete')"
            color="red"
            @click="confirmDeleteEntry(entry.id)"
          />
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <p
      v-else
      class="text-center text-secondaryLight text-sm py-4 border border-dashed border-dividerDark rounded"
    >
      {{ t("settings.no_client_certificates") }}
    </p>

    <!-- Add certificate button -->
    <HoppButtonSecondary
      :icon="IconPlus"
      :label="t('settings.add_client_certificate')"
      outline
      @click="startAdd"
    />



    <!-- Add / Edit modal -->
    <HoppSmartModal
      v-if="showFormModal"
      dialog
      :title="
        editingId
          ? t('settings.edit_client_certificate')
          : t('settings.add_client_certificate')
      "
      @close="closeModal"
    >
      <template #body>
        <div class="p-4 space-y-4">
          <!-- Hostname -->
          <div class="border border-divider rounded">
            <HoppSmartInput
              v-model="form.hostname"
              :placeholder="'api.example.com'"
              :label="t('settings.client_certificate_hostname')"
              input-styles="floating-input !border-0"
            />
          </div>

          <!-- Cert type tabs — use certKind ref (not form.kind directly) -->
          <HoppSmartTabs v-model="certKind">
            <HoppSmartTab id="pem" label="PEM">
              <div class="space-y-3 p-4">
                <!-- Certificate file -->
                <div class="flex flex-col space-y-2">
                  <label class="text-sm text-secondary">
                    {{ t("settings.certificate") }}
                    <span class="text-secondaryLight">(.pem, .crt)</span>
                  </label>
                  <HoppButtonSecondary
                    :icon="form.certFile ? IconFile : IconPlus"
                    :label="form.certFile?.name ?? t('settings.select_file')"
                    outline
                    @click="pickPEMCert"
                  />
                </div>
                <!-- Key file -->
                <div class="flex flex-col space-y-2">
                  <label class="text-sm text-secondary">
                    {{ t("settings.key") }}
                    <span class="text-secondaryLight">(.pem, .key)</span>
                  </label>
                  <HoppButtonSecondary
                    :icon="form.keyFile ? IconFile : IconPlus"
                    :label="form.keyFile?.name ?? t('settings.select_file')"
                    outline
                    @click="pickPEMKey"
                  />
                </div>
              </div>
            </HoppSmartTab>

            <HoppSmartTab id="pfx" label="PFX">
              <div class="space-y-3 p-4">
                <!-- PFX file -->
                <div class="flex flex-col space-y-2">
                  <label class="text-sm text-secondary">
                    {{ t("settings.certificate") }}
                    <span class="text-secondaryLight">(.pfx, .p12)</span>
                  </label>
                  <HoppButtonSecondary
                    :icon="form.pfxFile ? IconFile : IconPlus"
                    :label="form.pfxFile?.name ?? t('settings.select_file')"
                    outline
                    @click="pickPFXFile"
                  />
                </div>
                <!-- Passphrase -->
                <div class="border border-divider rounded">
                  <HoppSmartInput
                    v-model="form.passphrase"
                    :type="showPassphrase ? 'text' : 'password'"
                    :label="t('settings.client_certificate_passphrase')"
                    input-styles="floating-input !border-0"
                    :placeholder="' '"
                  >
                    <template #button>
                      <HoppButtonSecondary
                        v-tippy="{ theme: 'tooltip' }"
                        :title="
                          showPassphrase
                            ? t('hide.password')
                            : t('show.password')
                        "
                        :icon="showPassphrase ? IconEye : IconEyeOff"
                        @click="showPassphrase = !showPassphrase"
                      />
                    </template>
                  </HoppSmartInput>
                </div>
              </div>
            </HoppSmartTab>
          </HoppSmartTabs>

          <!-- Validation error — shows actual error detail -->
          <div
            v-if="certError"
            class="flex items-start space-x-2 text-red-500 text-sm"
          >
            <icon-lucide-alert-circle class="svg-icons flex-shrink-0 mt-0.5" />
            <span>{{ certError }}</span>
          </div>
        </div>
      </template>

      <template #footer>
        <div class="flex justify-between w-full px-4 pb-4">
          <HoppButtonSecondary
            :label="t('action.cancel')"
            outline
            @click="closeModal"
          />
          <HoppButtonPrimary
            :label="t('action.save')"
            :disabled="!isFormValid || isSaving"
            :loading="isSaving"
            @click="saveEntry"
          />
        </div>
      </template>
    </HoppSmartModal>

    <!-- Delete confirmation modal -->
    <HoppSmartConfirmModal
      :show="!!confirmDeleteId"
      :confirm="t('action.delete')"
      :title="t('settings.delete_certificate_confirm')"
      @hide-modal="confirmDeleteId = null"
      @resolve="deleteEntry"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, watch } from "vue"
import { useFileDialog } from "@vueuse/core"
import { useI18n } from "@composables/i18n"
import { encryptPassphrase } from "~/helpers/functional/cert-crypto"
import {
  type ClientCertEntry,
} from "~/helpers/functional/cert-registry"
import type { StoreFile } from "@hoppscotch/kernel"

import IconPlus from "~icons/lucide/plus"
import IconPencil from "~icons/lucide/pencil"
import IconTrash from "~icons/lucide/trash"
import IconFile from "~icons/lucide/file"
import IconEye from "~icons/lucide/eye"
import IconEyeOff from "~icons/lucide/eye-off"

const t = useI18n()

// ---------------------------------------------------------------------------
// Props / Emits
// ---------------------------------------------------------------------------

const props = defineProps<{
  modelValue: ClientCertEntry[]
}>()

const emit = defineEmits<{
  (e: "update:modelValue", certs: ClientCertEntry[]): void
}>()

// ---------------------------------------------------------------------------
// UI state
// ---------------------------------------------------------------------------

const showFormModal = ref(false)
const editingId = ref<string | null>(null)
const confirmDeleteId = ref<string | null>(null)
const isSaving = ref(false)
const showPassphrase = ref(false)
const certError = ref<string | null>(null)

/**
 * Dedicated ref for HoppSmartTabs v-model — matches the pattern used in
 * Agent.vue / picker.ts. Keeps form.kind in sync via a watcher.
 */
const certKind = ref<"pem" | "pfx">("pem")
watch(certKind, (val) => {
  form.kind = val
})

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------

interface FormState {
  hostname: string
  kind: "pem" | "pfx"
  certFile: File | null
  keyFile: File | null
  pfxFile: File | null
  passphrase: string
  existingCert?: StoreFile
  existingKey?: StoreFile
  existingPfxData?: StoreFile
}

const form = reactive<FormState>({
  hostname: "",
  kind: "pem",
  certFile: null,
  keyFile: null,
  pfxFile: null,
  passphrase: "",
})

const isFormValid = computed(() => {
  if (!form.hostname.trim()) return false
  if (form.kind === "pem") {
    const hasCert = !!form.certFile || !!form.existingCert
    const hasKey = !!form.keyFile || !!form.existingKey
    return hasCert && hasKey
  }
  return !!(form.pfxFile || form.existingPfxData)
})

// ---------------------------------------------------------------------------
// File pickers
// ---------------------------------------------------------------------------

const pemCertPicker = useFileDialog({
  accept: ".pem,.crt",
  reset: true,
  multiple: false,
})
const pemKeyPicker = useFileDialog({
  accept: ".pem,.key",
  reset: true,
  multiple: false,
})
const pfxPicker = useFileDialog({
  accept: ".pfx,.p12",
  reset: true,
  multiple: false,
})

function pickPEMCert() {
  pemCertPicker.onChange((files) => {
    const file = files?.item(0)
    if (file) {
      form.certFile = file
      form.existingCert = undefined
      certError.value = null
    }
    pemCertPicker.reset()
  })
  pemCertPicker.open()
}

function pickPEMKey() {
  pemKeyPicker.onChange((files) => {
    const file = files?.item(0)
    if (file) {
      form.keyFile = file
      form.existingKey = undefined
      certError.value = null
    }
    pemKeyPicker.reset()
  })
  pemKeyPicker.open()
}

function pickPFXFile() {
  pfxPicker.onChange((files) => {
    const file = files?.item(0)
    if (file) {
      form.pfxFile = file
      form.existingPfxData = undefined
      certError.value = null
    }
    pfxPicker.reset()
  })
  pfxPicker.open()
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Safe UUID generator — falls back to a random string if randomUUID is unavailable */
function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}

function resetForm() {
  certKind.value = "pem"
  form.hostname = ""
  form.kind = "pem"
  form.certFile = null
  form.keyFile = null
  form.pfxFile = null
  form.passphrase = ""
  form.existingCert = undefined
  form.existingKey = undefined
  form.existingPfxData = undefined
  certError.value = null
  showPassphrase.value = false
}

async function fileToStoreFile(file: File): Promise<StoreFile> {
  return {
    include: true,
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    content: new Uint8Array(await file.arrayBuffer()),
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function startAdd() {
  editingId.value = null
  resetForm()
  showFormModal.value = true
}

function startEdit(entry: ClientCertEntry) {
  editingId.value = entry.id
  resetForm()
  form.hostname = entry.hostname
  form.kind = entry.kind
  certKind.value = entry.kind

  if (entry.kind === "pem") {
    form.existingCert = entry.cert
    form.existingKey = entry.key
  } else {
    form.existingPfxData = entry.data
    form.passphrase = ""
  }
  showFormModal.value = true
}

function closeModal() {
  showFormModal.value = false
  resetForm()
  editingId.value = null
}

async function saveEntry() {
  if (!isFormValid.value) return
  isSaving.value = true
  certError.value = null

  try {
    const id = editingId.value ?? generateId()
    const hostname = form.hostname.trim().toLowerCase()

    let newEntry: ClientCertEntry

    if (form.kind === "pem") {
      const cert = form.certFile
        ? await fileToStoreFile(form.certFile)
        : form.existingCert
      const key = form.keyFile
        ? await fileToStoreFile(form.keyFile)
        : form.existingKey

      newEntry = { id, hostname, kind: "pem", cert, key }
    } else {
      const data = form.pfxFile
        ? await fileToStoreFile(form.pfxFile)
        : form.existingPfxData

      // Encrypt passphrase — if crypto is unavailable fall back to empty string
      let encryptedPassphrase = ""
      if (form.passphrase) {
        try {
          encryptedPassphrase = await encryptPassphrase(form.passphrase)
        } catch (cryptoErr) {
          console.warn("[CertificateManager] passphrase encryption failed:", cryptoErr)
          // Store empty rather than plain text; user will need to re-enter on next save
          encryptedPassphrase = ""
        }
      } else if (editingId.value) {
        // Keep existing encrypted passphrase if user left the field blank while editing
        const existing = props.modelValue.find((e) => e.id === editingId.value)
        if (existing && existing.kind === "pfx") {
          encryptedPassphrase = existing.passphrase ?? ""
        }
      }

      newEntry = { id, hostname, kind: "pfx", data, passphrase: encryptedPassphrase }
    }

    const updated = editingId.value
      ? props.modelValue.map((e) => (e.id === editingId.value ? newEntry : e))
      : [...props.modelValue, newEntry]

    emit("update:modelValue", updated)
    closeModal()
  } catch (err) {
    // Surface the real error message so the user knows what went wrong
    const message = err instanceof Error ? err.message : String(err)
    certError.value = `${t("settings.certificate_save_error")} (${message})`
    console.error("[CertificateManager] saveEntry error:", err)
  } finally {
    isSaving.value = false
  }
}

function confirmDeleteEntry(id: string) {
  confirmDeleteId.value = id
}

function deleteEntry() {
  if (!confirmDeleteId.value) return
  emit(
    "update:modelValue",
    props.modelValue.filter((e) => e.id !== confirmDeleteId.value)
  )
  confirmDeleteId.value = null
}
</script>

