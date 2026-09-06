"use client"

import * as React from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import {
  ArrowLeft,
  PlayCircle,
  FileText,
  Share2,
  Route,
  Brain,
  ShieldCheck,
  MessageSquare,
  LayoutList,
  Coins,
  Users,
  Wallet,
  Send,
  Save,
  Database,
  HardDrive,
  CheckCircle2,
  AlertCircle,
  GitBranch,
} from "lucide-react"
import { SectionHeading, StatusBadge, RiskBadge, ProvenanceBadge, CopyAddress, StatTile } from "@/components/intel/shared"
import { PriorityRing } from "@/components/case-card"
import { GraphView } from "@/components/intel/graph-view"
import { JourneyTimeline } from "@/components/intel/journey-timeline"
import { IntelligenceBoard } from "@/components/intel/intelligence-panels"
import { FundFlowGraph } from "@/components/intel/fund-flow-graph"
import { Tabs } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Select, Textarea, Label } from "@/components/ui/field"
import { Badge } from "@/components/ui/badge"
import { LoadingBlock, ErrorState, EmptyState, Spinner } from "@/components/ui/feedback"
import { useCaseDetail, useEvidence, apiPost, useSession, usePersistence } from "@/lib/client/hooks"
import { PERMISSIONS } from "@/lib/auth"
import { CHAIN_LABEL, usd, usdFull, dateTime, relTime, humanize, STATUS_LABEL, pct } from "@/lib/client/format"
import type { CaseStatus } from "@/lib/types"

const STATUSES: CaseStatus[] = [
  "NEW",
  "ANALYZING",
  "TRACING",
  "VASP_IDENTIFIED",
  "ACTION_REQUIRED",
  "FREEZE_REVIEW",
  "MONITORING",
  "CLOSED",
]

export default function CaseDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id
  const { user } = useSession()
  const { data, error, isLoading, mutate } = useCaseDetail(id)
  const { data: persistence } = usePersistence()
  const [tab, setTab] = React.useState("overview")
  const [busy, setBusy] = React.useState<null | "investigate" | "status" | "report">(null)
  const [msg, setMsg] = React.useState<string | null>(null)
  const [saveState, setSaveState] = React.useState<"idle" | "saving" | "saved" | "error">("idle")
  const [savedId, setSavedId] = React.useState<string | null>(null)
  const [traceHops, setTraceHops] = React.useState(2)

  const canRun = user ? PERMISSIONS.runInvestigation(user.role) : false
  const canEdit = user ? PERMISSIONS.editCase(user.role) : false
  const canExport = user ? PERMISSIONS.exportReport(user.role) : false

  const c = data?.case
  const inv = data?.investigation ?? null
  const graph = data?.graph ?? null

  async function runInvestigation(options?: { traceMaxHops?: number; focusTab?: string }) {
    if (!id) return
    setBusy("investigate")
    setMsg(null)
    try {
      await apiPost(`/api/cases/${id}/investigate`, { depth: 5, traceMaxHops: options?.traceMaxHops ?? traceHops })
      await mutate()
      setMsg("Investigation complete — intelligence refreshed.")
      setTab(options?.focusTab ?? "intelligence")
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Investigation failed.")
    } finally {
      setBusy(null)
    }
  }

  async function saveInvestigation() {
    if (!id) return
    setSaveState("saving")
    setMsg(null)
    try {
      const res = await apiPost<{ id: string; savedAt: string; persistenceLabel: string }>(
        `/api/cases/${id}/save`,
      )
      setSavedId(res.id)
      setSaveState("saved")
      setMsg(`Investigation ${res.id} saved to ${res.persistenceLabel}.`)
    } catch (e) {
      // Never surface a "saved" state when persistence actually failed.
      setSaveState("error")
      setMsg(e instanceof Error ? e.message : "Save failed.")
    }
  }

  async function changeStatus(status: CaseStatus) {
    if (!id) return
    setBusy("status")
    try {
      await apiPost(`/api/cases/${id}`, { status }, "PATCH")
      await mutate()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Status update failed.")
    } finally {
      setBusy(null)
    }
  }

  async function generateReport() {
    if (!id) return
    setBusy("report")
    setMsg(null)
    try {
      const res = await fetch(`/api/cases/${id}/report`, { credentials: "include" })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || "Report generation failed.")
      const blob = new Blob([JSON.stringify(json.report, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${id}-report.json`
      a.click()
      URL.revokeObjectURL(url)
      setMsg("Report generated and downloaded.")
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Report generation failed.")
    } finally {
      setBusy(null)
    }
  }

  if (isLoading) return <LoadingBlock label="Loading case workspace…" />
  if (error) return <ErrorState message={error.message} />
  if (!c) return <ErrorState message="Case not found." />

  const tabs = [
    { value: "overview", label: "Overview", icon: LayoutList },
    { value: "graph", label: "Transaction Graph", icon: Share2 },
    { value: "fundflow", label: "Fund Flow", icon: GitBranch },
    { value: "journey", label: "Fraud Journey", icon: Route },
    { value: "intelligence", label: "Intelligence", icon: Brain },
    { value: "evidence", label: "Evidence & Activity", icon: ShieldCheck },
    { value: "notes", label: "Notes", icon: MessageSquare },
  ]

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <Link href="/cases" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> All cases
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <PriorityRing score={c.priorityScore} size={52} />
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold tracking-tight text-foreground text-balance">{c.title}</h1>
              <span className="font-mono text-xs text-muted-foreground">{c.id}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusBadge status={c.status} />
              <RiskBadge score={c.riskScore} band={c.riskBand} />
              <Badge variant="outline">{CHAIN_LABEL[c.chain]}</Badge>
              <Badge variant="muted">{humanize(c.typology)}</Badge>
              <ProvenanceBadge provenance={c.provenance} />
            </div>
            <p className="text-xs text-muted-foreground">
              Complaint {c.complaintRef} · assigned to {c.investigator} · updated {relTime(c.updatedAt)}
            </p>
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              {persistence ? (
                <Badge
                  variant="outline"
                  title={
                    persistence.persistent
                      ? "Saved investigations survive refresh, navigation and server restart."
                      : "In-memory only — data does NOT survive a server restart."
                  }
                  style={{
                    color: persistence.persistent ? "var(--risk-low)" : "var(--muted-foreground)",
                    borderColor: `color-mix(in oklch, ${persistence.persistent ? "var(--risk-low)" : "var(--muted-foreground)"} 40%, transparent)`,
                  }}
                >
                  {persistence.persistent ? <Database className="size-3" /> : <HardDrive className="size-3" />}
                  {persistence.label}
                </Badge>
              ) : null}
              <span className="font-mono text-[11px] text-muted-foreground">
                Investigation ID: {savedId ?? c.id}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canEdit ? (
            <div className="space-y-1">
              <Label htmlFor="status" className="sr-only">
                Status
              </Label>
              <Select
                id="status"
                value={c.status}
                onChange={(e) => changeStatus(e.target.value as CaseStatus)}
                disabled={busy === "status"}
                className="h-8 w-44 text-xs"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          {canRun ? (
            <Button onClick={() => runInvestigation()} disabled={busy === "investigate"}>
              {busy === "investigate" ? <Spinner className="text-primary-foreground" /> : <PlayCircle className="size-4" />}
              {inv ? "Re-run investigation" : "Run investigation"}
            </Button>
          ) : null}
          {canRun ? (
            <Button variant="outline" onClick={saveInvestigation} disabled={saveState === "saving"}>
              {saveState === "saving" ? (
                <Spinner />
              ) : saveState === "saved" ? (
                <CheckCircle2 className="size-4" style={{ color: "var(--risk-low)" }} />
              ) : saveState === "error" ? (
                <AlertCircle className="size-4" style={{ color: "var(--risk-critical)" }} />
              ) : (
                <Save className="size-4" />
              )}
              {saveState === "saving"
                ? "Saving…"
                : saveState === "saved"
                  ? "Saved"
                  : saveState === "error"
                    ? "Save failed"
                    : "Save investigation"}
            </Button>
          ) : null}
          {canExport ? (
            <Button variant="outline" onClick={generateReport} disabled={busy === "report" || !inv}>
              {busy === "report" ? <Spinner /> : <FileText className="size-4" />} Report
            </Button>
          ) : null}
        </div>
      </div>

      {msg ? <div className="rounded-md border border-border bg-card/60 px-3 py-2 text-xs text-muted-foreground">{msg}</div> : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Reported loss" value={usd(c.reportedLossUsd)} icon={Coins} accent="var(--risk-high)" />
        <StatTile label="Traceable" value={usd(c.traceableUsd)} icon={Wallet} accent="var(--risk-low)" />
        <StatTile label="Recovery est." value={pct(c.recoveryProbability)} accent="var(--primary)" />
        <StatTile label="Connected victims" value={c.connectedVictims} icon={Users} accent="var(--chart-2)" />
      </div>

      <Tabs items={tabs} value={tab} onValueChange={setTab} />

      {tab === "overview" ? (
        <div className="grid gap-3 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Investigation summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {inv ? (
                <p className="text-sm leading-relaxed text-foreground/85 text-pretty">{inv.summary}</p>
              ) : (
                <EmptyState
                  icon={Brain}
                  title="No investigation yet"
                  description="Run the multi-engine investigation to populate fund tracing, exit-point attribution and recovery intelligence."
                />
              )}
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Complaint</p>
                <p className="rounded-md border border-border bg-background/40 p-3 text-xs leading-relaxed text-muted-foreground text-pretty">
                  {c.complaintText || "No complaint narrative recorded."}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Reported wallet</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              <CopyAddress address={c.reportedWallet} full />
              <MetaRow label="Chain" value={CHAIN_LABEL[c.chain]} />
              <MetaRow label="Reported loss" value={usdFull(c.reportedLossUsd)} />
              <MetaRow label="Opened" value={dateTime(c.createdAt)} />
              <MetaRow label="Extracted wallets" value={String(c.extractedWallets.length)} />
              {c.extractedWallets.length > 1 ? (
                <div className="space-y-1 pt-1">
                  {c.extractedWallets.map((w) => (
                    <CopyAddress key={w} address={w} className="block" />
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {tab === "graph" ? (
        <Card>
          <CardHeader>
            <CardTitle>Transaction graph</CardTitle>
          </CardHeader>
          <CardContent>
            {graph ? (
              <GraphView graph={graph} />
            ) : (
              <EmptyState
                icon={Share2}
                title="No graph available"
                description="This manual case has no pre-built demo graph. Cross-provider graph reconstruction runs during investigation."
              />
            )}
          </CardContent>
        </Card>
      ) : null}

      {tab === "fundflow" ? (
        <Card>
          <CardHeader className="gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                <GitBranch className="size-4 text-muted-foreground" />
                Fund Flow
              </CardTitle>
              {canRun ? (
                <div className="flex items-center gap-2">
                  <Label htmlFor="tracehops" className="text-[11px] text-muted-foreground">
                    Hop depth
                  </Label>
                  <Select
                    id="tracehops"
                    className="h-8 w-28 text-xs"
                    value={String(traceHops)}
                    onChange={(e) => setTraceHops(Number(e.target.value))}
                    disabled={busy === "investigate"}
                  >
                    <option value="2">2 (default)</option>
                    <option value="3">3 (max)</option>
                  </Select>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => runInvestigation({ traceMaxHops: traceHops, focusTab: "fundflow" })}
                    disabled={busy === "investigate"}
                  >
                    {busy === "investigate" ? <Spinner /> : <PlayCircle className="size-3.5" />} Re-run trace
                  </Button>
                </div>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              Changing hop depth re-runs the full multi-engine investigation with the new depth — this refreshes
              every intelligence panel, not just the graph below.
            </p>
          </CardHeader>
          <CardContent>
            {inv?.fundTrace ? (
              <FundFlowGraph graph={inv.fundTrace} />
            ) : (
              <EmptyState
                icon={GitBranch}
                title="No fund flow trace yet"
                description="Run the multi-engine investigation to trace how funds moved from the reported wallet across observed counterparties."
                action={
                  canRun ? (
                    <Button onClick={() => runInvestigation({ focusTab: "fundflow" })} disabled={busy === "investigate"}>
                      <PlayCircle className="size-4" /> Run investigation
                    </Button>
                  ) : undefined
                }
              />
            )}
          </CardContent>
        </Card>
      ) : null}

      {tab === "journey" ? (
        <Card>
          <CardHeader>
            <CardTitle>Fraud journey timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <JourneyTimeline steps={inv?.journey ?? []} />
          </CardContent>
        </Card>
      ) : null}

      {tab === "intelligence" ? (
        inv ? (
          <IntelligenceBoard inv={inv} />
        ) : (
          <EmptyState
            icon={Brain}
            title="Run the investigation"
            description="The intelligence board populates once the multi-engine investigation has been executed."
            action={
              canRun ? (
                <Button onClick={() => runInvestigation()} disabled={busy === "investigate"}>
                  <PlayCircle className="size-4" /> Run investigation
                </Button>
              ) : undefined
            }
          />
        )
      ) : null}

      {tab === "evidence" ? <EvidenceAndActivity caseId={c.id} activity={c.activity} /> : null}

      {tab === "notes" ? <NotesPanel caseId={c.id} notes={c.notes} canEdit={canEdit} onAdded={() => mutate()} /> : null}
    </div>
  )
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border/50 pb-1.5 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  )
}

function EvidenceAndActivity({
  caseId,
  activity,
}: {
  caseId: string
  activity: { id: string; actor: string; action: string; detail: string; createdAt: string }[]
}) {
  const { data } = useEvidence(caseId)
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Chain of evidence</CardTitle>
            {data ? (
              <Badge
                variant="outline"
                style={{
                  color: data.integrity.valid ? "var(--risk-low)" : "var(--risk-critical)",
                  borderColor: `color-mix(in oklch, ${data.integrity.valid ? "var(--risk-low)" : "var(--risk-critical)"} 40%, transparent)`,
                }}
              >
                {data.integrity.valid ? "Integrity verified" : "Integrity broken"}
              </Badge>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {!data ? (
            <Spinner />
          ) : data.records.length ? (
            data.records.map((r) => (
              <div key={r.id} className="rounded-md border border-border bg-background/40 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-foreground">{r.title}</span>
                  <ProvenanceBadge provenance={r.provenance} />
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground text-pretty">{r.summary}</p>
                <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
                  <span className="font-mono">{r.contentHash.slice(0, 24)}…</span>
                  <span>
                    {r.createdBy} · {relTime(r.createdAt)}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <p className="text-xs text-muted-foreground">No evidence recorded.</p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Activity history</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {activity
            .slice()
            .reverse()
            .map((a) => (
              <div key={a.id} className="flex items-start gap-2 border-b border-border/50 pb-2 last:border-0">
                <span className="mt-1 size-1.5 shrink-0 rounded-full bg-primary/70" />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-foreground">{humanize(a.action)}</p>
                  <p className="text-[11px] text-muted-foreground text-pretty">{a.detail}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {a.actor} · {relTime(a.createdAt)}
                  </p>
                </div>
              </div>
            ))}
        </CardContent>
      </Card>
    </div>
  )
}

function NotesPanel({
  caseId,
  notes,
  canEdit,
  onAdded,
}: {
  caseId: string
  notes: { id: string; author: string; createdAt: string; body: string }[]
  canEdit: boolean
  onAdded: () => void
}) {
  const [body, setBody] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      await apiPost(`/api/cases/${caseId}/notes`, { body })
      setBody("")
      onAdded()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add note.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Case notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {notes.length ? (
            notes
              .slice()
              .reverse()
              .map((n) => (
                <div key={n.id} className="rounded-md border border-border bg-background/40 p-3">
                  <p className="text-xs leading-relaxed text-foreground/85 text-pretty">{n.body}</p>
                  <p className="mt-1.5 text-[10px] text-muted-foreground">
                    {n.author} · {relTime(n.createdAt)}
                  </p>
                </div>
              ))
          ) : (
            <p className="text-xs text-muted-foreground">No notes yet.</p>
          )}
        </CardContent>
      </Card>
      {canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle>Add note</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={add} className="space-y-2">
              <Textarea
                placeholder="Record an observation, action taken, or coordination step…"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="font-sans text-sm"
              />
              {error ? <ErrorState message={error} /> : null}
              <Button type="submit" disabled={submitting || !body.trim()}>
                {submitting ? <Spinner className="text-primary-foreground" /> : <Send className="size-4" />} Add note
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
