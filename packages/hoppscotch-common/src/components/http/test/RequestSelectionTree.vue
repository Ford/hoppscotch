<template>
  <div class="flex flex-col space-y-2">
    <!-- Select All / Deselect All Controls -->
    <div class="flex items-center justify-between pb-2 border-b border-divider">
      <div class="flex items-center gap-2">
        <HoppSmartCheckbox :on="allSelected" @change="toggleSelectAll">
          <span class="font-semibold text-secondaryDark">
            {{ t("collection_runner.select_requests") }}
          </span>
        </HoppSmartCheckbox>
        <span class="text-xs text-secondaryLight">
          {{ selectedCount }} / {{ totalCount }}
          {{ totalCount === 1 ? t("count.request") : t("count.requests") }}
        </span>
      </div>
      <div class="flex gap-2">
        <HoppButtonSecondary
          v-if="!allSelected"
          :label="t('collection_runner.select_all')"
          outline
          @click="selectAll"
        />
        <HoppButtonSecondary
          v-if="selectedCount > 0"
          :label="t('collection_runner.deselect_all')"
          outline
          @click="deselectAll"
        />
      </div>
    </div>

    <!-- Collection Tree -->
    <div class="flex-1 overflow-auto space-y-1">
      <RequestSelectionTreeNode
        :collection="collection"
        :selection-state="selectionState"
        :path="[]"
        @toggle="toggleSelection"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { HoppCollection } from "@hoppscotch/data"
import { computed, PropType, ref } from "vue"
import { useI18n } from "~/composables/i18n"
import RequestSelectionTreeNode from "./RequestSelectionTreeNode.vue"

const t = useI18n()

export type RequestSelectionState = {
  [path: string]: boolean
}

const props = defineProps({
  collection: {
    type: Object as PropType<HoppCollection>,
    required: true,
  },
  modelValue: {
    type: Object as PropType<RequestSelectionState>,
    default: () => ({}),
  },
})

const emit = defineEmits<{
  (e: "update:modelValue", value: RequestSelectionState): void
}>()

const buildAllPaths = (
  collection: HoppCollection,
  parentPath: string = ""
): string[] => {
  const paths: string[] = []

  collection.requests.forEach((_: any, idx: number) => {
    const path = parentPath ? `${parentPath}/request_${idx}` : `request_${idx}`
    paths.push(path)
  })

  collection.folders.forEach((folder: any, folderIdx: number) => {
    const folderPath = parentPath
      ? `${parentPath}/folder_${folderIdx}`
      : `folder_${folderIdx}`

    folder.requests.forEach((_: any, reqIdx: number) => {
      paths.push(`${folderPath}/request_${reqIdx}`)
    })

    if (folder.folders && folder.folders.length > 0) {
      const nestedPaths = buildAllPaths(
        { requests: [], folders: folder.folders } as any,
        folderPath
      )
      paths.push(...nestedPaths)
    }
  })

  return paths
}

// Initialize all requests as selected immediately at declaration time
const initStateFromCollection = (): RequestSelectionState => {
  const paths = buildAllPaths(props.collection)
  const state: RequestSelectionState = {}
  paths.forEach((p) => { state[p] = true })
  return state
}

const selectionState = ref<RequestSelectionState>(initStateFromCollection())

const emitUpdate = () => {
  emit("update:modelValue", { ...selectionState.value })
}

// Emit initial state to parent
emitUpdate()

const totalCount = computed(() => buildAllPaths(props.collection).length)

const selectedCount = computed(
  () => Object.values(selectionState.value).filter(Boolean).length
)

const allSelected = computed(
  () => totalCount.value > 0 && selectedCount.value === totalCount.value
)

const selectAll = () => {
  const allPaths = buildAllPaths(props.collection)
  const newState: RequestSelectionState = {}
  allPaths.forEach((path) => { newState[path] = true })
  selectionState.value = newState
  emitUpdate()
}

const deselectAll = () => {
  const allPaths = buildAllPaths(props.collection)
  const newState: RequestSelectionState = {}
  allPaths.forEach((path) => { newState[path] = false })
  selectionState.value = newState
  emitUpdate()
}

const toggleSelectAll = () => {
  if (allSelected.value) {
    deselectAll()
  } else {
    selectAll()
  }
}

const toggleSelection = (path: string) => {
  selectionState.value = {
    ...selectionState.value,
    [path]: !selectionState.value[path],
  }
  emitUpdate()
}
</script>
