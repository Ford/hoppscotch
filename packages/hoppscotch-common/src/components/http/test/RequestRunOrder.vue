<template>
  <div class="flex flex-col h-full">
    <!-- Header: title + Select All / Deselect All / Reset -->
    <div
      class="flex items-center justify-between pb-2 mb-2 border-b border-divider flex-shrink-0"
    >
      <span class="text-xs font-semibold text-secondaryDark">
        {{ t("collection_runner.request_selection") }}
        <span class="ml-1 font-normal text-secondaryLight">
          ({{ selectedCount }}/{{ items.length }})
        </span>
      </span>
      <div class="flex items-center gap-2 text-xs text-secondaryLight">
        <button
          class="hover:text-secondary transition-colors"
          @click="deselectAll"
        >
          {{ t("collection_runner.deselect_all") }}
        </button>
        <span class="opacity-30">|</span>
        <button
          class="hover:text-secondary transition-colors"
          @click="selectAll"
        >
          {{ t("collection_runner.select_all") }}
        </button>
        <span class="opacity-30">|</span>
        <button
          class="hover:text-secondary transition-colors"
          @click="resetOrder"
        >
          {{ t("collection_runner.reset_order") }}
        </button>
      </div>
    </div>

    <!-- Draggable list -->
    <draggable
      v-model="items"
      class="flex-1 overflow-y-auto space-y-0.5"
      :item-key="(item: FlatRequest) => item.path"
      animation="200"
      handle=".drag-handle"
      draggable=".drag-item"
      ghost-class="opacity-40"
      chosen-class="bg-primaryLight"
      drag-class="cursor-grabbing"
    >
      <template #item="{ element: item }">
        <div
          class="drag-item flex items-center gap-2 p-2 rounded hover:bg-primaryLight group"
        >
          <!-- Drag handle: must be a real DOM element (not SVG) for Sortable.js -->
          <HoppButtonSecondary
            :icon="IconGripVertical"
            class="drag-handle cursor-grab opacity-30 group-hover:opacity-100 flex-shrink-0"
            tabindex="-1"
          />

          <!-- Checkbox -->
          <HoppSmartCheckbox
            :on="isSelected(item.path)"
            @change="toggleSelection(item.path)"
          />

          <!-- Method badge -->
          <span
            class="text-xs font-medium flex-shrink-0 px-1.5 py-0.5 rounded min-w-[3.5rem] text-center uppercase"
            :class="methodClass(item.method)"
          >
            {{ item.method }}
          </span>

          <!-- Request name + folder breadcrumb -->
          <div class="flex flex-col min-w-0 flex-1">
            <span class="text-secondaryDark text-sm truncate">
              {{ item.name }}
            </span>
            <span
              v-if="item.folderPath.length > 0"
              class="text-xs text-secondaryLight truncate"
            >
              {{ item.folderPath.join(" › ") }}
            </span>
          </div>
        </div>
      </template>
    </draggable>

    <div
      v-if="items.length === 0"
      class="flex items-center justify-center h-32 text-secondaryLight text-sm"
    >
      {{ t("collection_runner.loading_requests") }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { HoppCollection, HoppRESTRequest } from "@hoppscotch/data"
import { computed, PropType, ref, watch } from "vue"
import draggable from "vuedraggable-es"
import { useI18n } from "~/composables/i18n"
import { RequestSelectionState } from "./RequestSelectionTree.vue"
import IconGripVertical from "~icons/lucide/grip-vertical"

const t = useI18n()

type FlatRequest = {
  path: string
  name: string
  method: string
  folderPath: string[]
}

const props = defineProps({
  collection: {
    type: Object as PropType<HoppCollection>,
    required: true,
  },
  modelValue: {
    type: Array as PropType<string[]>,
    default: () => [],
  },
  selection: {
    type: Object as PropType<RequestSelectionState>,
    default: () => ({}),
  },
})

const emit = defineEmits<{
  (e: "update:modelValue", value: string[]): void
  (e: "update:selection", value: RequestSelectionState): void
}>()

/**
 * Flatten the collection into an ordered array of FlatRequest items.
 * Traversal order: folders first, then requests (matching the runner's natural order).
 */
const flattenCollection = (collection: HoppCollection): FlatRequest[] => {
  const result: FlatRequest[] = []

  const traverse = (
    node: HoppCollection,
    parentPath: string,
    folderNames: string[]
  ) => {
    // Process folders first (matches runner's traversal order)
    node.folders.forEach((folder, folderIdx) => {
      const folderSegment = parentPath
        ? `${parentPath}/folder_${folderIdx}`
        : `folder_${folderIdx}`
      traverse(folder as HoppCollection, folderSegment, [
        ...folderNames,
        folder.name,
      ])
    })

    // Then requests
    node.requests.forEach((request, reqIdx) => {
      const reqPath = parentPath
        ? `${parentPath}/request_${reqIdx}`
        : `request_${reqIdx}`
      result.push({
        path: reqPath,
        name: request.name,
        method: (request as HoppRESTRequest).method || "GET",
        folderPath: folderNames,
      })
    })
  }

  traverse(collection, "", [])
  return result
}

/**
 * Build the items list respecting the provided model order.
 * If modelValue has paths, use that order; otherwise use natural order.
 * Any new paths not in modelValue are appended at the end.
 */
const buildItemsFromOrder = (): FlatRequest[] => {
  const allItems = flattenCollection(props.collection)
  const allItemMap = new Map(allItems.map((item) => [item.path, item]))

  if (props.modelValue.length > 0) {
    const ordered: FlatRequest[] = []

    for (const path of props.modelValue) {
      const item = allItemMap.get(path)
      if (item) ordered.push(item)
    }

    // Append any new items not yet in the order
    for (const item of allItems) {
      if (!props.modelValue.includes(item.path)) {
        ordered.push(item)
      }
    }

    return ordered
  }

  return allItems
}

const items = ref<FlatRequest[]>(buildItemsFromOrder())

// Rebuild when collection changes (e.g., collection reloads)
watch(
  () => props.collection,
  () => {
    items.value = buildItemsFromOrder()
  },
  { deep: true }
)

// Emit order changes when items are reordered via drag-and-drop
watch(
  items,
  () => {
    emit(
      "update:modelValue",
      items.value.map((item) => item.path)
    )
  },
  { deep: true }
)

const isSelected = (path: string): boolean => props.selection[path] ?? false

const toggleSelection = (path: string) => {
  emit("update:selection", {
    ...props.selection,
    [path]: !props.selection[path],
  })
}

const selectAll = () => {
  const newState: RequestSelectionState = {}
  items.value.forEach((item) => {
    newState[item.path] = true
  })
  emit("update:selection", newState)
}

const deselectAll = () => {
  const newState: RequestSelectionState = {}
  items.value.forEach((item) => {
    newState[item.path] = false
  })
  emit("update:selection", newState)
}

const resetOrder = () => {
  items.value = flattenCollection(props.collection)
}

const selectedCount = computed(
  () => items.value.filter((item) => isSelected(item.path)).length
)

const methodClass = (method: string): string => {
  const m = (method || "GET").toUpperCase()
  if (m === "GET") return "bg-green-500/10 text-green-500"
  if (m === "POST") return "bg-yellow-500/10 text-yellow-500"
  if (m === "PUT") return "bg-blue-500/10 text-blue-500"
  if (m === "DELETE") return "bg-red-500/10 text-red-500"
  if (m === "PATCH") return "bg-orange-500/10 text-orange-500"
  if (m === "HEAD") return "bg-purple-500/10 text-purple-500"
  return "bg-gray-500/10 text-gray-500"
}
</script>
