<template>
  <HoppSmartModal
    v-if="show"
    dialog
    :title="t('environment.import_global_variables')"
    @close="emit('hide-modal')"
  >
    <template #body>
      <div class="flex flex-col gap-4 p-4">
        <!-- Description -->
        <p class="text-secondaryLight text-xs">
          {{ t("environment.import_global_variables_description") }}
        </p>

        <!-- File picker -->
        <div
          class="flex cursor-pointer flex-col items-center justify-center rounded border-2 border-dashed border-divider p-6 transition hover:border-accent hover:bg-primaryLight"
          :class="{ 'border-accent bg-primaryLight': isDragging }"
          @dragover.prevent="isDragging = true"
          @dragleave.prevent="isDragging = false"
          @drop.prevent="onFileDrop"
          @click="triggerFilePicker"
        >
          <icon-lucide-upload class="svg-icons mb-2 opacity-60" />
          <span class="text-sm text-secondaryLight">
            {{ t("import.from_file") }}
          </span>
          <span class="mt-1 text-xs text-secondaryLight opacity-70">
            {{ t("import.hoppscotch_environment_description") }}
          </span>
          <input
            ref="fileInput"
            type="file"
            accept="application/json"
            class="hidden"
            @change="onFileChange"
          />
        </div>

        <!-- JSON validation error -->
        <div
          v-if="jsonError"
          class="flex items-center gap-2 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-500"
        >
          <icon-lucide-alert-circle class="svg-icons shrink-0" />
          <span>{{ jsonError }}</span>
        </div>

        <!-- Selected file name -->
        <div v-if="selectedFileName" class="flex items-center gap-2 text-sm">
          <icon-lucide-file-json class="svg-icons text-accent" />
          <span class="truncate text-secondaryDark">{{ selectedFileName }}</span>
          <HoppButtonSecondary
            :icon="IconX"
            class="ml-auto"
            @click="clearFile"
          />
        </div>

        <!-- Import summary chips -->
        <div
          v-if="selectedFile && !jsonError"
          class="flex flex-wrap gap-2"
        >
          <span
            v-if="newVariables.length"
            class="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2.5 py-0.5 text-xs font-medium text-green-600"
          >
            <icon-lucide-plus-circle class="svg-icons" />
            {{ newVariables.length }} new
          </span>
          <span
            v-if="conflictItems.length"
            class="inline-flex items-center gap-1 rounded-full bg-yellow-500/10 px-2.5 py-0.5 text-xs font-medium text-yellow-600"
          >
            <icon-lucide-alert-triangle class="svg-icons" />
            {{ conflictItems.length }} conflict{{ conflictItems.length > 1 ? "s" : "" }}
          </span>
          <span
            v-if="ignoredCount"
            class="inline-flex items-center gap-1 rounded-full bg-primaryLight px-2.5 py-0.5 text-xs font-medium text-secondaryLight"
          >
            <icon-lucide-check class="svg-icons" />
            {{ ignoredCount }} unchanged
          </span>
          <span
            v-if="!newVariables.length && !conflictItems.length && !ignoredCount"
            class="inline-flex items-center gap-1 rounded-full bg-primaryLight px-2.5 py-0.5 text-xs font-medium text-secondaryLight"
          >
            <icon-lucide-info class="svg-icons" />
            No variables found
          </span>
        </div>

        <!-- New variables preview -->
        <div
          v-if="newVariables.length"
          class="flex flex-col gap-1 rounded border border-divider bg-primaryLight p-3"
        >
          <p class="mb-1 text-xs font-semibold uppercase tracking-wider text-secondary">
            New Variables ({{ newVariables.length }})
          </p>
          <div class="max-h-32 overflow-y-auto">
            <div
              v-for="(variable, idx) in newVariables"
              :key="idx"
              class="flex items-center gap-2 py-0.5 text-sm"
            >
              <icon-lucide-lock
                v-if="variable.secret"
                class="svg-icons text-yellow-500"
              />
              <icon-lucide-variable v-else class="svg-icons text-accent" />
              <span class="font-mono text-xs">{{ variable.key }}</span>
            </div>
          </div>
        </div>

        <!-- Conflict resolution -->
        <div v-if="conflictItems.length" class="flex flex-col gap-2">
          <p class="text-xs font-semibold uppercase tracking-wider text-secondary">
            Conflicts — choose which value to keep
          </p>
          <div class="flex flex-col gap-2 max-h-64 overflow-y-auto pr-1">
            <div
              v-for="(conflict, idx) in conflictItems"
              :key="idx"
              class="rounded border border-divider bg-primaryLight p-3"
            >
              <!-- Variable name -->
              <div class="mb-2 flex items-center gap-1.5">
                <icon-lucide-lock
                  v-if="conflict.secret"
                  class="svg-icons text-yellow-500"
                />
                <icon-lucide-variable v-else class="svg-icons text-accent" />
                <span class="font-mono text-xs font-semibold text-secondaryDark">
                  {{ conflict.key }}
                </span>
              </div>
              <!-- Choice -->
              <div class="grid grid-cols-2 gap-2">
                <!-- Keep existing -->
                <label
                  class="flex cursor-pointer flex-col gap-1 rounded border p-2 transition"
                  :class="
                    conflict.choice === 'keep'
                      ? 'border-accent bg-accent/5'
                      : 'border-divider hover:border-accent/50'
                  "
                >
                  <span class="flex items-center gap-1.5">
                    <input
                      v-model="conflict.choice"
                      type="radio"
                      value="keep"
                      class="accent-accentDark"
                    />
                    <span class="text-xs font-medium text-secondary">Keep existing</span>
                  </span>
                  <span
                    class="ml-4 break-all font-mono text-xs text-secondaryLight"
                    :class="{ 'blur-sm select-none': conflict.secret }"
                  >
                    {{
                      conflict.secret
                        ? "••••••••"
                        : conflict.existingInitialValue || "(empty)"
                    }}
                  </span>
                  <span
                    v-if="!conflict.secret && conflict.existingCurrentValue !== conflict.existingInitialValue"
                    class="ml-4 break-all font-mono text-xs text-secondaryLight opacity-70"
                  >
                    current: {{ conflict.existingCurrentValue || "(empty)" }}
                  </span>
                </label>
                <!-- Use new -->
                <label
                  class="flex cursor-pointer flex-col gap-1 rounded border p-2 transition"
                  :class="
                    conflict.choice === 'use-new'
                      ? 'border-accent bg-accent/5'
                      : 'border-divider hover:border-accent/50'
                  "
                >
                  <span class="flex items-center gap-1.5">
                    <input
                      v-model="conflict.choice"
                      type="radio"
                      value="use-new"
                      class="accent-accentDark"
                    />
                    <span class="text-xs font-medium text-secondary">Use new value</span>
                  </span>
                  <span
                    class="ml-4 break-all font-mono text-xs text-secondaryLight"
                    :class="{ 'blur-sm select-none': conflict.secret }"
                  >
                    {{
                      conflict.secret
                        ? "••••••••"
                        : conflict.newInitialValue || "(empty)"
                    }}
                  </span>
                  <span
                    v-if="!conflict.secret && conflict.newCurrentValue !== conflict.newInitialValue"
                    class="ml-4 break-all font-mono text-xs text-secondaryLight opacity-70"
                  >
                    current: {{ conflict.newCurrentValue || "(empty)" }}
                  </span>
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <template #footer>
      <span class="flex gap-2">
        <HoppButtonPrimary
          label="Import"
          :icon="IconUpload"
          :loading="isImporting"
          :disabled="!selectedFile || !!jsonError"
          @click="doImport"
        />
        <HoppButtonSecondary
          :label="t('action.cancel')"
          @click="emit('hide-modal')"
        />
      </span>
    </template>
  </HoppSmartModal>
</template>

<script setup lang="ts">
import { GlobalEnvironmentVariable } from "@hoppscotch/data"
import * as E from "fp-ts/Either"
import { ref } from "vue"
import { useI18n } from "@composables/i18n"
import { useToast } from "@composables/toast"
import { hoppGlobalEnvImporter } from "~/helpers/import-export/import/hoppGlobalEnv"
import {
  analyzeGlobalImport,
  resolveGlobalImport,
} from "~/helpers/import-export/import/globalImportMerge"
import {
  getGlobalVariables,
  setGlobalEnvVariables,
} from "~/newstore/environments"
import {
  populateLocalStoresFromVariables,
  promoteInitialValueForImport,
  stripSecretVariableValuesForWire,
} from "~/helpers/secretVariables"
import { getService } from "~/modules/dioc"
import { CurrentValueService } from "~/services/current-environment-value.service"
import IconUpload from "~icons/lucide/upload"
import IconX from "~icons/lucide/x"

const t = useI18n()
const toast = useToast()

defineProps<{ show: boolean }>()
const emit = defineEmits<{
  (e: "hide-modal"): void
}>()

import type { ConflictItem } from "~/helpers/import-export/import/globalImportMerge"

// ── State ─────────────────────────────────────────────────────────────────────
const fileInput = ref<HTMLInputElement | null>(null)
const selectedFile = ref<File | null>(null)
const selectedFileName = ref("")
const isDragging = ref(false)
const isImporting = ref(false)
const jsonError = ref("")

const newVariables = ref<GlobalEnvironmentVariable[]>([])
const conflictItems = ref<ConflictItem[]>([])
const ignoredCount = ref(0)

// ── File helpers ──────────────────────────────────────────────────────────────
const triggerFilePicker = () => fileInput.value?.click()

const clearFile = () => {
  selectedFile.value = null
  selectedFileName.value = ""
  newVariables.value = []
  conflictItems.value = []
  ignoredCount.value = 0
  jsonError.value = ""
  if (fileInput.value) fileInput.value.value = ""
}

const readFileContents = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve(e.target?.result as string)
    reader.onerror = reject
    reader.readAsText(file)
  })

const processFile = async (file: File) => {
  selectedFile.value = file
  selectedFileName.value = file.name
  newVariables.value = []
  conflictItems.value = []
  ignoredCount.value = 0
  jsonError.value = ""

  try {
    const content = await readFileContents(file)

    // Validate JSON
    try {
      JSON.parse(content)
    } catch {
      jsonError.value = t("error.invalid_json")
      selectedFile.value = null
      if (fileInput.value) fileInput.value.value = ""
      return
    }

    const result = await hoppGlobalEnvImporter([content])()

    if (E.isLeft(result)) {
      toast.error(t("import.failed"))
      clearFile()
      return
    }

    const importedVars = result.right
    const existing = getGlobalVariables()
    const currentValueService = getService(CurrentValueService)

    const getRuntimeCurrentValue = (key: string, isSecret: boolean) =>
      isSecret
        ? ""
        : (currentValueService.getEnvironmentByKey("Global", key)?.currentValue ?? "")

    const analysis = analyzeGlobalImport(importedVars, existing, getRuntimeCurrentValue)
    newVariables.value = analysis.newVariables
    conflictItems.value = analysis.conflictItems
    ignoredCount.value = analysis.ignoredCount
  } catch {
    toast.error(t("import.failed"))
    clearFile()
  }
}

const onFileChange = async (event: Event) => {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (file) await processFile(file)
}

const onFileDrop = async (event: DragEvent) => {
  isDragging.value = false
  const file = event.dataTransfer?.files?.[0]
  if (file) await processFile(file)
}

// ── Import logic ──────────────────────────────────────────────────────────────
const doImport = async () => {
  if (!selectedFile.value) return

  isImporting.value = true

  try {
    const existing = getGlobalVariables()
    const currentValueService = getService(CurrentValueService)

    const getRuntimeCurrentValue = (key: string, isSecret: boolean) =>
      isSecret
        ? ""
        : (currentValueService.getEnvironmentByKey("Global", key)?.currentValue ?? "")

    const finalVars = resolveGlobalImport(
      existing,
      conflictItems.value,
      newVariables.value,
      getRuntimeCurrentValue
    )

    const stripped = stripSecretVariableValuesForWire(finalVars)
    setGlobalEnvVariables({ v: 2, variables: stripped })
    populateLocalStoresFromVariables(
      "Global",
      promoteInitialValueForImport(finalVars)
    )

    toast.success(t("environment.import_global_variables_success"))
    emit("hide-modal")
    clearFile()
  } catch {
    toast.error(t("import.failed"))
  } finally {
    isImporting.value = false
  }
}
</script>

