<template>
  <div class="flex flex-col">
    <!-- Folder Node -->
    <div
      v-for="(folder, folderIdx) in collection.folders"
      :key="`folder-${folderIdx}`"
      class="mb-1"
    >
      <div
        class="flex items-center gap-2 p-2 rounded hover:bg-primaryLight cursor-pointer"
        @click="toggleFolderExpanded(Number(folderIdx))"
      >
        <icon
          :icon="
            isFolderExpanded(Number(folderIdx)) ? IconChevronDown : IconChevronRight
          "
          class="text-secondaryLight flex-shrink-0"
        />
        <HoppSmartCheckbox
          :on="isFolderSelected(Number(folderIdx))"
          :indeterminate="isFolderIndeterminate(Number(folderIdx))"
          @change.stop="toggleFolderSelection(Number(folderIdx))"
        >
          <div class="flex items-center gap-2">
            <icon :icon="IconFolder" class="text-accent flex-shrink-0" />
            <span class="text-secondaryDark truncate">
              {{ folder.name }}
            </span>
            <span class="text-xs text-secondaryLight">
              ({{ getFolderRequestCount(folder) }})
            </span>
          </div>
        </HoppSmartCheckbox>
      </div>

      <!-- Nested content (requests and subfolders) -->
      <div v-if="isFolderExpanded(Number(folderIdx))" class="ml-6">
        <!-- Folder requests -->
        <div
          v-for="(request, reqIdx) in folder.requests"
          :key="`folder-${folderIdx}-request-${reqIdx}`"
          class="flex items-center gap-2 p-2 rounded hover:bg-primaryLight"
        >
          <HoppSmartCheckbox
            :on="isRequestSelected(folderIdx, Number(reqIdx))"
            @change="toggleRequestSelection(folderIdx, Number(reqIdx))"
          >
            <div class="flex items-center gap-2">
              <span
                class="text-xs font-medium flex-shrink-0 px-2 py-0.5 rounded"
                :class="{
                  'bg-green-500/10 text-green-500': (request as HoppRESTRequest).method === 'GET',
                  'bg-yellow-500/10 text-yellow-500': (request as HoppRESTRequest).method === 'POST',
                  'bg-blue-500/10 text-blue-500': (request as HoppRESTRequest).method === 'PUT',
                  'bg-red-500/10 text-red-500': (request as HoppRESTRequest).method === 'DELETE',
                  'bg-gray-500/10 text-gray-500': !['GET', 'POST', 'PUT', 'DELETE'].includes((request as HoppRESTRequest).method),
                }"
              >
                {{ (request as HoppRESTRequest).method }}
              </span>
              <span class="text-secondaryDark truncate">
                {{ request.name }}
              </span>
            </div>
          </HoppSmartCheckbox>
        </div>

        <!-- Recursive nested folders -->
        <CollectionTreeNode
          v-if="folder.folders && folder.folders.length > 0"
          :collection="folder"
          :selection-state="selectionState"
          :path="[...path, folderIdx]"
          @toggle="$emit('toggle', $event)"
        />
      </div>
    </div>

    <!-- Root-level requests -->
    <div
      v-for="(request, reqIdx) in collection.requests"
      :key="`request-${reqIdx}`"
      class="flex items-center gap-2 p-2 rounded hover:bg-primaryLight"
    >
      <HoppSmartCheckbox
        :on="isRootRequestSelected(Number(reqIdx))"
        @change="toggleRootRequestSelection(Number(reqIdx))"
      >
        <div class="flex items-center gap-2">
          <span
            class="text-xs font-medium flex-shrink-0 px-2 py-0.5 rounded"
            :class="{
              'bg-green-500/10 text-green-500': (request as HoppRESTRequest).method === 'GET',
              'bg-yellow-500/10 text-yellow-500': (request as HoppRESTRequest).method === 'POST',
              'bg-blue-500/10 text-blue-500': (request as HoppRESTRequest).method === 'PUT',
              'bg-red-500/10 text-red-500': (request as HoppRESTRequest).method === 'DELETE',
              'bg-gray-500/10 text-gray-500': !['GET', 'POST', 'PUT', 'DELETE'].includes((request as HoppRESTRequest).method),
            }"
          >
            {{ (request as HoppRESTRequest).method }}
          </span>
          <span class="text-secondaryDark truncate">
            {{ request.name }}
          </span>
        </div>
      </HoppSmartCheckbox>
    </div>
  </div>
</template>

<script setup lang="ts">
import { HoppCollection, HoppRESTRequest } from "@hoppscotch/data"
import { PropType, ref } from "vue"
import { RequestSelectionState } from "./RequestSelectionTree.vue"
import IconChevronDown from "~icons/lucide/chevron-down"
import IconChevronRight from "~icons/lucide/chevron-right"
import IconFolder from "~icons/lucide/folder"

const props = defineProps({
  collection: {
    type: Object as PropType<HoppCollection>,
    required: true,
  },
  selectionState: {
    type: Object as PropType<RequestSelectionState>,
    required: true,
  },
  path: {
    type: Array as PropType<number[]>,
    default: () => [],
  },
})

const emit = defineEmits<{
  (e: "toggle", path: string): void
}>()

// Track expanded folders
const expandedFolders = ref<Set<number>>(new Set())

const toggleFolderExpanded = (folderIdx: number) => {
  if (expandedFolders.value.has(folderIdx)) {
    expandedFolders.value.delete(folderIdx)
  } else {
    expandedFolders.value.add(folderIdx)
  }
}

const isFolderExpanded = (folderIdx: number) => {
  return expandedFolders.value.has(folderIdx)
}

// Helper to build path string
const buildPath = (folderIdx?: number, reqIdx?: number): string => {
  const basePath = props.path
    .map((idx) => `folder_${idx}`)
    .join("/")

  if (folderIdx !== undefined && reqIdx !== undefined) {
    const folderPath = basePath
      ? `${basePath}/folder_${folderIdx}`
      : `folder_${folderIdx}`
    return `${folderPath}/request_${reqIdx}`
  } else if (folderIdx !== undefined) {
    return basePath ? `${basePath}/folder_${folderIdx}` : `folder_${folderIdx}`
  } else if (reqIdx !== undefined) {
    return basePath ? `${basePath}/request_${reqIdx}` : `request_${reqIdx}`
  }
  return basePath
}

// Check if a request is selected
const isRequestSelected = (folderIdx: number, reqIdx: number): boolean => {
  const path = buildPath(folderIdx, reqIdx)
  return props.selectionState[path] ?? false
}

const isRootRequestSelected = (reqIdx: number): boolean => {
  const path = buildPath(undefined, reqIdx)
  return props.selectionState[path] ?? false
}

// Toggle request selection
const toggleRequestSelection = (folderIdx: number, reqIdx: number) => {
  const path = buildPath(folderIdx, reqIdx)
  emit("toggle", path)
}

const toggleRootRequestSelection = (reqIdx: number) => {
  const path = buildPath(undefined, reqIdx)
  emit("toggle", path)
}

// Count requests in a folder (including nested)
const getFolderRequestCount = (folder: HoppCollection): number => {
  let count = folder.requests.length

  if (folder.folders && folder.folders.length > 0) {
    folder.folders.forEach((subFolder) => {
      count += getFolderRequestCount(subFolder)
    })
  }

  return count
}

// Check if folder is fully/partially selected
const getFolderSelectionPaths = (
  folderIdx: number
): { allPaths: string[]; selectedPaths: string[] } => {
  const folder = props.collection.folders[folderIdx]
  const folderBasePath = buildPath(folderIdx)
  const allPaths: string[] = []

  // Get all request paths in this folder
  folder.requests.forEach((_: any, reqIdx: number) => {
    const path = `${folderBasePath}/request_${reqIdx}`
    allPaths.push(path)
  })

  // Recursively get paths from nested folders
  if (folder.folders && folder.folders.length > 0) {
    const getNestedPaths = (
      nestedFolder: HoppCollection,
      parentPath: string
    ) => {
      nestedFolder.requests.forEach((_: any, reqIdx: number) => {
        const path = `${parentPath}/request_${reqIdx}`
        allPaths.push(path)
      })

      nestedFolder.folders?.forEach((subFolder: any, subIdx: number) => {
        const subFolderPath = `${parentPath}/folder_${subIdx}`
        getNestedPaths(subFolder, subFolderPath)
      })
    }

    folder.folders.forEach((subFolder: any, subIdx: number) => {
      const subFolderPath = `${folderBasePath}/folder_${subIdx}`
      getNestedPaths(subFolder, subFolderPath)
    })
  }

  const selectedPaths = allPaths.filter((path) => props.selectionState[path])

  return { allPaths, selectedPaths }
}

const isFolderSelected = (folderIdx: number): boolean => {
  const { allPaths, selectedPaths } = getFolderSelectionPaths(folderIdx)
  return allPaths.length > 0 && selectedPaths.length === allPaths.length
}

const isFolderIndeterminate = (folderIdx: number): boolean => {
  const { allPaths, selectedPaths } = getFolderSelectionPaths(folderIdx)
  return (
    selectedPaths.length > 0 && selectedPaths.length < allPaths.length
  )
}

const toggleFolderSelection = (folderIdx: number) => {
  const { allPaths, selectedPaths } = getFolderSelectionPaths(folderIdx)
  const shouldSelect = selectedPaths.length !== allPaths.length

  // Toggle all requests in this folder
  allPaths.forEach((path) => {
    if (shouldSelect && !props.selectionState[path]) {
      emit("toggle", path)
    } else if (!shouldSelect && props.selectionState[path]) {
      emit("toggle", path)
    }
  })
}
</script>
