import { describe, expect, it } from "vitest"
import {
  isActiveSavedRequest,
  isInActiveRequestPath,
} from "../activeRequestPath"

describe("isInActiveRequestPath", () => {
  it("marks a request's collection and each ancestor folder", () => {
    const requestFolderPath = "collection/folder/subfolder"

    expect(isInActiveRequestPath("collection", requestFolderPath)).toBe(true)
    expect(isInActiveRequestPath("collection/folder", requestFolderPath)).toBe(
      true
    )
    expect(
      isInActiveRequestPath("collection/folder/subfolder", requestFolderPath)
    ).toBe(true)
  })

  describe("isActiveSavedRequest", () => {
    it("matches personal requests only when both path and reference ID match", () => {
      const context = {
        originLocation: "user-collection" as const,
        folderPath: "1/0",
        requestIndex: 0,
        requestRefID: "copied-request",
      }

      expect(
        isActiveSavedRequest(
          context,
          "user-collection",
          "1/0",
          "copied-request"
        )
      ).toBe(true)
      expect(
        isActiveSavedRequest(
          context,
          "user-collection",
          "0/0",
          "copied-request"
        )
      ).toBe(false)
      expect(
        isActiveSavedRequest(
          context,
          "user-collection",
          "1/0",
          "original-request"
        )
      ).toBe(false)
      expect(isActiveSavedRequest(context, "user-collection", "1/0", "")).toBe(
        false
      )
    })

    it("matches team requests only within their collection path", () => {
      const context = {
        originLocation: "team-collection" as const,
        collectionID: "team/duplicate/folder",
        requestID: "copied-request",
      }

      expect(
        isActiveSavedRequest(
          context,
          "team-collection",
          "team/duplicate/folder",
          "copied-request"
        )
      ).toBe(true)
      expect(
        isActiveSavedRequest(
          context,
          "team-collection",
          "team/original/folder",
          "copied-request"
        )
      ).toBe(false)
      expect(
        isActiveSavedRequest(
          context,
          "user-collection",
          "team/duplicate/folder",
          "copied-request"
        )
      ).toBe(false)
    })

    it("does not mark saved examples or unbound requests as active", () => {
      const context = {
        originLocation: "user-collection" as const,
        folderPath: "1/0",
        requestRefID: "copied-request",
        exampleID: "example",
      }

      expect(
        isActiveSavedRequest(
          context,
          "user-collection",
          "1/0",
          "copied-request"
        )
      ).toBe(false)
      expect(
        isActiveSavedRequest(null, "user-collection", "1/0", "copied-request")
      ).toBe(false)
    })
  })

  it("does not mark siblings or paths with a shared prefix", () => {
    const requestFolderPath = "collection/folder/subfolder"

    expect(isInActiveRequestPath("collection/other", requestFolderPath)).toBe(
      false
    )
    expect(isInActiveRequestPath("collect", requestFolderPath)).toBe(false)
    expect(isInActiveRequestPath("collection/fold", requestFolderPath)).toBe(
      false
    )
    expect(
      isInActiveRequestPath(
        "collection/folder/subfolder/child",
        requestFolderPath
      )
    ).toBe(false)
  })
})
