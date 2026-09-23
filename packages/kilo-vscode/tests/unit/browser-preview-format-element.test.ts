import { describe, expect, it } from "bun:test"
import { formatElementContext, formatElementLabel } from "../../src/browser-preview/format-element"

describe("formatElementContext", () => {
  it("passes the DOM path, viewport position, and HTML to the model", () => {
    expect(
      formatElementContext({
        url: "https://example.com",
        tagName: "button",
        id: "",
        className: "menu",
        selector: "header > button.menu",
        outerHTML: '<button class="menu" aria-label="Menu">Menu</button>',
        innerText: "Menu",
        computedStyle: { display: "flex" },
        dimensions: { top: 16, left: 417, width: 40, height: 38 },
        request: "Make the menu button larger",
      }),
    ).toBe(
      'DOM Path: header > button.menu\nPosition: top=16px, left=417px, width=40px, height=38px\nHTML Element: <button class="menu" aria-label="Menu">Menu</button>',
    )
  })
})

describe("formatElementLabel", () => {
  it("shows only the element type, not its ID or classes", () => {
    expect(
      formatElementLabel({
        url: "https://example.com",
        tagName: "button",
        id: "menu",
        className: "inline-flex border rounded",
        selector: "header > button#menu",
        outerHTML: '<button id="menu">Menu</button>',
        innerText: "Menu",
        computedStyle: {},
        dimensions: { top: 16, left: 417, width: 40, height: 38 },
      }),
    ).toBe("button")
  })
})
