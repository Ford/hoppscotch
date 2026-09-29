<template>
  <div
    class="flex flex-col items-center justify-center w-full h-screen bg-primary"
  >
    <div class="flex flex-col items-center space-y-6 max-w-md text-center">
      <AppHeader mode="Portable" />

      <div
        v-if="showPortableWelcome"
        class="flex flex-col items-center space-y-4 max-w-md text-center"
      >
        <div
          class="bg-primaryLight border border-dividerDark rounded-lg p-6 shadow-lg"
        >
          <h2 class="text-lg font-semibold text-secondaryDark mb-4">
            Portable Mode Information
          </h2>

          <div class="space-y-4 text-sm text-secondary text-left">
            <div>
              <p class="font-medium text-secondaryDark mb-2">Data Storage</p>
              <ul class="space-y-1 text-sm">
                <li>
                  • Your data is in the directory you launched this app from.
                </li>
                <li>• This won't sync with the installed version.</li>
              </ul>
            </div>

            <div class="bg-primary rounded p-3 border border-divider">
              <p class="font-medium text-secondaryDark text-sm mb-1">
                Why no automatic data transfer?
              </p>
              <p class="text-sm">
                Portable apps avoid accessing system directories to maintain
                compatibility with enterprise security policies.
              </p>
            </div>

            <div>
              <p class="font-medium text-secondaryDark mb-2">
                Updates & Migration
              </p>
              <ul class="space-y-1 text-sm">
                <li>• Updates require manual download</li>
                <li>• Data persists when updating portable versions</li>
                <li>
                  • Manually copy files to transfer from installed version
                </li>
              </ul>
            </div>
          </div>

          <div class="flex gap-4 items-center justify-center mt-6">
            <label class="flex items-center space-x-2 cursor-pointer">
              <input
                v-model="portableSettings.autoSkipWelcome"
                type="checkbox"
                class="form-checkbox h-4 w-4 text-accent"
                @change="onAutoSkipChange"
              />
              <span class="text-sm">Don't show this again</span>
            </label>
          </div>

          <div class="flex space-x-3 mt-6">
            <HoppButtonPrimary
              label="Continue"
              class="flex-1"
              @click="handlePortableWelcomeContinue"
            />
            <HoppButtonSecondary label="Close App" outline @click="closeApp" />
            <HoppButtonSecondary
              label="Learn More"
              outline
              @click="openDataMigrationDocs"
            />
          </div>
        </div>
      </div>

      <LoadingState
        v-else-if="appState === AppState.LOADING"
        :message="statusMessage"
      />

      <ErrorState
        v-else-if="appState === AppState.ERROR"
        :error="error"
        @retry="initialize"
      />

      <VersionInfo
        :version="appVersion"
        :data-directory="
          currentDirectory ? `${currentDirectory}/latest` : undefined
        "
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, reactive } from "vue"
import { close } from "@hoppscotch/plugin-appload"
import { invoke } from "@tauri-apps/api/core"

import { Io } from "~/kernel"
import {
  useAppInitialization,
  AppState,
} from "~/composables/useAppInitialization"

import AppHeader from "./shared/AppHeader.vue"
import LoadingState from "./shared/LoadingState.vue"
import ErrorState from "./shared/ErrorState.vue"
import VersionInfo from "./shared/VersionInfo.vue"

const {
  appState,
  error,
  statusMessage,
  appVersion,
  persistence,
  loadRecent,
  initialize,
} = useAppInitialization()

const showPortableWelcome = ref(false)
const currentDirectory = ref(".")

const portableSettings = reactive({
  autoSkipWelcome: false,
})

const onAutoSkipChange = () => {
  console.log("Auto skip checkbox changed:", portableSettings.autoSkipWelcome)
}

const openDataMigrationDocs = () => {
  Io.openExternalLink({
    url: "https://docs.hoppscotch.io/documentation/clients/desktop",
  })
}

const closeApp = async () => {
  try {
    await close({ windowLabel: "main" })
  } catch (err) {
    console.error("Failed to close app:", err)
  }
}

const handlePortableWelcomeContinue = async () => {
  try {
    // Read-modify-write against the full `DesktopSettings` object so
    // unrelated fields like timeout or zoom, potentially written by the
    // webview-side settings page in the same session, are preserved.
    const current = await persistence.desktopSettings.get()
    const updated = {
      ...current,
      autoSkipWelcome: portableSettings.autoSkipWelcome,
    }

    await persistence.desktopSettings.set(updated)

    showPortableWelcome.value = false
    await loadRecent()
  } catch (error) {
    console.error("Failed to save desktop settings:", error)
    showPortableWelcome.value = false
    await loadRecent()
  }
}

const initializePortableMode = async () => {
  try {
    const latestDir = await invoke<string>("get_latest_dir")
    // NOTE: This is just to show where the files can be.
    // This can be flaky sometimes, but should be good enough regardless.
    const basePath = latestDir.replace(/[\\\/]latest$/, "")
    currentDirectory.value = basePath
  } catch (err) {
    console.error("Failed to get latest directory:", err)
    currentDirectory.value = "."
  }

  const settings = await persistence.desktopSettings.get()
  console.log("Loaded desktop settings:", settings)

  portableSettings.autoSkipWelcome = settings.autoSkipWelcome

  if (!settings.autoSkipWelcome) {
    console.log("Showing portable welcome screen")
    showPortableWelcome.value = true
    return
  }

  console.log("Auto-skipping welcome screen")
  await loadRecent()
}

onMounted(() => {
  void initialize(initializePortableMode)
})
</script>
