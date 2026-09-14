export interface FileContext {
  filePath: string
  selectedText: string
  startLine: number
  endLine: number
}

/** A picked browser element: rendered as a badge, serialized as `text` to the model. */
export interface BrowserElementContext {
  label: string
  text: string
}

/** A captured image: attached to the prompt as an image attachment. */
export interface ChatImage {
  filename: string
  mime: string
  dataUrl: string
}

export interface ChatSurface {
  /** True while this chat webview is live and can be revealed. */
  open: boolean
  /** Bring the chat to the front; resolves false if it closed while waiting. */
  reveal: () => Promise<boolean>
  /** Post a file into the chat's prompt context. */
  attach: (file: FileContext) => void
  /** Post a picked browser element into the chat's prompt context. */
  attachElement?: (element: BrowserElementContext) => void
  /** Post a captured image into the chat's prompt attachments. */
  attachImage?: (image: ChatImage) => void
}

/**
 * Routing for the editor-title Babel icon: attach the file to an
 * already-open chat instead of stacking duplicate tab panels. Tries the
 * surfaces in the given order and picks the first open one that survives
 * reveal(). Returns false when none is open, so the caller can open a
 * fresh chat tab and attach the file there.
 */
export async function attachToOpenChat(surfaces: ChatSurface[], file: FileContext | undefined): Promise<boolean> {
  for (const surface of surfaces) {
    if (!surface.open) continue
    if (!(await surface.reveal())) continue
    if (file) surface.attach(file)
    return true
  }
  return false
}

/**
 * Attach a browser-element context block to the first open chat surface.
 * Returns false when no chat is available so the caller can fall back.
 */
export async function attachElementToChat(surfaces: ChatSurface[], element: BrowserElementContext): Promise<boolean> {
  for (const surface of surfaces) {
    if (!surface.open) continue
    if (!(await surface.reveal())) continue
    surface.attachElement?.(element)
    return true
  }
  return false
}

/**
 * Attach a captured image to the first open chat surface.
 * Returns false when no chat is available so the caller can fall back.
 */
export async function attachImageToChat(surfaces: ChatSurface[], image: ChatImage): Promise<boolean> {
  for (const surface of surfaces) {
    if (!surface.open) continue
    if (!(await surface.reveal())) continue
    surface.attachImage?.(image)
    return true
  }
  return false
}
