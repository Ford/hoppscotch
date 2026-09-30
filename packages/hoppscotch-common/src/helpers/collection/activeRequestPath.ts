import type { HoppTabSaveContext } from "~/helpers/tab/document"

export const isInActiveRequestPath = (
  collectionPath: string,
  requestFolderPath: string
): boolean =>
  requestFolderPath === collectionPath ||
  requestFolderPath.startsWith(`${collectionPath}/`)

export const isActiveSavedRequest = (
  context: HoppTabSaveContext | false | undefined,
  origin: "user-collection" | "team-collection",
  folderPath: string,
  requestID: string
): boolean => {
  if (!context || context.exampleID !== undefined || !requestID) return false

  if (origin === "user-collection")
    return (
      context.originLocation === origin &&
      context.folderPath === folderPath &&
      context.requestRefID === requestID
    )

  return (
    context.originLocation === origin &&
    context.collectionID === folderPath &&
    context.requestID === requestID
  )
}
