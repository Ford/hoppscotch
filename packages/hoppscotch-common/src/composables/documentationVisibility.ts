import { computed } from "vue"

/**
 * Composable to determine documentation visibility based on experimental flags
 */
export function useDocumentationVisibility() {
  /**
   * Check if documentation should be visible based on experimental flag
   * Currently disabled as experimental documentation feature has been removed
   */
  const isDocumentationVisible = computed(() => false)

  return {
    isDocumentationVisible,
  }
}
