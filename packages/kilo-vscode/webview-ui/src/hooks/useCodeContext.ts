import { createSignal } from "solid-js"

export interface CodeContext {
  id: string
  path: string
  startLine: number
  endLine: number
  text: string
}

export function useCodeContext() {
  const [items, setItems] = createSignal<CodeContext[]>([])
  return {
    items,
    add: (item: CodeContext) => setItems((prev) => [...prev, item]),
    remove: (id: string) => setItems((prev) => prev.filter((i) => i.id !== id)),
    clear: () => setItems([]),
    replace: (next: CodeContext[]) => setItems(next),
  }
}
