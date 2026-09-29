<template>
  <div
    class="flex flex-col items-center justify-center w-full h-screen bg-primary"
  >
    <div class="flex flex-col items-center space-y-6 max-w-md text-center">
      <AppHeader />

      <LoadingState
        v-if="appState === AppState.LOADING"
        :message="statusMessage"
      />

      <ErrorState
        v-else-if="appState === AppState.ERROR"
        :error="error"
        @retry="initialize"
      />

      <VersionInfo :version="appVersion" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from "vue"

import {
  useAppInitialization,
  AppState,
} from "~/composables/useAppInitialization"
import AppHeader from "./shared/AppHeader.vue"
import LoadingState from "./shared/LoadingState.vue"
import ErrorState from "./shared/ErrorState.vue"
import VersionInfo from "./shared/VersionInfo.vue"

const { appState, error, statusMessage, appVersion, initialize } =
  useAppInitialization()

onMounted(() => {
  void initialize()
})
</script>
