import type { HermPlugin } from "./types"
import clock from "./bundled/clock"
import files from "./bundled/files"
import schrodingerBox from "./bundled/schrodingers-box"

export const INTERNAL: ReadonlyArray<HermPlugin> = [
  clock,
  files,
  schrodingerBox,
]
