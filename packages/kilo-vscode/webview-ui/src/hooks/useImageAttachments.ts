import { createSignal } from "solid-js"
import { ACCEPTED_IMAGE_TYPES, isAcceptedImageType, isDragLeavingComponent } from "./image-attachments-utils"
import { extractDropPaths, KILO_FILE_PATH_MIME } from "../utils/path-mentions"

export interface ImageAttachment {
  id: string
  filename: string
  mime: string
  dataUrl: string
}

/** Callback for handling text/URI file path drops. */
export type FilePathDropHandler = (paths: string[]) => void

/** Callback for handling plain-text drops (e.g. dragged selected text). */
export type TextDropHandler = (text: string) => void

export function useImageAttachments() {
  const [images, setImages] = createSignal<ImageAttachment[]>([])
  const [dragging, setDragging] = createSignal(false)
  let onFilePaths: FilePathDropHandler | undefined
  let onText: TextDropHandler | undefined

  /** Register a handler for file path drops (text/URI-list). */
  const setFilePathDropHandler = (handler: FilePathDropHandler) => {
    onFilePaths = handler
  }

  /** Register a handler for plain-text drops. */
  const setTextDropHandler = (handler: TextDropHandler) => {
    onText = handler
  }

  const add = (file: File) => {
    if (!isAcceptedImageType(file.type)) return
    const reader = new FileReader()
    reader.onload = () => {
      const attachment: ImageAttachment = {
        id: crypto.randomUUID(),
        filename: file.name || "image",
        mime: file.type,
        dataUrl: reader.result as string,
      }
      setImages((prev) => [...prev, attachment])
    }
    reader.readAsDataURL(file)
  }

  /** Add an image from raw data (e.g. a screenshot captured by the extension). */
  const addDataUrl = (filename: string, mime: string, dataUrl: string) => {
    if (!isAcceptedImageType(mime)) return
    setImages((prev) => [...prev, { id: crypto.randomUUID(), filename, mime, dataUrl }])
  }

  const remove = (id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id))
  }

  const clear = () => setImages([])

  const replace = (next: ImageAttachment[]) => setImages(next)

  /** Route a plain-text drop (no paths, no files) to the registered handler. */
  const tryTextDrop = (dt: DataTransfer) => {
    if (!onText) return
    const text = dt.getData("text")
    if (text && text.trim()) onText(text)
  }

  const handlePaste = (event: ClipboardEvent) => {
    const items = Array.from(event.clipboardData?.items ?? [])
    const imageItems = items.filter((item) => item.kind === "file" && ACCEPTED_IMAGE_TYPES.includes(item.type))
    if (imageItems.length === 0) return
    event.preventDefault()
    for (const item of imageItems) {
      const file = item.getAsFile()
      if (file) add(file)
    }
  }

  const handleDragEnter = (event: DragEvent) => {
    const types = Array.from(event.dataTransfer?.types ?? [])
    console.log("[Kilo New] [DnD Debug] handleDragEnter:", { types, target: (event.target as HTMLElement)?.tagName })
    event.preventDefault()
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy"
    }
    setDragging(true)
  }

  const handleDragOver = (event: DragEvent) => {
    event.preventDefault()
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy"
    }
    setDragging(true)
  }

  const handleDragLeave = (event: DragEvent) => {
    if (isDragLeavingComponent(event.relatedTarget, event.currentTarget as HTMLElement)) {
      console.log("[Kilo New] [DnD Debug] handleDragLeave")
      setDragging(false)
    }
  }

  const handleDrop = (event: DragEvent) => {
    setDragging(false)
    event.preventDefault()
    const dt = event.dataTransfer
    if (!dt) {
      console.log("[Kilo New] [DnD Debug] handleDrop: no dataTransfer")
      return
    }

    const types = Array.from(dt.types ?? [])
    const typeData: Record<string, string> = {}
    for (const t of types) {
      try {
        typeData[t] = dt.getData(t)
      } catch (err) {
        typeData[t] = `<error: ${String(err)}>`
      }
    }

    const fileList = dt.files
      ? Array.from(dt.files).map((f) => ({
          name: f.name,
          type: f.type,
          size: f.size,
          path: (f as unknown as { path?: string }).path,
        }))
      : []

    console.log("[Kilo New] [DnD Debug] handleDrop received:", {
      types,
      typeData,
      files: fileList,
      hasOnFilePaths: !!onFilePaths,
    })

    // First: check for text/URI file path drops (VS Code explorer, editor tabs)
    const paths = extractDropPaths(dt)
    console.log("[Kilo New] [DnD Debug] extractDropPaths result:", paths)

    if (paths && paths.length > 0 && onFilePaths) {
      console.log("[Kilo New] [DnD Debug] Calling onFilePaths with:", paths)
      onFilePaths(paths)
      return
    }

    // Second: fall through to image file drops or non-image files
    const files = dt.files ? Array.from(dt.files) : []
    if (files.length === 0) {
      tryTextDrop(dt)
      return
    }

    const imageFiles: File[] = []
    const otherPaths: string[] = []

    for (const file of files) {
      if (isAcceptedImageType(file.type) || /\.(png|jpe?g|gif|webp)$/i.test(file.name)) {
        imageFiles.push(file)
      } else {
        const p = (file as unknown as { path?: string }).path || file.name
        if (p) otherPaths.push(p)
      }
    }

    console.log("[Kilo New] [DnD Debug] imageFiles:", imageFiles.length, "otherPaths:", otherPaths)

    for (const img of imageFiles) {
      add(img)
    }

    if (otherPaths.length > 0 && onFilePaths) {
      console.log("[Kilo New] [DnD Debug] Calling onFilePaths for otherPaths:", otherPaths)
      onFilePaths(otherPaths)
      return
    }

    if (imageFiles.length === 0) tryTextDrop(dt)
  }

  return {
    images,
    dragging,
    add,
    addDataUrl,
    remove,
    clear,
    replace,
    handlePaste,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    setFilePathDropHandler,
    setTextDropHandler,
  }
}
