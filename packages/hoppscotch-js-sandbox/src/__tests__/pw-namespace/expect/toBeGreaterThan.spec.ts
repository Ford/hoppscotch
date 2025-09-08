import { describe, expect, test } from "vitest"
import { runTest, fakeResponse } from "~/utils/test-helpers"

describe("Comparison Expectations", () => {
  describe("toBeGreaterThan", () => {
    test("should pass when value is greater than expected", () => {
      return expect(
        runTest(
          `
            pw.test("greater than test", () => {
              pw.expect(10).toBeGreaterThan(5)
            })
          `,
          fakeResponse
        )()
      ).resolves.toEqualRight([
        expect.objectContaining({
          descriptor: "root",
          children: [
            expect.objectContaining({
              descriptor: "greater than test",
              expectResults: [
                { status: "pass", message: expect.stringContaining("10") },
              ],
            }),
          ],
        }),
      ])
    })

    test("should fail when value is not greater than expected", () => {
      return expect(
        runTest(
          `
            pw.test("greater than test", () => {
              pw.expect(5).toBeGreaterThan(10)
            })
          `,
          fakeResponse
        )()
      ).resolves.toEqualRight([
        expect.objectContaining({
          descriptor: "root",
          children: [
            expect.objectContaining({
              descriptor: "greater than test",
              expectResults: [
                { status: "fail", message: expect.stringContaining("5") },
              ],
            }),
          ],
        }),
      ])
    })

    test("should work with .not modifier", () => {
      return expect(
        runTest(
          `
            pw.test("not greater than test", () => {
              pw.expect(5).not.toBeGreaterThan(10)
            })
          `,
          fakeResponse
        )()
      ).resolves.toEqualRight([
        expect.objectContaining({
          descriptor: "root",
          children: [
            expect.objectContaining({
              descriptor: "not greater than test",
              expectResults: [
                { status: "pass", message: expect.stringContaining("not") },
              ],
            }),
          ],
        }),
      ])
    })
  })

  describe("toBeLessThan", () => {
    test("should pass when value is less than expected", () => {
      return expect(
        runTest(
          `
            pw.test("less than test", () => {
              pw.expect(5).toBeLessThan(10)
            })
          `,
          fakeResponse
        )()
      ).resolves.toEqualRight([
        expect.objectContaining({
          descriptor: "root",
          children: [
            expect.objectContaining({
              descriptor: "less than test",
              expectResults: [
                { status: "pass", message: expect.stringContaining("5") },
              ],
            }),
          ],
        }),
      ])
    })

    test("should fail when value is not less than expected", () => {
      return expect(
        runTest(
          `
            pw.test("less than test", () => {
              pw.expect(15).toBeLessThan(10)
            })
          `,
          fakeResponse
        )()
      ).resolves.toEqualRight([
        expect.objectContaining({
          descriptor: "root",
          children: [
            expect.objectContaining({
              descriptor: "less than test",
              expectResults: [
                { status: "fail", message: expect.stringContaining("15") },
              ],
            }),
          ],
        }),
      ])
    })
  })

  describe("toBeGreaterThanOrEqual", () => {
    test("should pass when value is greater than expected", () => {
      return expect(
        runTest(
          `
            pw.test("greater than or equal test", () => {
              pw.expect(10).toBeGreaterThanOrEqual(5)
            })
          `,
          fakeResponse
        )()
      ).resolves.toEqualRight([
        expect.objectContaining({
          descriptor: "root",
          children: [
            expect.objectContaining({
              descriptor: "greater than or equal test",
              expectResults: [
                { status: "pass", message: expect.stringContaining("10") },
              ],
            }),
          ],
        }),
      ])
    })

    test("should pass when value equals expected", () => {
      return expect(
        runTest(
          `
            pw.test("greater than or equal test", () => {
              pw.expect(10).toBeGreaterThanOrEqual(10)
            })
          `,
          fakeResponse
        )()
      ).resolves.toEqualRight([
        expect.objectContaining({
          descriptor: "root",
          children: [
            expect.objectContaining({
              descriptor: "greater than or equal test",
              expectResults: [
                { status: "pass", message: expect.stringContaining("10") },
              ],
            }),
          ],
        }),
      ])
    })

    test("should fail when value is less than expected", () => {
      return expect(
        runTest(
          `
            pw.test("greater than or equal test", () => {
              pw.expect(5).toBeGreaterThanOrEqual(10)
            })
          `,
          fakeResponse
        )()
      ).resolves.toEqualRight([
        expect.objectContaining({
          descriptor: "root",
          children: [
            expect.objectContaining({
              descriptor: "greater than or equal test",
              expectResults: [
                { status: "fail", message: expect.stringContaining("5") },
              ],
            }),
          ],
        }),
      ])
    })
  })

  describe("toBeLessThanOrEqual", () => {
    test("should pass when value is less than expected", () => {
      return expect(
        runTest(
          `
            pw.test("less than or equal test", () => {
              pw.expect(5).toBeLessThanOrEqual(10)
            })
          `,
          fakeResponse
        )()
      ).resolves.toEqualRight([
        expect.objectContaining({
          descriptor: "root",
          children: [
            expect.objectContaining({
              descriptor: "less than or equal test",
              expectResults: [
                { status: "pass", message: expect.stringContaining("5") },
              ],
            }),
          ],
        }),
      ])
    })

    test("should pass when value equals expected", () => {
      return expect(
        runTest(
          `
            pw.test("less than or equal test", () => {
              pw.expect(10).toBeLessThanOrEqual(10)
            })
          `,
          fakeResponse
        )()
      ).resolves.toEqualRight([
        expect.objectContaining({
          descriptor: "root",
          children: [
            expect.objectContaining({
              descriptor: "less than or equal test",
              expectResults: [
                { status: "pass", message: expect.stringContaining("10") },
              ],
            }),
          ],
        }),
      ])
    })

    test("should fail when value is greater than expected", () => {
      return expect(
        runTest(
          `
            pw.test("less than or equal test", () => {
              pw.expect(15).toBeLessThanOrEqual(10)
            })
          `,
          fakeResponse
        )()
      ).resolves.toEqualRight([
        expect.objectContaining({
          descriptor: "root",
          children: [
            expect.objectContaining({
              descriptor: "less than or equal test",
              expectResults: [
                { status: "fail", message: expect.stringContaining("15") },
              ],
            }),
          ],
        }),
      ])
    })
  })
})
