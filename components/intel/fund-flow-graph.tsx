"use client"

import * as React from "react"
import { Info, Route } from "lucide-react"
import { CopyAddress, AttributionBadge } from "@/components/intel/shared"
import { Badge } from "@/components/ui/badge"
import { usdOrUnknown, dateTime, shortAddr } from "@/lib/client/format"
import type { TraceGraph, TraceNode, TraceEdge, TraceNodeType } from "@/lib/engines/fund-tracing"

const TYPE_COLOR: Record<TraceNodeType, string> = {
  TARGET: "var(--primary)",
  COUNTERPARTY: "var(--chart-2)",
  INTERMEDIATE: "var(--muted-foreground)",
  VASP: "var(--risk-low)",
}

const TYPE_LABEL: Record<TraceNodeType, string> = {
  TARGET: "Target wallet",
  COUNTERPARTY: "Direct counterparty",
  INTERMEDIATE: "Intermediate hop",
  VASP: "Possible VASP",
}

const NODE_RADIUS = 9
const COL_WIDTH = 190
const ROW_HEIGHT = 56
const PADDING = 40

interface Positioned extends TraceNode {
  x: number
  y: number
}

function layout(nodes: TraceNode[]): Map<string, Positioned> {
  const byHop = new Map<number, TraceNode[]>()
  for (const n of nodes) {
    const list = byHop.get(n.hop) ?? []
    list.push(n)
    byHop.set(n.hop, list)
  }
  const positioned = new Map<string, Positioned>()
  const maxHop = Math.max(0, ...Array.from(byHop.keys()))
  for (let hop = 0; hop <= maxHop; hop++) {
    const col = byHop.get(hop) ?? []
    col.forEach((n, i) => {
      positioned.set(n.id, {
        ...n,
        x: PADDING + hop * COL_WIDTH,
        y: PADDING + i * ROW_HEIGHT,
      })
    })
  }
  return positioned
}

export function FundFlowGraph({ graph }: { graph: TraceGraph }) {
  const positions = React.useMemo(() => layout(graph.nodes), [graph.nodes])
  const [selectedNode, setSelectedNode] = React.useState<string | null>(graph.targetWallet)
  const [selectedEdge, setSelectedEdge] = React.useState<string | null>(null)

  const maxHop = Math.max(0, ...graph.nodes.map((n) => n.hop))
  const rowsPerHop = Math.max(
    1,
    ...Array.from(new Set(graph.nodes.map((n) => n.hop))).map(
      (hop) => graph.nodes.filter((n) => n.hop === hop).length,
    ),
  )
  const width = PADDING * 2 + maxHop * COL_WIDTH + 20
  const height = PADDING * 2 + Math.max(0, rowsPerHop - 1) * ROW_HEIGHT + 20

  const node = selectedNode ? positions.get(selectedNode) : null
  const edge = selectedEdge ? graph.edges.find((e) => e.id === selectedEdge) : null
  const nodeEdges = node ? graph.edges.filter((e) => e.from === node.id || e.to === node.id) : []

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        {(Object.keys(TYPE_LABEL) as TraceNodeType[]).map((t) => (
          <span key={t} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ background: TYPE_COLOR[t] }} />
            {TYPE_LABEL[t]}
          </span>
        ))}
      </div>

      <div className="overflow-x-auto scrollbar-thin rounded-lg border border-border bg-[radial-gradient(circle_at_1px_1px,var(--border)_1px,transparent_0)] [background-size:22px_22px]">
        <svg width={Math.max(width, 360)} height={Math.max(height, 140)} className="block">
          {graph.edges.map((e) => {
            const a = positions.get(e.from)
            const b = positions.get(e.to)
            if (!a || !b) return null
            const active = selectedEdge === e.id
            return (
              <line
                key={e.id}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={active ? "var(--primary)" : "var(--border)"}
                strokeWidth={active ? 2.5 : 1.5}
                className="cursor-pointer"
                onClick={() => {
                  setSelectedEdge(e.id)
                  setSelectedNode(null)
                }}
              >
                <title>
                  {shortAddr(e.from)} → {shortAddr(e.to)} · {usdOrUnknown(e.usdValue)} · {e.txHash.slice(0, 14)}…
                </title>
              </line>
            )
          })}
          {Array.from(positions.values()).map((n) => {
            const active = selectedNode === n.id
            return (
              <g
                key={n.id}
                transform={`translate(${n.x}, ${n.y})`}
                className="cursor-pointer"
                onClick={() => {
                  setSelectedNode(n.id)
                  setSelectedEdge(null)
                }}
              >
                {active ? (
                  <circle r={NODE_RADIUS + 5} fill="none" stroke="var(--primary)" strokeWidth={1.5} strokeOpacity={0.6} />
                ) : null}
                <circle r={NODE_RADIUS} fill={TYPE_COLOR[n.type]} stroke="var(--background)" strokeWidth={2} />
                <text x={0} y={NODE_RADIUS + 14} textAnchor="middle" className="fill-muted-foreground text-[10px] font-mono">
                  {shortAddr(n.id)}
                </text>
                <title>
                  {n.id} · {TYPE_LABEL[n.type]} · hop {n.hop}
                  {n.vasp ? ` · ${n.vasp.name} (${n.attribution})` : ""}
                </title>
              </g>
            )
          })}
        </svg>
      </div>

      {graph.truncated ? (
        <div className="flex items-start gap-2 rounded-md border border-[var(--demo)]/40 bg-[var(--demo)]/5 px-3 py-2.5 text-xs text-foreground">
          <Info className="mt-0.5 size-4 shrink-0 text-[var(--demo)]" />
          <span>
            <strong className="font-semibold">Partial trace. </strong>
            {graph.truncationReasons.join(" ")}
          </span>
        </div>
      ) : null}

      {node ? (
        <div className="rounded-md border border-border bg-background/40 p-3 text-xs">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <CopyAddress address={node.id} full />
            <Badge variant="outline" style={{ color: TYPE_COLOR[node.type], borderColor: `color-mix(in oklch, ${TYPE_COLOR[node.type]} 40%, transparent)` }}>
              {TYPE_LABEL[node.type]}
            </Badge>
            {node.attribution ? <AttributionBadge category={node.attribution} /> : null}
            {node.vasp ? <span className="text-muted-foreground">{node.vasp.name}</span> : null}
          </div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Transfers involving this wallet ({nodeEdges.length})
          </p>
          <div className="space-y-1">
            {nodeEdges.slice(0, 8).map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => {
                  setSelectedEdge(e.id)
                  setSelectedNode(null)
                }}
                className="flex w-full items-center justify-between gap-2 rounded-sm border border-border/50 px-2 py-1.5 text-left hover:border-primary/50"
              >
                <span className="font-mono text-[11px] text-muted-foreground">
                  {shortAddr(e.from)} → {shortAddr(e.to)}
                </span>
                <span className="tabular font-medium text-foreground">{usdOrUnknown(e.usdValue)}</span>
              </button>
            ))}
            {nodeEdges.length === 0 ? <p className="text-muted-foreground">No transfers recorded for this wallet.</p> : null}
          </div>
        </div>
      ) : null}

      {edge ? (
        <div className="rounded-md border border-border bg-background/40 p-3 text-xs">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <Route className="size-3.5" /> Transaction detail
          </div>
          <div className="grid gap-1.5 sm:grid-cols-2">
            <DetailRow label="Hash" value={edge.txHash} mono />
            <DetailRow label="Amount" value={`${edge.amount} ${edge.asset}`} />
            <DetailRow label="USD value" value={usdOrUnknown(edge.usdValue)} />
            <DetailRow label="Time" value={edge.timestamp ? dateTime(edge.timestamp) : "Unknown"} />
            <DetailRow label="From" value={edge.from} mono />
            <DetailRow label="To" value={edge.to} mono />
          </div>
        </div>
      ) : null}

      <p className="text-[11px] text-muted-foreground text-pretty">{graph.summary}</p>
    </div>
  )
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-1 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono text-foreground" : "font-medium text-foreground"}>{value}</span>
    </div>
  )
}
