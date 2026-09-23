import type { PickedElement } from "./PlaywrightBrowserService"

/**
 * Short badge label for a picked element, e.g. `button`.
 */
export function formatElementLabel(element: PickedElement): string {
  return element.tagName || "element"
}

/**
 * Format a picked element with its DOM path, viewport bounds, and HTML.
 */
export function formatElementContext(element: PickedElement): string {
  const d = element.dimensions
  return `DOM Path: ${element.selector}\nPosition: top=${d.top}px, left=${d.left}px, width=${d.width}px, height=${d.height}px\nHTML Element: ${element.outerHTML}`
}
