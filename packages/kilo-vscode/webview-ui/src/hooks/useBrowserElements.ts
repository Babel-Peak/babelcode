import { createSignal } from "solid-js"

export interface BrowserElement {
  id: string
  label: string
  text: string
}

export function useBrowserElements() {
  const [items, setItems] = createSignal<BrowserElement[]>([])
  return {
    items,
    add: (item: BrowserElement) => setItems((prev) => [...prev, item]),
    remove: (id: string) => setItems((prev) => prev.filter((i) => i.id !== id)),
    clear: () => setItems([]),
    replace: (next: BrowserElement[]) => setItems(next),
  }
}
