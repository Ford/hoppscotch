import { afterEach, describe, expect, test, vi } from "vitest"

// RequestRunner drags in the network/kernel stack; these tests drive the plan
// loop with `runTestRequest` stubbed out. `executedResponses$` must exist on
// the mock — newstore/history subscribes to it at module load.
vi.mock("~/helpers/RequestRunner", () => ({
  captureInitialEnvironmentState: vi.fn(),
  runTestRunnerRequest: vi.fn(),
  executedResponses$: { subscribe: vi.fn() },
}))

import { getService } from "~/modules/dioc"
import { TestRunnerService } from "../test-runner.service"

const service = getService(TestRunnerService)

afterEach(() => {
  vi.restoreAllMocks()
})

const entry = (name: string, id = `sel-${name}`) => ({
  id,
  request: { name, _ref_id: `req-${name}` },
  collection: { name: "coll" },
  folderPath: [],
  inheritedVariables: [],
  inheritedPreRequestScripts: [],
  inheritedTestScripts: [],
  inheritedHeaders: [],
})

const resolveIndex = (plan: unknown[], target: string) =>
  (service as any).resolveNextRequestIndex(plan, target)

/**
 * Drives `runPlan` with `runTestRequest` stubbed to return a scripted
 * `setNextRequest()` value per call, and records the executed order.
 */
const runPlanWith = async (
  plan: unknown[],
  nextRequestByCall: (string | null | undefined)[]
) => {
  const executed: string[] = []
  let call = 0

  const spy = vi
    .spyOn(service as any, "runTestRequest")
    .mockImplementation(async (...args: any[]) => {
      executed.push(args[1].name)
      return nextRequestByCall[call++]
    })

  const tab = { value: { document: { status: "running" } } } as any
  const meta = {} as any

  try {
    await (service as any).runPlan(
      tab,
      plan,
      { stopRef: { value: false } },
      meta,
      []
    )
  } finally {
    spy.mockRestore()
  }

  return { executed, status: tab.value.document.status }
}

describe("TestRunnerService.resolveNextRequestIndex", () => {
  const plan = [entry("login"), entry("fetch"), entry("logout")]

  test("resolves by request name", () => {
    expect(resolveIndex(plan, "logout")).toBe(2)
  })

  test("resolves by selection ID", () => {
    expect(resolveIndex(plan, "sel-fetch")).toBe(1)
  })

  test("returns -1 for an unknown target", () => {
    expect(resolveIndex(plan, "does-not-exist")).toBe(-1)
  })

  // Selection ID is unique per row while names are not, so an ID match has to
  // win — otherwise a script can never target a specific duplicate.
  test("prefers the selection ID over a same-named earlier request", () => {
    const dupes = [entry("step", "sel-a"), entry("step", "sel-b")]
    expect(resolveIndex(dupes, "sel-b")).toBe(1)
  })
})

describe("TestRunnerService.runPlan — pm.execution.setNextRequest()", () => {
  test("runs the plan in order when no script sets a next request", async () => {
    const { executed } = await runPlanWith(
      [entry("a"), entry("b"), entry("c")],
      [undefined, undefined, undefined]
    )

    expect(executed).toEqual(["a", "b", "c"])
  })

  test("jumps forward, skipping the requests in between", async () => {
    const { executed } = await runPlanWith(
      [entry("a"), entry("b"), entry("c")],
      ["c", undefined]
    )

    expect(executed).toEqual(["a", "c"])
  })

  test("jumps backward to repeat a request, then continues in order", async () => {
    const { executed } = await runPlanWith(
      [entry("a"), entry("b"), entry("c")],
      [undefined, "a", undefined, undefined, undefined]
    )

    expect(executed).toEqual(["a", "b", "a", "b", "c"])
  })

  test("setNextRequest(null) ends the iteration early without erroring", async () => {
    const { executed, status } = await runPlanWith(
      [entry("a"), entry("b"), entry("c")],
      [null]
    )

    expect(executed).toEqual(["a"])
    expect(status).toBe("running")
  })

  test("an unknown target is ignored and the run continues in order", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    const { executed } = await runPlanWith(
      [entry("a"), entry("b")],
      ["nope", undefined]
    )

    expect(executed).toEqual(["a", "b"])
    expect(warn).toHaveBeenCalled()
  })

  // Without the cap, two requests pointing at each other spin forever and
  // wedge the runner with no way out.
  test("caps runaway jump loops instead of hanging", async () => {
    const plan = [entry("a"), entry("b")]
    // "a" always sends the run back to itself.
    const alwaysJump = new Array(2000).fill("a")

    await expect(runPlanWith(plan, alwaysJump)).rejects.toThrow(
      /exceeded 1000 jumps/
    )
  })
})
