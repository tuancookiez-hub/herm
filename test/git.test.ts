import { describe, test, expect } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, normalize } from "node:path"
import { branch, gitdir, rtrunc } from "../src/utils/git"

const sh = async (cwd: string, cmd: string) => {
  const p = Bun.spawn(["sh", "-c", cmd], { cwd, stdout: "ignore", stderr: "ignore" })
  await p.exited
}

describe("utils/git", () => {
  test("branch() + gitdir() in a fresh repo; null outside", async () => {
    const root = mkdtempSync(join(tmpdir(), "herm-git-"))
    try {
      // -c user.* because CI runners have no global identity; commit
      // would silently fail (sh() discards stderr).
      await sh(root, "git -c user.name=t -c user.email=t@t init -q -b main && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m x")
      expect(await branch(root)).toBe("main")
      expect(normalize(await gitdir(root) ?? "")).toBe(normalize(join(root, ".git")))
      await sh(root, "git checkout -q -b feature/long-name")
      expect(await branch(root)).toBe("feature/long-name")
      // detached → null
      await sh(root, "git checkout -q --detach")
      expect(await branch(root)).toBeNull()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("rtrunc keeps the tail", () => {
    expect(rtrunc("main", 10)).toBe("main")
    expect(rtrunc("feature/very-long-branch", 10)).toBe("…ng-branch")
    expect(rtrunc("feature/very-long-branch", 10).length).toBe(10)
  })
})
