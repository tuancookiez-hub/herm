import { describe, expect, test } from "bun:test"
import { sessionCapabilities } from "../src/app/sessionCapabilities"

describe("sessionCapabilities", () => {
  test("session id enables actions before metadata hydration", () => {
    expect(sessionCapabilities({ sid: "lazy-sid", ready: false, streaming: false })).toEqual({
      sessionConnected: true,
      metadataHydrated: false,
      canSubmitPrompt: true,
      canDispatchGatewayCommand: true,
      canDrainQueue: true,
    })
  })

  test("queue drain waits for idle but not session.info", () => {
    expect(sessionCapabilities({ sid: "lazy-sid", ready: false, streaming: true })).toMatchObject({
      canSubmitPrompt: true,
      canDispatchGatewayCommand: true,
      canDrainQueue: false,
    })
  })

  test("missing session id disables session actions even if metadata is marked ready", () => {
    expect(sessionCapabilities({ sid: "", ready: true, streaming: false })).toEqual({
      sessionConnected: false,
      metadataHydrated: true,
      canSubmitPrompt: false,
      canDispatchGatewayCommand: false,
      canDrainQueue: false,
    })
  })
})
