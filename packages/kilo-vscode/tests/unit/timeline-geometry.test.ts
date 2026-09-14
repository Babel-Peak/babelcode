import { describe, expect, it } from "bun:test"
import { geometry, hit, navigate, spanIndex } from "../../webview-ui/src/utils/timeline/geometry"

describe("timeline geometry", () => {
  const bars = [
    { bg: "blue", width: 3, height: 4 },
    { bg: "red", width: 5, height: 8 },
    { bg: "blue", width: 2, height: 6 },
  ]

  it("preserves visual positions while grouping paths by color", () => {
    const result = geometry(bars, 10)

    expect(result.width).toBe(13)
    expect(result.items.map((item) => [item.idx, item.x])).toEqual([
      [0, 0],
      [1, 4],
      [2, 10],
    ])
    expect(result.paths).toHaveLength(2)
    expect(result.paths.map((path) => path.bg)).toEqual(["blue", "red"])
    expect(result.paths[0]!.d).toContain("M0,10")
    expect(result.paths[0]!.d).toContain("M10,10")
    expect(result.paths[1]!.d).toContain("M4,10")
  })

  it("hit tests bars but not their gaps", () => {
    const items = geometry(bars, 10).items

    expect(hit(items, 0)).toBe(0)
    expect(hit(items, 2.99)).toBe(0)
    expect(hit(items, 3)).toBe(-1)
    expect(hit(items, 4)).toBe(1)
    expect(hit(items, 12)).toBe(-1)
  })

  it("navigates in visual order with bounded endpoints", () => {
    expect(navigate(-1, 3, "ArrowRight")).toBe(0)
    expect(navigate(1, 3, "ArrowLeft")).toBe(0)
    expect(navigate(2, 3, "ArrowRight")).toBe(2)
    expect(navigate(1, 3, "Home")).toBe(0)
    expect(navigate(1, 3, "End")).toBe(2)
    expect(navigate(1, 3, "Escape")).toBe(1)
    expect(navigate(0, 0, "ArrowRight")).toBe(-1)
  })

  describe("spanIndex", () => {
    const ordered = [{ msgId: "a" }, { msgId: "c" }, { msgId: "d" }]
    const order = new Map([
      ["a", 0],
      ["b", 1],
      ["c", 2],
      ["d", 3],
    ])

    it("resolves exact message bars for both viewport edges", () => {
      expect(spanIndex(ordered, order, "a", true)).toBe(0)
      expect(spanIndex(ordered, order, "d", false)).toBe(2)
    })

    it("snaps a message without bars to the nearest bar", () => {
      // "b" has no bar: the start edge uses the first bar at/after it, the
      // end edge the last bar at/before it.
      expect(spanIndex(ordered, order, "b", true)).toBe(1)
      expect(spanIndex(ordered, order, "b", false)).toBe(0)
    })

    it("returns -1 for unknown messages", () => {
      expect(spanIndex(ordered, order, "zz", true)).toBe(-1)
      expect(spanIndex(ordered, order, "zz", false)).toBe(-1)
    })
  })
})
