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

export const useCronJobs = () => {
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

  return { jobs, err }
}

export const CronStatus = memo((props: {
  width: number
  open: boolean
  onToggle: () => void
}) => {
  const theme = useTheme().theme
  const { jobs, err } = useCronJobs()

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
  const hint = failed > 0
    ? `${failed} fail`
    : ok > 0 ? `${ok} ok` : "pending"
  const hintColor = failed > 0
    ? theme.error
    : ok > 0 ? theme.success : theme.warning

  return (
    <box flexDirection="column" marginBottom={props.open ? 1 : 0}>
      <box height={1}
           onMouseDown={props.onToggle}>
        <text>
          <span fg={theme.text}>{props.open ? "▾ " : "▸ "}</span>
          <span fg={theme.text}><strong>{"Cron"}</strong></span>
          <span fg={theme.textMuted}>{`  ${jobs.length}`}</span>
          <span fg={hintColor}>{`  ${hint}`}</span>
        </text>
      </box>
      {props.open ? jobs.slice(0, 5).map(j => (
        <box key={j.id} height={1}>
          <text>
            <span fg={theme.textMuted}>{"  "}</span>
            <span fg={j.last_status === "error" ? theme.error : j.last_status === "ok" ? theme.success : theme.textMuted}>
              {j.last_status === "ok" ? "● " : j.last_status === "error" ? "● " : "○ "}
            </span>
            <span fg={theme.text}>{j.name.slice(0, props.width - 6)}</span>
            <span fg={theme.textMuted}>{j.schedule.slice(0, props.width - j.name.length - 6)}</span>
          </text>
        </box>
      )) : null}
    </box>
  )
})
