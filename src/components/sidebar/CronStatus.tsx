import { memo, useState, useEffect, useCallback } from "react"
import { useTheme } from "../../theme"
import { useGateway } from "../../context/gateway"

type CronJob = {
  id: string
  name: string
  schedule: string
  enabled: boolean
  state: string
  last_status?: "ok" | "error"
  next_run?: string
}

type RawJob = {
  job_id?: string
  id?: string
  name?: string
  schedule?: string
  enabled?: boolean
  state?: string
  last_status?: "ok" | "error"
  next_run?: string
}

const normalize = (r: RawJob): CronJob => ({
  id: r.job_id ?? r.id ?? "?",
  name: r.name ?? "?",
  schedule: r.schedule ?? "?",
  enabled: r.enabled ?? false,
  state: r.state ?? "?",
  last_status: r.last_status,
  next_run: r.next_run,
})

export const CronStatus = memo((props: { width: number }) => {
  const theme = useTheme().theme
  const gw = useGateway()
  const [jobs, setJobs] = useState<CronJob[]>([])
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(() => {
    gw.request<{ jobs?: RawJob[] }>("cron.manage", { action: "list" })
      .then(res => {
        setJobs((res.jobs ?? []).map(normalize).filter(j => j.enabled))
        setErr(null)
      })
      .catch(e => setErr(e instanceof Error ? e.message : String(e)))
  }, [gw])

  useEffect(() => {
    load()
    const id = setInterval(load, 30000)
    return () => clearInterval(id)
  }, [load])

  if (err) return (
    <box height={1}>
      <text><span fg={theme.error}>Cron: {err}</span></text>
    </box>
  )

  if (jobs.length === 0) return (
    <box height={1}>
      <text><span fg={theme.textMuted}>No active cron jobs</span></text>
    </box>
  )

  const ok = jobs.filter(j => j.last_status === "ok").length
  const failed = jobs.filter(j => j.last_status === "error").length
  const pending = jobs.length - ok - failed

  const w = props.width
  const label = `Cron ${jobs.length}`
  const status = failed > 0
    ? <span fg={theme.error}>{`${failed} fail`}</span>
    : ok > 0
      ? <span fg={theme.success}>{`${ok} ok`}</span>
      : <span fg={theme.warning}>pending</span>

  return (
    <box flexDirection="column" marginBottom={1}>
      <box height={1}>
        <text>
          <span fg={theme.textMuted}>{label.padEnd(w - 8)}</span>
          {status}
        </text>
      </box>
      {jobs.slice(0, 3).map(j => (
        <box key={j.id} height={1}>
          <text>
            <span fg={theme.textMuted}>{"  "}</span>
            <span fg={j.last_status === "error" ? theme.error : j.last_status === "ok" ? theme.success : theme.textMuted}>
              {j.last_status === "ok" ? "● " : j.last_status === "error" ? "● " : "○ "}
            </span>
            <span fg={theme.text}>{j.name.slice(0, w - 6)}</span>
            <span fg={theme.textMuted}>{j.schedule.slice(0, w - j.name.length - 6)}</span>
          </text>
        </box>
      ))}
      {jobs.length > 3 ? (
        <box height={1}>
          <text><span fg={theme.textMuted}>{`  … and ${jobs.length - 3} more`}</span></text>
        </box>
      ) : null}
    </box>
  )
})
