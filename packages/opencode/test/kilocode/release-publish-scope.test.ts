import { expect, test } from "bun:test"
import path from "path"

test("Kilo releases publish only the VS Code extension (no npm packages)", async () => {
  const root = path.join(import.meta.dir, "../../../..")
  const src = await Bun.file(path.join(root, "script", "publish.ts")).text()

  expect(src).not.toContain("packages/ui/script/publish.ts")
  expect(src).not.toContain("packages/opencode/script/publish.ts")
  expect(src).not.toContain("packages/sdk/js/script/publish.ts")
  expect(src).not.toContain("packages/plugin/script/publish.ts")
  expect(src).toContain("packages/kilo-vscode/script/publish.ts")
})
