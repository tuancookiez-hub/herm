import { describe, expect, test } from "bun:test"
import { acceptCompletion, completionRequest } from "../src/app/useCompletion"

describe("composer completion request", () => {
  test("routes slash-like input through complete.slash", () => {
    expect(completionRequest("/help")).toEqual({
      method: "complete.slash",
      params: { text: "/help" },
      replaceFrom: 1,
    })
  })

  test("does not treat absolute paths as slash commands", () => {
    expect(completionRequest("/home/kaio/Dev/herm/src/app.tsx")).toEqual({
      method: "complete.path",
      params: { word: "/home/kaio/Dev/herm/src/app.tsx" },
      replaceFrom: 0,
    })
  })

  test("routes trailing path tokens through complete.path", () => {
    expect(completionRequest("read src/app")).toEqual({
      method: "complete.path",
      params: { word: "src/app" },
      replaceFrom: 5,
    })
  })

  test("leaves plain prose alone", () => {
    expect(completionRequest("read the source")).toBeNull()
  })

  test("acceptance replaces only the completion token", () => {
    expect(acceptCompletion("read src/app", { text: "src/app.tsx", display: "app.tsx", meta: "file" }, 5))
      .toBe("read src/app.tsx ")
  })

  test("acceptance avoids duplicating slash command prefixes", () => {
    expect(acceptCompletion("/det", { text: "/details", display: "/details", meta: "command" }, 1))
      .toBe("/details ")
  })

  test("acceptance preserves prompt toolkit slash command items", () => {
    expect(acceptCompletion("/go", { text: "goal", display: "goal", meta: "command" }, 1))
      .toBe("/goal ")
  })
})
