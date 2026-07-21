/**
 * Pure utility functions for the Global Environment import merge logic.
 *
 * Keeping these separate from the Vue component makes the three scenarios
 * independently unit-testable without mounting any UI:
 *
 *  Scenario 1 – New variable (key not in existing)  → auto-accept
 *  Scenario 2 – Existing, both initialValue AND currentValue match  → ignore
 *  Scenario 3 – Existing, any value differs  → conflict (user decides)
 */

import type { GlobalEnvironmentVariable } from "@hoppscotch/data"

// ── Public types ──────────────────────────────────────────────────────────────

export type ConflictItem = {
  key: string
  /** initialValue currently in the persistent store */
  existingInitialValue: string
  /** Runtime currentValue from CurrentValueService (NOT the stripped store value) */
  existingCurrentValue: string
  /** initialValue coming from the imported file */
  newInitialValue: string
  /** currentValue coming from the imported file */
  newCurrentValue: string
  secret: boolean
  choice: "keep" | "use-new"
}

export type MergeAnalysis = {
  /** Variables whose key is absent from the existing globals — will be appended */
  newVariables: GlobalEnvironmentVariable[]
  /** Variables whose key exists but at least one value differs */
  conflictItems: ConflictItem[]
  /** Count of variables that were identical on both sides — silently skipped */
  ignoredCount: number
}

// ── Core functions ────────────────────────────────────────────────────────────

/**
 * Analyse imported variables against the current global environment and
 * classify each into one of the three scenarios.
 *
 * @param importedVars   Variables parsed from the import file.
 * @param existingVars   Current global variables (from `getGlobalVariables()`).
 * @param getRuntimeCurrentValue
 *   Callback that returns the REAL runtime currentValue for an existing
 *   variable — i.e. from `CurrentValueService`, not the stripped store value.
 *   Receive `(key, isSecret)` and return `""` when the variable has no
 *   runtime override yet.
 */
export function analyzeGlobalImport(
  importedVars: GlobalEnvironmentVariable[],
  existingVars: GlobalEnvironmentVariable[],
  getRuntimeCurrentValue: (key: string, isSecret: boolean) => string
): MergeAnalysis {
  const newVariables: GlobalEnvironmentVariable[] = []
  const conflictItems: ConflictItem[] = []
  let ignoredCount = 0

  for (const incoming of importedVars) {
    const existingVar = existingVars.find((e) => e.key === incoming.key)

    if (!existingVar) {
      // ── Scenario 1: brand-new key ────────────────────────────────────────
      newVariables.push(incoming)
    } else {
      // The persistent store always strips currentValue to "".
      // Read the real runtime value via the provided callback.
      const runtimeCurrentValue = getRuntimeCurrentValue(
        existingVar.key,
        existingVar.secret
      )

      if (
        existingVar.initialValue === incoming.initialValue &&
        runtimeCurrentValue === incoming.currentValue
      ) {
        // ── Scenario 2: exact match on both values ────────────────────────
        ignoredCount++
      } else {
        // ── Scenario 3: at least one value differs ────────────────────────
        conflictItems.push({
          key: incoming.key,
          existingInitialValue: existingVar.initialValue,
          existingCurrentValue: runtimeCurrentValue,
          newInitialValue: incoming.initialValue,
          newCurrentValue: incoming.currentValue,
          secret: incoming.secret,
          choice: "keep",
        })
      }
    }
  }

  return { newVariables, conflictItems, ignoredCount }
}

/**
 * Build the final variable list that should be persisted after the user has
 * resolved all conflicts.
 *
 * @param existingVars   Current global variables (from `getGlobalVariables()`).
 * @param conflicts      Conflict items with user-chosen `choice` filled in.
 * @param newVars        Brand-new variables from the import (Scenario 1).
 * @param getRuntimeCurrentValue
 *   Same callback as `analyzeGlobalImport` — used to restore the real
 *   runtime currentValue for variables the user chose to **keep**, so that
 *   `promoteInitialValueForImport` does not mistakenly overwrite it with
 *   `initialValue`.
 */
export function resolveGlobalImport(
  existingVars: GlobalEnvironmentVariable[],
  conflicts: ConflictItem[],
  newVars: GlobalEnvironmentVariable[],
  getRuntimeCurrentValue: (key: string, isSecret: boolean) => string
): GlobalEnvironmentVariable[] {
  const resolvedExisting = existingVars.map((existingVar) => {
    const conflict = conflicts.find((c) => c.key === existingVar.key)

    if (conflict && conflict.choice === "use-new") {
      // User chose to replace — apply imported values
      return {
        ...existingVar,
        initialValue: conflict.newInitialValue,
        currentValue: conflict.newCurrentValue,
      }
    }

    // "keep" or non-conflict variable — restore the real runtime currentValue
    // so promoteInitialValueForImport does not flatten it to initialValue
    const runtimeCurrentValue = getRuntimeCurrentValue(
      existingVar.key,
      existingVar.secret
    )
    return {
      ...existingVar,
      currentValue: runtimeCurrentValue,
    }
  })

  return [...resolvedExisting, ...newVars]
}

