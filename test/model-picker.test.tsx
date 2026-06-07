import { describe, expect, test } from "bun:test"
import { act } from "react"
import { mountNode, until } from "./harness"
import { useDialog } from "../src/ui/dialog"
import { useGateway } from "../src/context/gateway"
import { openModelPicker } from "../src/dialogs/model-picker"
import type { ModelOptionsResponse } from "../src/context/wire"
import { useEffect } from "react"

const Open = () => {
  const d = useDialog()
  const gw = useGateway()
  useEffect(() => { openModelPicker(d, gw) }, [])
  return null
}

const OPTIONS = {
  provider: "anthropic",
  model: "claude-3",
  providers: [
    {
      slug: "anthropic",
      name: "Anthropic",
      is_current: true,
      total_models: 2,
      models: ["claude-3", "claude-4"],
      capabilities: { "claude-4": { fast: true, reasoning: true } },
    },
    { slug: "openai", name: "OpenAI", total_models: 1, models: ["gpt-4"] },
  ],
}

describe("model-picker", () => {
  test("session-scoped by default → config.set sends combined arg with session_id; Tab toggles global", async () => {
    const sets: Array<Record<string, unknown>> = []
    const t = await mountNode(<Open />, {
      handlers: {
        "model.options": () => OPTIONS,
        "config.set": (p) => { sets.push(p); return { key: "model", value: p.value } },
      },
    })
    t.gw.setSession("sess-abc")
    await until(t, () => t.frame().includes("Anthropic"))
    expect(t.frame()).toContain("this session")

    // Enter on Anthropic → model step; Enter on claude-3 → apply
    act(() => t.keys.pressEnter()); await t.settle()
    await until(t, () => t.frame().includes("claude-3"))
    act(() => t.keys.pressEnter()); await t.settle()

    expect(sets).toHaveLength(1)
    expect(sets[0]).toMatchObject({
      key: "model",
      value: "claude-3 --provider anthropic",
      session_id: "sess-abc",
    })
    t.destroy()
  })

  test("Tab → global scope omits session_id and appends --global", async () => {
    const sets: Array<Record<string, unknown>> = []
    const t = await mountNode(<Open />, {
      handlers: {
        "model.options": () => OPTIONS,
        "config.set": (p) => { sets.push(p); return { key: "model", value: p.value } },
      },
    })
    t.gw.setSession("sess-abc")
    await until(t, () => t.frame().includes("this session"))

    act(() => t.keys.pressTab()); await t.settle()
    expect(t.frame()).toContain("global")

    act(() => t.keys.pressEnter()); await t.settle()
    await until(t, () => t.frame().includes("claude-3"))
    act(() => t.keys.pressArrow("down")); await t.settle()
    act(() => t.keys.pressEnter()); await t.settle()

    expect(sets).toHaveLength(1)
    expect(sets[0].value).toBe("claude-4 --provider anthropic --global")
    expect(sets[0].session_id).toBeUndefined()
    t.destroy()
  })

  test("provider dialog leads with current provider and Enter selects it", async () => {
    const opts = {
      provider: "anthropic",
      model: "claude-3",
      providers: [
        { slug: "openai", name: "OpenAI", total_models: 1, models: ["gpt-4"] },
        { slug: "anthropic", name: "Anthropic", is_current: true, total_models: 2, models: ["claude-3", "claude-4"] },
      ],
    }
    const t = await mountNode(<Open />, {
      handlers: { "model.options": () => opts },
    })
    await until(t, () => t.frame().includes("Anthropic"))
    expect(t.frame().indexOf("Current")).toBeLessThan(t.frame().indexOf("Available"))

    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Switch Model (Anthropic)"))
    expect(t.frame()).toContain("claude-3")
    t.destroy()
  })

  test("model step only marks current model for current provider", async () => {
    const opts = {
      provider: "anthropic",
      model: "shared",
      providers: [
        { slug: "anthropic", name: "Anthropic", is_current: true, total_models: 1, models: ["shared"] },
        { slug: "openai", name: "OpenAI", total_models: 2, models: ["shared", "gpt-4"] },
      ],
    }
    const t = await mountNode(<Open />, {
      handlers: { "model.options": () => opts },
    })
    await until(t, () => t.frame().includes("Anthropic"))

    act(() => t.keys.pressArrow("down"))
    await t.settle()
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Switch Model (OpenAI)"))

    const row = t.frame().split("\n").find(l => l.includes("shared")) ?? ""
    expect(row).not.toContain("●")
    t.destroy()
  })
  test("accepts provider capability metadata with optional neighbors", () => {
    const opts: ModelOptionsResponse = {
      provider: "fastlabs",
      model: "flash-reasoner",
      providers: [
        {
          slug: "fastlabs",
          name: "Fast Labs",
          total_models: 2,
          authenticated: true,
          auth_type: "api_key",
          key_env: "FASTLABS_API_KEY",
          free_tier: true,
          unavailable_models: ["legacy-slow"],
          models: ["flash-reasoner", "legacy-slow"],
          capabilities: {
            "flash-reasoner": { fast: true, reasoning: true },
            "legacy-slow": {},
          },
          pricing: {
            "flash-reasoner": { input: "$0.20/M", output: "$0.80/M", cache: null, free: false },
          },
        },
        {
          slug: "compat",
          name: "Compat Provider",
          models: ["plain-model"],
        },
      ],
    }

    const provider = opts.providers?.[0]
    const compat = opts.providers?.[1]

    expect(provider?.capabilities?.["flash-reasoner"]?.fast).toBe(true)
    expect(provider?.capabilities?.["flash-reasoner"]?.reasoning).toBe(true)
    expect(provider?.authenticated).toBe(true)
    expect(provider?.pricing?.["flash-reasoner"].cache).toBeNull()
    expect(provider?.unavailable_models).toContain("legacy-slow")
    expect(compat?.capabilities?.["plain-model"]?.fast).toBeUndefined()
    expect(compat?.pricing?.["plain-model"]).toBeUndefined()
  })

  test("model step annotates fast and reasoning capabilities", async () => {
    const t = await mountNode(<Open />, {
      handlers: { "model.options": () => OPTIONS },
    })
    await until(t, () => t.frame().includes("Anthropic"))

    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("claude-4"))

    const claude3 = t.frame().split("\n").find(l => l.includes("claude-3")) ?? ""
    const claude4 = t.frame().split("\n").find(l => l.includes("claude-4")) ?? ""
    expect(claude3).not.toContain("fast")
    expect(claude3).not.toContain("reasoning")
    expect(claude4).toContain("fast · reasoning")
    t.destroy()
  })

})
