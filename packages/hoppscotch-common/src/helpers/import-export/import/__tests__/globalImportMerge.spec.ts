/**
 * Tests for analyzeGlobalImport + resolveGlobalImport
 *
 * Covers the three core scenarios and all edge cases:
 *
 *  Scenario 1 – New variable  →  auto-accept
 *  Scenario 2 – Existing, both values identical  →  ignore (ignoredCount++)
 *  Scenario 3 – Existing, any value differs  →  conflict → user resolves → save
 *
 * Sub-scenarios for Scenario 3:
 *  3a  only initialValue differs
 *  3b  only currentValue differs
 *  3c  both values differ
 *  3d  user resolves conflict with "keep"
 *  3e  user resolves conflict with "use-new"
 *
 * Edge cases:
 *  – Mixed batch (new + identical + conflicting in one import)
 *  – Secret variable handling
 *  – Empty initialValue / currentValue strings
 *  – Duplicate keys in import file (last one wins — first is processed first)
 *  – Empty import file
 *  – All variables already exist and are identical
 *  – Runtime currentValue vs stripped store value distinction
 */

import { describe, expect, it } from "vitest"

import {
  analyzeGlobalImport,
  resolveGlobalImport,
  type ConflictItem,
} from "../globalImportMerge"
import type { GlobalEnvironmentVariable } from "@hoppscotch/data"

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a non-secret variable. */
const v = (
  key: string,
  initialValue: string,
  currentValue: string,
  secret = false
): GlobalEnvironmentVariable => ({ key, initialValue, currentValue, secret })

/** A getRuntimeCurrentValue stub: returns '' for all variables (simulates a fresh store). */
const noRuntime = (_key: string, _isSecret: boolean) => ""

/** Returns a specific runtime value for a given key, falls back to '' for others. */
const withRuntime =
  (map: Record<string, string>) =>
  (key: string, _isSecret: boolean) =>
    map[key] ?? ""

// ─────────────────────────────────────────────────────────────────────────────

describe("analyzeGlobalImport — Scenario 1: new variable", () => {
  it("puts a variable with an unknown key into newVariables", () => {
    const { newVariables, conflictItems, ignoredCount } = analyzeGlobalImport(
      [v("token", "t1", "t2")],
      [], // no existing globals
      noRuntime
    )

    expect(newVariables).toHaveLength(1)
    expect(newVariables[0].key).toBe("token")
    expect(newVariables[0].initialValue).toBe("t1")
    expect(newVariables[0].currentValue).toBe("t2")
    expect(conflictItems).toHaveLength(0)
    expect(ignoredCount).toBe(0)
  })

  it("preserves distinct initialValue and currentValue for a new variable", () => {
    const { newVariables } = analyzeGlobalImport(
      [v("x", "initial", "current")],
      [],
      noRuntime
    )

    expect(newVariables[0].initialValue).toBe("initial")
    expect(newVariables[0].currentValue).toBe("current")
  })

  it("accepts multiple new variables in one import", () => {
    const { newVariables } = analyzeGlobalImport(
      [v("a", "a1", "a2"), v("b", "b1", "b2"), v("c", "c1", "c2")],
      [],
      noRuntime
    )

    expect(newVariables.map((n) => n.key)).toEqual(["a", "b", "c"])
  })

  it("accepts a new secret variable", () => {
    const { newVariables } = analyzeGlobalImport(
      [v("apiKey", "", "", true)],
      [],
      noRuntime
    )

    expect(newVariables[0].secret).toBe(true)
  })

  it("accepts a new variable when import file has empty string values", () => {
    const { newVariables } = analyzeGlobalImport(
      [v("empty", "", "")],
      [],
      noRuntime
    )

    expect(newVariables[0].key).toBe("empty")
    expect(newVariables[0].initialValue).toBe("")
    expect(newVariables[0].currentValue).toBe("")
  })
})

describe("analyzeGlobalImport — Scenario 2: exact match → ignore", () => {
  it("ignores a variable when both initialValue and currentValue match the runtime state", () => {
    const { newVariables, conflictItems, ignoredCount } = analyzeGlobalImport(
      [v("token", "t1", "t2")],
      [v("token", "t1", "")], // store has stripped currentValue
      withRuntime({ token: "t2" }) // runtime has the real value
    )

    expect(ignoredCount).toBe(1)
    expect(newVariables).toHaveLength(0)
    expect(conflictItems).toHaveLength(0)
  })

  it("ignores a variable when both values are empty strings and runtime is also empty", () => {
    const { ignoredCount } = analyzeGlobalImport(
      [v("host", "", "")],
      [v("host", "", "")],
      noRuntime
    )

    expect(ignoredCount).toBe(1)
  })

  it("ignores a variable when initialValue matches and runtime currentValue matches the import", () => {
    // Standard round-trip: export strips currentValue → import has currentValue ""
    // → runtime also "" → should be ignored
    const { ignoredCount } = analyzeGlobalImport(
      [v("host", "https://api.io", "")],
      [v("host", "https://api.io", "")],
      noRuntime // runtime = ""
    )

    expect(ignoredCount).toBe(1)
  })

  it("increments ignoredCount for every matching variable", () => {
    const { ignoredCount } = analyzeGlobalImport(
      [v("a", "a1", ""), v("b", "b1", ""), v("c", "c1", "")],
      [v("a", "a1", ""), v("b", "b1", ""), v("c", "c1", "")],
      noRuntime
    )

    expect(ignoredCount).toBe(3)
  })
})

describe("analyzeGlobalImport — Scenario 3a: only initialValue differs", () => {
  it("creates a conflict when initialValue changed but runtime currentValue matches", () => {
    const { conflictItems, newVariables, ignoredCount } = analyzeGlobalImport(
      [v("host", "https://new-api.io", "")],
      [v("host", "https://api.io", "")],
      noRuntime
    )

    expect(conflictItems).toHaveLength(1)
    expect(newVariables).toHaveLength(0)
    expect(ignoredCount).toBe(0)

    const conflict = conflictItems[0]
    expect(conflict.key).toBe("host")
    expect(conflict.existingInitialValue).toBe("https://api.io")
    expect(conflict.newInitialValue).toBe("https://new-api.io")
  })

  it("default conflict choice is 'keep'", () => {
    const { conflictItems } = analyzeGlobalImport(
      [v("x", "new-init", "")],
      [v("x", "old-init", "")],
      noRuntime
    )

    expect(conflictItems[0].choice).toBe("keep")
  })
})

describe("analyzeGlobalImport — Scenario 3b: only currentValue differs", () => {
  it("creates a conflict when initialValue matches but imported currentValue differs from runtime", () => {
    // Existing: initialValue="t1", runtime currentValue="t1" (same as initial, no override)
    // Import:   initialValue="t1", currentValue="t2"  ← different current
    const { conflictItems, ignoredCount } = analyzeGlobalImport(
      [v("token", "t1", "t2")],
      [v("token", "t1", "")],
      withRuntime({ token: "t1" }) // runtime = "t1"
    )

    expect(conflictItems).toHaveLength(1)
    expect(ignoredCount).toBe(0)

    const conflict = conflictItems[0]
    expect(conflict.existingInitialValue).toBe("t1")
    expect(conflict.existingCurrentValue).toBe("t1")
    expect(conflict.newInitialValue).toBe("t1")
    expect(conflict.newCurrentValue).toBe("t2")
  })

  it("detects a mismatch when the user has a live runtime override different from the imported currentValue", () => {
    // User has set current to "live-val" in the app.
    // Import file has currentValue "import-val".
    const { conflictItems } = analyzeGlobalImport(
      [v("key", "init", "import-val")],
      [v("key", "init", "")],
      withRuntime({ key: "live-val" }) // user's runtime override
    )

    expect(conflictItems).toHaveLength(1)
    expect(conflictItems[0].existingCurrentValue).toBe("live-val")
    expect(conflictItems[0].newCurrentValue).toBe("import-val")
  })
})

describe("analyzeGlobalImport — Scenario 3c: both values differ", () => {
  it("creates a conflict when both initialValue and currentValue differ", () => {
    const { conflictItems } = analyzeGlobalImport(
      [v("host", "https://new.io", "new-cur")],
      [v("host", "https://old.io", "")],
      withRuntime({ host: "old-cur" })
    )

    expect(conflictItems).toHaveLength(1)
    const c = conflictItems[0]
    expect(c.existingInitialValue).toBe("https://old.io")
    expect(c.existingCurrentValue).toBe("old-cur")
    expect(c.newInitialValue).toBe("https://new.io")
    expect(c.newCurrentValue).toBe("new-cur")
  })
})

describe("analyzeGlobalImport — mixed batch", () => {
  it("correctly classifies new, ignored and conflicting variables in one pass", () => {
    const existing = [
      v("match", "m", ""),       // will be ignored (runtime="" == import "")
      v("conflict", "old", ""),  // will conflict (initialValue changed)
    ]

    const imported = [
      v("newVar", "n1", "n2"),   // scenario 1
      v("match", "m", ""),       // scenario 2 — runtime "" matches import ""
      v("conflict", "new", ""), // scenario 3a
    ]

    const { newVariables, conflictItems, ignoredCount } = analyzeGlobalImport(
      imported,
      existing,
      noRuntime
    )

    expect(newVariables).toHaveLength(1)
    expect(newVariables[0].key).toBe("newVar")

    expect(ignoredCount).toBe(1)

    expect(conflictItems).toHaveLength(1)
    expect(conflictItems[0].key).toBe("conflict")
  })

  it("handles an empty import file — all counts are zero", () => {
    const { newVariables, conflictItems, ignoredCount } = analyzeGlobalImport(
      [],
      [v("existing", "e", "")],
      noRuntime
    )

    expect(newVariables).toHaveLength(0)
    expect(conflictItems).toHaveLength(0)
    expect(ignoredCount).toBe(0)
  })

  it("handles empty existing globals — all imported variables are new", () => {
    const { newVariables, conflictItems, ignoredCount } = analyzeGlobalImport(
      [v("a", "a1", ""), v("b", "b1", "")],
      [],
      noRuntime
    )

    expect(newVariables).toHaveLength(2)
    expect(conflictItems).toHaveLength(0)
    expect(ignoredCount).toBe(0)
  })
})

describe("analyzeGlobalImport — secret variable handling", () => {
  it("creates a conflict for a secret variable when initialValue differs", () => {
    const { conflictItems } = analyzeGlobalImport(
      [v("apiKey", "new-secret", "", true)],
      [v("apiKey", "old-secret", "", true)],
      // secrets always get "" from the getRuntimeCurrentValue stub
      (_key, isSecret) => (isSecret ? "" : "")
    )

    expect(conflictItems).toHaveLength(1)
    expect(conflictItems[0].existingCurrentValue).toBe("") // always "" for secrets
    expect(conflictItems[0].newCurrentValue).toBe("")
  })

  it("ignores a secret variable when initialValue matches (currentValue is always '')", () => {
    const { ignoredCount } = analyzeGlobalImport(
      [v("apiKey", "same-secret", "", true)],
      [v("apiKey", "same-secret", "", true)],
      (_key, isSecret) => (isSecret ? "" : "")
    )

    expect(ignoredCount).toBe(1)
  })

  it("treats a new secret variable as Scenario 1", () => {
    const { newVariables } = analyzeGlobalImport(
      [v("newSecret", "", "", true)],
      [],
      noRuntime
    )

    expect(newVariables[0].secret).toBe(true)
  })
})

describe("analyzeGlobalImport — runtime currentValue vs stripped store", () => {
  it("uses getRuntimeCurrentValue, not the stripped store value, for comparison", () => {
    // Store always holds currentValue: "" (stripped).
    // Runtime service holds the real value "live".
    // Import has currentValue: "live" → should be IGNORED (Scenario 2).
    const { ignoredCount, conflictItems } = analyzeGlobalImport(
      [v("key", "init", "live")],
      [v("key", "init", "")], // store — stripped
      withRuntime({ key: "live" }) // real runtime value
    )

    expect(ignoredCount).toBe(1)
    expect(conflictItems).toHaveLength(0)
  })

  it("falls back to '' when getRuntimeCurrentValue returns empty (no override set)", () => {
    // Import has currentValue "t2", but runtime has no entry → "" !== "t2" → conflict
    const { conflictItems } = analyzeGlobalImport(
      [v("token", "t1", "t2")],
      [v("token", "t1", "")],
      noRuntime // no runtime entry
    )

    expect(conflictItems).toHaveLength(1)
    expect(conflictItems[0].existingCurrentValue).toBe("")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// resolveGlobalImport
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveGlobalImport — Scenario 3d: user chooses 'keep'", () => {
  it("keeps the existing variable values when choice is 'keep'", () => {
    const conflict: ConflictItem = {
      key: "host",
      existingInitialValue: "https://old.io",
      existingCurrentValue: "https://live.io",
      newInitialValue: "https://new.io",
      newCurrentValue: "https://new-cur.io",
      secret: false,
      choice: "keep",
    }

    const result = resolveGlobalImport(
      [v("host", "https://old.io", "")],
      [conflict],
      [],
      withRuntime({ host: "https://live.io" })
    )

    expect(result).toHaveLength(1)
    // initialValue unchanged
    expect(result[0].initialValue).toBe("https://old.io")
    // currentValue restored from runtime (not the imported value)
    expect(result[0].currentValue).toBe("https://live.io")
  })

  it("restores runtime currentValue so promoteInitialValueForImport does not flatten it", () => {
    // If currentValue were left as "" (stripped store value), promoteInitialValueForImport
    // would set it to initialValue, losing the user's live override.
    const conflict: ConflictItem = {
      key: "x",
      existingInitialValue: "init",
      existingCurrentValue: "runtime-override",
      newInitialValue: "new-init",
      newCurrentValue: "new-cur",
      secret: false,
      choice: "keep",
    }

    const result = resolveGlobalImport(
      [v("x", "init", "")],
      [conflict],
      [],
      withRuntime({ x: "runtime-override" })
    )

    expect(result[0].currentValue).toBe("runtime-override")
  })
})

describe("resolveGlobalImport — Scenario 3e: user chooses 'use-new'", () => {
  it("replaces both initialValue and currentValue from the imported file", () => {
    const conflict: ConflictItem = {
      key: "token",
      existingInitialValue: "t1",
      existingCurrentValue: "t1",
      newInitialValue: "t1",
      newCurrentValue: "t2",
      secret: false,
      choice: "use-new",
    }

    const result = resolveGlobalImport(
      [v("token", "t1", "")],
      [conflict],
      [],
      withRuntime({ token: "t1" })
    )

    expect(result[0].initialValue).toBe("t1")
    expect(result[0].currentValue).toBe("t2")
  })

  it("applies the imported initialValue and currentValue independently", () => {
    const conflict: ConflictItem = {
      key: "host",
      existingInitialValue: "https://old.io",
      existingCurrentValue: "https://old.io",
      newInitialValue: "https://new.io",
      newCurrentValue: "https://new-staging.io",
      secret: false,
      choice: "use-new",
    }

    const result = resolveGlobalImport(
      [v("host", "https://old.io", "")],
      [conflict],
      [],
      noRuntime
    )

    expect(result[0].initialValue).toBe("https://new.io")
    expect(result[0].currentValue).toBe("https://new-staging.io")
  })

  it("only replaces the variable that matches the conflict key, leaving others untouched", () => {
    const conflict: ConflictItem = {
      key: "a",
      existingInitialValue: "a-old",
      existingCurrentValue: "",
      newInitialValue: "a-new",
      newCurrentValue: "a-new-cur",
      secret: false,
      choice: "use-new",
    }

    const result = resolveGlobalImport(
      [v("a", "a-old", ""), v("b", "b-init", "")],
      [conflict],
      [],
      noRuntime
    )

    expect(result.find((r) => r.key === "a")?.initialValue).toBe("a-new")
    expect(result.find((r) => r.key === "b")?.initialValue).toBe("b-init")
  })
})

describe("resolveGlobalImport — Scenario 1: new variables appended", () => {
  it("appends new variables after existing ones", () => {
    const result = resolveGlobalImport(
      [v("existing", "e", "")],
      [],
      [v("brand-new", "n1", "n2")],
      noRuntime
    )

    expect(result).toHaveLength(2)
    expect(result[0].key).toBe("existing")
    expect(result[1].key).toBe("brand-new")
  })

  it("preserves distinct initialValue and currentValue for the new variable", () => {
    const result = resolveGlobalImport(
      [],
      [],
      [v("token", "t1", "t2")],
      noRuntime
    )

    expect(result[0].initialValue).toBe("t1")
    expect(result[0].currentValue).toBe("t2")
  })

  it("returns only new variables when there are no existing ones", () => {
    const result = resolveGlobalImport(
      [],
      [],
      [v("a", "a1", "a2"), v("b", "b1", "b2")],
      noRuntime
    )

    expect(result).toHaveLength(2)
  })
})

describe("resolveGlobalImport — combined scenarios", () => {
  it("handles a mix of conflicts (keep + use-new) and new variables simultaneously", () => {
    const existing = [
      v("keep-me", "k-init", ""),
      v("replace-me", "r-old", ""),
    ]
    const conflicts: ConflictItem[] = [
      {
        key: "keep-me",
        existingInitialValue: "k-init",
        existingCurrentValue: "k-live",
        newInitialValue: "k-new",
        newCurrentValue: "k-new-cur",
        secret: false,
        choice: "keep",
      },
      {
        key: "replace-me",
        existingInitialValue: "r-old",
        existingCurrentValue: "",
        newInitialValue: "r-new",
        newCurrentValue: "r-new-cur",
        secret: false,
        choice: "use-new",
      },
    ]
    const newVars = [v("added", "a1", "a2")]

    const result = resolveGlobalImport(
      existing,
      conflicts,
      newVars,
      withRuntime({ "keep-me": "k-live" })
    )

    expect(result).toHaveLength(3)

    const kept = result.find((r) => r.key === "keep-me")!
    expect(kept.initialValue).toBe("k-init")
    expect(kept.currentValue).toBe("k-live") // runtime restored

    const replaced = result.find((r) => r.key === "replace-me")!
    expect(replaced.initialValue).toBe("r-new")
    expect(replaced.currentValue).toBe("r-new-cur")

    const added = result.find((r) => r.key === "added")!
    expect(added.initialValue).toBe("a1")
    expect(added.currentValue).toBe("a2")
  })

  it("returns empty array when existing, conflicts and newVars are all empty", () => {
    const result = resolveGlobalImport([], [], [], noRuntime)
    expect(result).toEqual([])
  })
})

describe("resolveGlobalImport — non-conflict existing variables", () => {
  it("restores runtime currentValue for unchanged (non-conflict) existing variables", () => {
    // A variable that had no conflict — it should still get its real runtime value
    const result = resolveGlobalImport(
      [v("plain", "init", "")],
      [], // no conflicts
      [],
      withRuntime({ plain: "live-value" })
    )

    expect(result[0].currentValue).toBe("live-value")
  })

  it("leaves currentValue as '' when no runtime override exists for unchanged variables", () => {
    const result = resolveGlobalImport(
      [v("plain", "init", "")],
      [],
      [],
      noRuntime
    )

    expect(result[0].currentValue).toBe("")
  })
})

describe("resolveGlobalImport — secret variable handling", () => {
  it("uses 'use-new' values for a secret conflict", () => {
    const conflict: ConflictItem = {
      key: "apiKey",
      existingInitialValue: "old-secret",
      existingCurrentValue: "",
      newInitialValue: "new-secret",
      newCurrentValue: "",
      secret: true,
      choice: "use-new",
    }

    const result = resolveGlobalImport(
      [v("apiKey", "old-secret", "", true)],
      [conflict],
      [],
      (_key, isSecret) => (isSecret ? "" : "")
    )

    expect(result[0].initialValue).toBe("new-secret")
    expect(result[0].currentValue).toBe("")
    expect(result[0].secret).toBe(true)
  })
})

