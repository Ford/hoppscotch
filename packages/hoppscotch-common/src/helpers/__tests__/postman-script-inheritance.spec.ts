/**
 * Unit tests for Story 1 — Group 3: Collection & Folder Script Inheritance
 *
 * Tests cover the import-time flattening of Postman collection/folder scripts
 * into each request's own script fields during Postman collection import.
 *
 * Merge order: collectionScript + "\n\n" + folderScript + "\n\n" + requestScript
 *
 * File under test: src/helpers/import-export/import/postman.ts
 */

import { describe, expect, it } from "vitest"
import * as E from "fp-ts/Either"
import { hoppPostmanImporter } from "../import-export/import/postman"
import { HoppRESTRequest } from "@hoppscotch/data"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Runs the importer and returns the resolved collections or throws on failure.
 */
async function runImport(json: object, importScripts = true) {
  const task = hoppPostmanImporter([JSON.stringify(json)], importScripts)
  const result = await task()
  if (E.isLeft(result)) throw new Error("Import failed: invalid file format")
  return result.right
}

/**
 * Finds a request by name inside a flat or nested collection structure.
 */
function findRequest(
  collections: Awaited<ReturnType<typeof runImport>>,
  requestName: string
): HoppRESTRequest | undefined {
  for (const col of collections) {
    // Check direct requests
    for (const req of col.requests) {
      if (req.name === requestName) return req as HoppRESTRequest
    }
    // Check inside folders
    for (const folder of col.folders) {
      for (const req of folder.requests) {
        if (req.name === requestName) return req as HoppRESTRequest
      }
      // Check nested folders (one level deep)
      for (const nested of folder.folders) {
        for (const req of nested.requests) {
          if (req.name === requestName) return req as HoppRESTRequest
        }
      }
    }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Postman Collection JSON builders
// ---------------------------------------------------------------------------

const SCHEMA = "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"

const makeEvent = (listen: "prerequest" | "test", script: string) => ({
  listen,
  script: { exec: script.split("\n") },
})

const makeRequest = (name: string, events: object[] = []) => ({
  name,
  event: events,
  request: { method: "GET", url: "https://httpbin.org/get" },
})

const makeFolder = (name: string, items: object[], events: object[] = []) => ({
  name,
  event: events,
  item: items,
})

const makeCollection = (
  name: string,
  items: object[],
  events: object[] = []
) => ({
  info: { name, schema: SCHEMA },
  event: events,
  item: items,
})

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe("Postman Script Inheritance — mergeScripts (via importer output)", () => {
  it("TC-01: returns empty when both parent and child are empty", async () => {
    const json = makeCollection("C", [makeRequest("R")])
    const collections = await runImport(json)
    const req = findRequest(collections, "R") as HoppRESTRequest
    expect(req.preRequestScript).toBe("")
    expect(req.testScript).toBe("")
  })

  it("TC-02: returns parent only when child is empty", async () => {
    const collScript = "// collection script"
    const json = makeCollection("C", [makeRequest("R")], [
      makeEvent("prerequest", collScript),
    ])
    const collections = await runImport(json)
    const req = findRequest(collections, "R") as HoppRESTRequest
    expect(req.preRequestScript).toBe(collScript)
  })

  it("TC-03: returns child only when parent is empty", async () => {
    const reqScript = "// request script"
    const json = makeCollection("C", [
      makeRequest("R", [makeEvent("prerequest", reqScript)]),
    ])
    const collections = await runImport(json)
    const req = findRequest(collections, "R") as HoppRESTRequest
    expect(req.preRequestScript).toBe(reqScript)
  })

  it("TC-04: merges parent + child with double newline separator", async () => {
    const collScript = "// collection"
    const reqScript = "// request"
    const json = makeCollection(
      "C",
      [makeRequest("R", [makeEvent("prerequest", reqScript)])],
      [makeEvent("prerequest", collScript)]
    )
    const collections = await runImport(json)
    const req = findRequest(collections, "R") as HoppRESTRequest
    expect(req.preRequestScript).toBe(`${collScript}\n\n${reqScript}`)
  })
})

describe("Postman Script Inheritance — collection level", () => {
  it("TC-05: collection prerequest is prepended to every request in collection", async () => {
    const collPre = "// collection pre"
    const json = makeCollection(
      "C",
      [makeRequest("R1"), makeRequest("R2")],
      [makeEvent("prerequest", collPre)]
    )
    const collections = await runImport(json)
    const r1 = findRequest(collections, "R1") as HoppRESTRequest
    const r2 = findRequest(collections, "R2") as HoppRESTRequest
    expect(r1.preRequestScript).toBe(collPre)
    expect(r2.preRequestScript).toBe(collPre)
  })

  it("TC-06: collection test script is prepended to every request in collection", async () => {
    const collTest = "// collection test"
    const json = makeCollection(
      "C",
      [makeRequest("R1"), makeRequest("R2")],
      [makeEvent("test", collTest)]
    )
    const collections = await runImport(json)
    const r1 = findRequest(collections, "R1") as HoppRESTRequest
    const r2 = findRequest(collections, "R2") as HoppRESTRequest
    expect(r1.testScript).toBe(collTest)
    expect(r2.testScript).toBe(collTest)
  })

  it("TC-07: collection script does NOT affect requests when importScripts=false", async () => {
    const collPre = "// collection pre"
    const json = makeCollection(
      "C",
      [makeRequest("R")],
      [makeEvent("prerequest", collPre)]
    )
    const collections = await runImport(json, false) // importScripts = false
    const req = findRequest(collections, "R") as HoppRESTRequest
    expect(req.preRequestScript).toBe("")
  })
})

describe("Postman Script Inheritance — folder level", () => {
  it("TC-08: folder prerequest is prepended to every request inside that folder", async () => {
    const folderPre = "// folder pre"
    const json = makeCollection("C", [
      makeFolder("F", [makeRequest("R1"), makeRequest("R2")], [
        makeEvent("prerequest", folderPre),
      ]),
    ])
    const collections = await runImport(json)
    const r1 = findRequest(collections, "R1") as HoppRESTRequest
    const r2 = findRequest(collections, "R2") as HoppRESTRequest
    expect(r1.preRequestScript).toBe(folderPre)
    expect(r2.preRequestScript).toBe(folderPre)
  })

  it("TC-09: folder script does NOT affect requests outside that folder", async () => {
    const folderPre = "// folder pre"
    const json = makeCollection("C", [
      makeFolder("F", [makeRequest("InsideFolder")], [
        makeEvent("prerequest", folderPre),
      ]),
      makeRequest("OutsideFolder"),
    ])
    const collections = await runImport(json)
    const outside = findRequest(collections, "OutsideFolder") as HoppRESTRequest
    expect(outside.preRequestScript).toBe("")
  })
})

describe("Postman Script Inheritance — request level", () => {
  it("TC-10: request-only script is preserved unchanged when no parent scripts", async () => {
    const reqScript = "// only request"
    const json = makeCollection("C", [
      makeRequest("R", [makeEvent("prerequest", reqScript)]),
    ])
    const collections = await runImport(json)
    const req = findRequest(collections, "R") as HoppRESTRequest
    expect(req.preRequestScript).toBe(reqScript)
  })
})

describe("Postman Script Inheritance — all 3 levels combined", () => {
  it("TC-11: correct merge order is collection → folder → request", async () => {
    const collPre = "// collection pre"
    const folderPre = "// folder pre"
    const reqPre = "// request pre"

    const json = makeCollection(
      "C",
      [
        makeFolder("F", [
          makeRequest("R", [makeEvent("prerequest", reqPre)]),
        ], [makeEvent("prerequest", folderPre)]),
      ],
      [makeEvent("prerequest", collPre)]
    )

    const collections = await runImport(json)
    const req = findRequest(collections, "R") as HoppRESTRequest
    expect(req.preRequestScript).toBe(`${collPre}\n\n${folderPre}\n\n${reqPre}`)
  })

  it("TC-12: test scripts also merge in correct order: collection → folder → request", async () => {
    const collTest = "// collection test"
    const folderTest = "// folder test"
    const reqTest = "// request test"

    const json = makeCollection(
      "C",
      [
        makeFolder("F", [
          makeRequest("R", [makeEvent("test", reqTest)]),
        ], [makeEvent("test", folderTest)]),
      ],
      [makeEvent("test", collTest)]
    )

    const collections = await runImport(json)
    const req = findRequest(collections, "R") as HoppRESTRequest
    expect(req.testScript).toBe(`${collTest}\n\n${folderTest}\n\n${reqTest}`)
  })

  it("TC-13: request with no own script gets collection+folder scripts only", async () => {
    const collPre = "// collection pre"
    const folderPre = "// folder pre"

    const json = makeCollection(
      "C",
      [
        makeFolder("F", [
          makeRequest("R"), // no own script
        ], [makeEvent("prerequest", folderPre)]),
      ],
      [makeEvent("prerequest", collPre)]
    )

    const collections = await runImport(json)
    const req = findRequest(collections, "R") as HoppRESTRequest
    expect(req.preRequestScript).toBe(`${collPre}\n\n${folderPre}`)
  })
})

describe("Postman Script Inheritance — nested folders", () => {
  it("TC-14: nested folder scripts inherit from both parent folder and collection", async () => {
    const collPre = "// collection pre"
    const outerFolderPre = "// outer folder pre"
    const innerFolderPre = "// inner folder pre"
    const reqPre = "// request pre"

    const json = makeCollection(
      "C",
      [
        makeFolder("Outer", [
          makeFolder("Inner", [
            makeRequest("R", [makeEvent("prerequest", reqPre)]),
          ], [makeEvent("prerequest", innerFolderPre)]),
        ], [makeEvent("prerequest", outerFolderPre)]),
      ],
      [makeEvent("prerequest", collPre)]
    )

    const collections = await runImport(json)
    const req = findRequest(collections, "R") as HoppRESTRequest
    expect(req.preRequestScript).toBe(
      `${collPre}\n\n${outerFolderPre}\n\n${innerFolderPre}\n\n${reqPre}`
    )
  })

  it("TC-15: request in outer folder does not get inner folder scripts", async () => {
    const outerFolderPre = "// outer folder pre"
    const innerFolderPre = "// inner folder pre"

    const json = makeCollection("C", [
      makeFolder("Outer", [
        makeRequest("OuterRequest"), // directly in outer folder
        makeFolder("Inner", [
          makeRequest("InnerRequest"),
        ], [makeEvent("prerequest", innerFolderPre)]),
      ], [makeEvent("prerequest", outerFolderPre)]),
    ])

    const collections = await runImport(json)
    const outerReq = findRequest(collections, "OuterRequest") as HoppRESTRequest
    const innerReq = findRequest(collections, "InnerRequest") as HoppRESTRequest

    // OuterRequest only gets outer folder script
    expect(outerReq.preRequestScript).toBe(outerFolderPre)
    // InnerRequest gets outer + inner folder scripts
    expect(innerReq.preRequestScript).toBe(`${outerFolderPre}\n\n${innerFolderPre}`)
  })
})

describe("Postman Script Inheritance — edge cases", () => {
  it("TC-16: exec array with multiple lines is joined correctly", async () => {
    const json = makeCollection("C", [makeRequest("R")], [
      {
        listen: "prerequest",
        script: {
          exec: ["// line 1", "// line 2", "// line 3"],
        },
      },
    ])
    const collections = await runImport(json)
    const req = findRequest(collections, "R") as HoppRESTRequest
    expect(req.preRequestScript).toBe("// line 1\n// line 2\n// line 3")
  })

  it("TC-17: whitespace-only scripts are treated as empty (no merge separator added)", async () => {
    const json = makeCollection("C", [
      makeRequest("R", [makeEvent("prerequest", "   ")]),
    ], [makeEvent("prerequest", "// collection pre")])
    const collections = await runImport(json)
    const req = findRequest(collections, "R") as HoppRESTRequest
    // child is whitespace-only → trimmed to "" → only parent returned
    expect(req.preRequestScript).toBe("// collection pre")
  })

  it("TC-18: no scripts at any level → all script fields are empty", async () => {
    const json = makeCollection("C", [
      makeFolder("F", [makeRequest("R")]),
    ])
    const collections = await runImport(json)
    const req = findRequest(collections, "R") as HoppRESTRequest
    expect(req.preRequestScript).toBe("")
    expect(req.testScript).toBe("")
  })
})

// ---------------------------------------------------------------------------
// NEW: TC-19 to TC-26 — Scripts stored on collection / folder objects
// These verify that imported scripts are visible in the Properties dialog
// (i.e. stored on the HoppCollection object itself, not just in requests).
// ---------------------------------------------------------------------------

describe("Collection & Folder Properties script storage (TC-19 to TC-26)", () => {
  it("TC-19: collection pre-request script is stored on the collection object", async () => {
    const json = makeCollection("C", [makeRequest("R")], [
      makeEvent("prerequest", "// col pre"),
    ])
    const collections = await runImport(json)
    expect((collections[0] as any).preRequestScript).toBe("// col pre")
  })

  it("TC-20: collection test script is stored on the collection object", async () => {
    const json = makeCollection("C", [makeRequest("R")], [
      makeEvent("test", "// col test"),
    ])
    const collections = await runImport(json)
    expect((collections[0] as any).testScript).toBe("// col test")
  })

  it("TC-21: folder pre-request script is stored on the folder object (own script only, not merged)", async () => {
    const json = makeCollection(
      "C",
      [makeFolder("F", [makeRequest("R")], [makeEvent("prerequest", "// folder pre")])],
      [makeEvent("prerequest", "// col pre")]
    )
    const collections = await runImport(json)
    const folder = collections[0].folders[0]
    // folder object must hold ONLY the folder's own script
    expect((folder as any).preRequestScript).toBe("// folder pre")
    // it must NOT contain the collection script (that only goes into requests)
    expect((folder as any).preRequestScript).not.toContain("// col pre")
  })

  it("TC-22: folder test script is stored on the folder object", async () => {
    const json = makeCollection(
      "C",
      [makeFolder("F", [makeRequest("R")], [makeEvent("test", "// folder test")])],
    )
    const collections = await runImport(json)
    const folder = collections[0].folders[0]
    expect((folder as any).testScript).toBe("// folder test")
  })

  it("TC-23: collection with no scripts → collection preRequestScript is empty string", async () => {
    const json = makeCollection("C", [makeRequest("R")])
    const collections = await runImport(json)
    expect((collections[0] as any).preRequestScript).toBe("")
    expect((collections[0] as any).testScript).toBe("")
  })

  it("TC-24: folder with no scripts → folder preRequestScript is empty string", async () => {
    const json = makeCollection("C", [makeFolder("F", [makeRequest("R")])])
    const collections = await runImport(json)
    const folder = collections[0].folders[0]
    expect((folder as any).preRequestScript).toBe("")
    expect((folder as any).testScript).toBe("")
  })

  it("TC-25: importScripts=false → collection and folder script fields are empty", async () => {
    const json = makeCollection(
      "C",
      [makeFolder("F", [makeRequest("R")], [makeEvent("prerequest", "// folder pre")])],
      [makeEvent("prerequest", "// col pre")]
    )
    const collections = await runImport(json, false)
    expect((collections[0] as any).preRequestScript).toBe("")
    expect((collections[0] as any).testScript).toBe("")
    const folder = collections[0].folders[0]
    expect((folder as any).preRequestScript).toBe("")
    expect((folder as any).testScript).toBe("")
  })

  it("TC-26: request still gets fully merged script AND collection/folder hold their own scripts independently", async () => {
    const json = makeCollection(
      "C",
      [
        makeFolder(
          "F",
          [makeRequest("R", [makeEvent("prerequest", "// req pre")])],
          [makeEvent("prerequest", "// folder pre")]
        ),
      ],
      [makeEvent("prerequest", "// col pre")]
    )
    const collections = await runImport(json)

    // Collection holds its own script
    expect((collections[0] as any).preRequestScript).toBe("// col pre")

    // Folder holds its own script only
    const folder = collections[0].folders[0]
    expect((folder as any).preRequestScript).toBe("// folder pre")

    // Request gets the fully merged chain
    const req = findRequest(collections, "R") as HoppRESTRequest
    expect(req.preRequestScript).toBe("// col pre\n\n// folder pre\n\n// req pre")
  })
})


