import { describe, expect, it } from "bun:test"
import { PICKER_INIT_SCRIPT } from "../../src/browser-preview/picker-init-script"

describe("PICKER_INIT_SCRIPT", () => {
  it("is syntactically valid JavaScript", () => {
    expect(() => new Function(PICKER_INIT_SCRIPT)).not.toThrow()
  })

  it("is idempotent per document", () => {
    expect(PICKER_INIT_SCRIPT).toContain("__kiloPickerLoaded")
  })

  it("reports picks through the Playwright bridge", () => {
    expect(PICKER_INIT_SCRIPT).toContain("__kiloPickElement")
  })

  it("reports picker state through the Playwright bridge", () => {
    expect(PICKER_INIT_SCRIPT).toContain("__kiloPickerState")
  })

  it("reports drag-selected areas through the Playwright bridge", () => {
    expect(PICKER_INIT_SCRIPT).toContain("__kiloScreenshotArea")
  })

  it("lets the extension host hide the picker chrome during capture", () => {
    expect(PICKER_INIT_SCRIPT).toContain("__kiloSetPickerChrome")
  })

  it("selection overlay spans the page and dims outside the rect", () => {
    expect(PICKER_INIT_SCRIPT).toContain("box-shadow:0 0 0 100000px")
  })

  it("selection reports document coordinates including scroll", () => {
    expect(PICKER_INIT_SCRIPT).toContain("window.scrollX")
    expect(PICKER_INIT_SCRIPT).toContain("window.scrollY")
  })

  it("ignores tiny drags instead of capturing a sliver", () => {
    expect(PICKER_INIT_SCRIPT).toContain("w < 8 || h < 8")
  })

  it("installs the toolbar in the top frame only", () => {
    expect(PICKER_INIT_SCRIPT).toContain("window.top === window")
  })

  it("contains no unescaped template interpolation", () => {
    expect(PICKER_INIT_SCRIPT).not.toContain("${")
  })

  it("escapes control sequences for embedding in a TS template string", () => {
    // A literal newline inside the embedded CSS/HTML strings would terminate
    // the TS template literal, so they must be written as \n / \uXXXX escapes.
    expect(PICKER_INIT_SCRIPT).toContain('join("\\n")')
    expect(PICKER_INIT_SCRIPT).toContain("\\u25C6")
  })

  it("uses a shadow DOM host so page CSS cannot restyle the toolbar", () => {
    expect(PICKER_INIT_SCRIPT).toContain("attachShadow")
    expect(PICKER_INIT_SCRIPT).toContain("__kilo_picker_host")
  })

  it("captures elements with a selector path and computed styles", () => {
    expect(PICKER_INIT_SCRIPT).toContain("selectorPath")
    expect(PICKER_INIT_SCRIPT).toContain("getComputedStyle")
  })

  it("does not patch history or report navigation (no address bar to sync)", () => {
    expect(PICKER_INIT_SCRIPT).not.toContain("pushState")
    expect(PICKER_INIT_SCRIPT).not.toContain("window.parent")
  })
})
