import type { PickedElement } from "./PlaywrightBrowserService"

/**
 * Short badge label for a picked element, e.g. `img#logo.floating_element`.
 */
export function formatElementLabel(element: PickedElement): string {
  const id = element.id ? `#${element.id}` : ""
  const classes = element.className.trim() ? `.${element.className.trim().split(/\s+/).join(".")}` : ""
  const label = `${element.tagName}${id}${classes}`
  return label || element.selector || "element"
}

/**
 * Format a picked element as a prompt-context block, mirroring the layout
 * VS Code's integrated browser uses for "Add Element to Chat": element
 * selector, page URL, outer HTML, dimensions, and computed styles.
 */
export function formatElementContext(element: PickedElement): string {
  const sections: string[] = []
  sections.push("Attached Element Context from Browser Preview")
  if (element.selector) sections.push(`Element: ${element.selector}`)
  if (element.url) sections.push(`URL: ${element.url}`)
  sections.push(`Outer HTML:\n\`\`\`html\n${element.outerHTML}\n\`\`\``)

  const d = element.dimensions
  sections.push(`Dimensions:\n- top: ${d.top}px\n- left: ${d.left}px\n- width: ${d.width}px\n- height: ${d.height}px`)

  const css = Object.entries(element.computedStyle)
    .map(([key, value]) => `${key}: ${value};`)
    .join("\n")
  if (css) sections.push(`CSS:\n\`\`\`css\n${css}\n\`\`\``)

  return sections.join("\n\n")
}
