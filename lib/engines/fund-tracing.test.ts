import { describe, expect, it, vi } from "vitest"
import {
  FundTracingEngine,
  DEFAULT_MAX_HOPS,
  ABSOLUTE_MAX_HOPS,
  traceFundsFromContext,
  type HopFetcher,
  type HopFetchResult,
} from "@/lib/engines/fund-tracing"
import { buildContext } from "@/lib/engines/context"
import type { GraphNode, GraphEdge, Transaction } from "@/lib/types"

function hopResult(overrides: Partial<HopFetchResult> = {}): HopFetchResult {
  return { transactions: [], provenance: "LIVE_BLOCKCHAIN_DATA", ...overrides }
}

function tx(overrides: Partial<Transaction> & { hash: string; from: string; to: string }): Transaction {
  return {
    chain: "ethereum",
    amount: 1,
    asset: "ETH",
    usdValue: 100,
    timestamp: "2025-01-01T00:00:00.000Z",
    blockHeight: 1,
    ...overrides,
  } as Transaction
}

const TARGET = "0xTARGET"
const A = "0xAAA"
const B = "0xBBB"
const VASP = "0xVASP"

describe("FundTracingEngine", () => {
  it("stops expansion at the requested hop count", async () => {
    const seed = [tx({ hash: "t1", from: TARGET, to: A })]
    const fetchNextHop: HopFetcher = vi.fn(async (address) => {
      if (address === A) return hopResult({ transactions: [tx({ hash: "t2", from: A, to: B })] })
      return hopResult()
    })

    const engine = new FundTracingEngine()
    const graph = await engine.trace({
      targetWallet: TARGET,
      chain: "ethereum",
      transactions: seed,
      provenance: "LIVE_BLOCKCHAIN_DATA",
      maxHops: 1,
      fetchNextHop,
    })

    expect(graph.hopsReached).toBe(1)
    expect(graph.nodes.map((n) => n.id)).toEqual([TARGET, A])
    expect(fetchNextHop).not.toHaveBeenCalled()
  })

  it("clamps maxHops to the absolute maximum", async () => {
    const engine = new FundTracingEngine()
    const graph = await engine.trace({
      targetWallet: TARGET,
      chain: "ethereum",
      transactions: [],
      provenance: "LIVE_BLOCKCHAIN_DATA",
      maxHops: 99,
    })
    expect(graph.maxHops).toBe(ABSOLUTE_MAX_HOPS)
  })

  it("defaults to 2 hops when maxHops is omitted", async () => {
    const engine = new FundTracingEngine()
    const graph = await engine.trace({
      targetWallet: TARGET,
      chain: "ethereum",
      transactions: [],
      provenance: "LIVE_BLOCKCHAIN_DATA",
    })
    expect(graph.maxHops).toBe(DEFAULT_MAX_HOPS)
  })

  it("never re-expands a wallet already visited (loop prevention)", async () => {
    // TARGET -> A -> TARGET (a cycle). The fetcher must only ever be asked
    // for A's transactions once; it must never be asked to expand TARGET again.
    const seed = [tx({ hash: "t1", from: TARGET, to: A })]
    const fetchNextHop: HopFetcher = vi.fn(async (address) => {
      if (address === A) return hopResult({ transactions: [tx({ hash: "t2", from: A, to: TARGET })] })
      return hopResult()
    })

    const engine = new FundTracingEngine()
    const graph = await engine.trace({
      targetWallet: TARGET,
      chain: "ethereum",
      transactions: seed,
      provenance: "LIVE_BLOCKCHAIN_DATA",
      maxHops: 3,
      fetchNextHop,
    })

    expect(fetchNextHop).toHaveBeenCalledTimes(1)
    expect(fetchNextHop).toHaveBeenCalledWith(A, "ethereum")
    // Only two nodes ever exist — TARGET is never duplicated.
    expect(graph.nodes).toHaveLength(2)
    // The cycle edge (A -> TARGET) is still recorded as real observed data.
    expect(graph.edges.some((e) => e.from === A && e.to === TARGET)).toBe(true)
  })

  it("deduplicates the same transaction seen from multiple sides (duplicate prevention)", async () => {
    // The same tx (t1: TARGET -> A) is present in both the target's and A's
    // transaction lists (as would happen with a real explorer response).
    const seed = [tx({ hash: "t1", from: TARGET, to: A })]
    const fetchNextHop: HopFetcher = vi.fn(async () =>
      hopResult({ transactions: [tx({ hash: "t1", from: TARGET, to: A }), tx({ hash: "t2", from: A, to: B })] }),
    )

    const engine = new FundTracingEngine()
    const graph = await engine.trace({
      targetWallet: TARGET,
      chain: "ethereum",
      transactions: seed,
      provenance: "LIVE_BLOCKCHAIN_DATA",
      maxHops: 2,
      fetchNextHop,
    })

    expect(graph.edges.filter((e) => e.txHash === "t1")).toHaveLength(1)
    expect(graph.edges.some((e) => e.txHash === "t2")).toBe(true)
  })

  it("builds representative paths from the target through observed transfers", async () => {
    const seed = [tx({ hash: "t1", from: TARGET, to: A })]
    const fetchNextHop: HopFetcher = vi.fn(async () => hopResult({ transactions: [tx({ hash: "t2", from: A, to: VASP })] }))

    const engine = new FundTracingEngine()
    const graph = await engine.trace({
      targetWallet: TARGET,
      chain: "ethereum",
      transactions: seed,
      provenance: "LIVE_BLOCKCHAIN_DATA",
      maxHops: 2,
      fetchNextHop,
      attributionFor: (address) =>
        address === VASP
          ? {
              category: "KNOWN",
              vasp: {
                id: "v1",
                name: "Demo Exchange",
                type: "EXCHANGE",
                jurisdiction: "US",
                kycLevel: "HIGH",
                cooperationLevel: "HIGH",
                note: "",
              },
            }
          : null,
    })

    expect(graph.paths).toHaveLength(1)
    expect(graph.paths[0].addresses).toEqual([TARGET, A, VASP])
    expect(graph.paths[0].endType).toBe("VASP")
    const vaspNode = graph.nodes.find((n) => n.id === VASP)
    expect(vaspNode?.type).toBe("VASP")
  })

  it("flags a truncated trace when safety limits are exceeded", async () => {
    const seed = Array.from({ length: 5 }, (_, i) => tx({ hash: `t${i}`, from: TARGET, to: `0xC${i}` }))
    const engine = new FundTracingEngine({ maxTransactionsPerAddress: 2 })
    const graph = await engine.trace({
      targetWallet: TARGET,
      chain: "ethereum",
      transactions: seed,
      provenance: "LIVE_BLOCKCHAIN_DATA",
      maxHops: 1,
    })

    expect(graph.truncated).toBe(true)
    expect(graph.truncationReasons.length).toBeGreaterThan(0)
    expect(graph.edges).toHaveLength(2)
  })

  it("never exceeds the node cap regardless of fan-out", async () => {
    const seed = Array.from({ length: 20 }, (_, i) => tx({ hash: `t${i}`, from: TARGET, to: `0xC${i}` }))
    const engine = new FundTracingEngine({ maxNodes: 5 })
    const graph = await engine.trace({
      targetWallet: TARGET,
      chain: "ethereum",
      transactions: seed,
      provenance: "LIVE_BLOCKCHAIN_DATA",
      maxHops: 1,
    })

    expect(graph.nodes.length).toBeLessThanOrEqual(5)
    expect(graph.truncated).toBe(true)
  })

  it("only expands the highest-value counterparties per hop", async () => {
    const seed = [
      tx({ hash: "t1", from: TARGET, to: A, usdValue: 10 }),
      tx({ hash: "t2", from: TARGET, to: B, usdValue: 1000 }),
    ]
    const fetchNextHop: HopFetcher = vi.fn(async () => hopResult())

    const engine = new FundTracingEngine({ maxAddressesPerHop: 1 })
    await engine.trace({
      targetWallet: TARGET,
      chain: "ethereum",
      transactions: seed,
      provenance: "LIVE_BLOCKCHAIN_DATA",
      maxHops: 2,
      fetchNextHop,
    })

    expect(fetchNextHop).toHaveBeenCalledTimes(1)
    expect(fetchNextHop).toHaveBeenCalledWith(B, "ethereum") // higher usdValue wins
  })

  it("marks the graph as demo data when any hop returns demo data", async () => {
    const seed = [tx({ hash: "t1", from: TARGET, to: A })]
    const fetchNextHop: HopFetcher = vi.fn(async () =>
      hopResult({ transactions: [tx({ hash: "t2", from: A, to: B })], provenance: "DEMO_DATA" }),
    )

    const engine = new FundTracingEngine()
    const graph = await engine.trace({
      targetWallet: TARGET,
      chain: "ethereum",
      transactions: seed,
      provenance: "LIVE_BLOCKCHAIN_DATA",
      maxHops: 2,
      fetchNextHop,
    })

    expect(graph.provenance).toBe("DEMO_DATA")
  })

  it("stops early with a clear reason when no hop fetcher is supplied but counterparties exist", async () => {
    const seed = [tx({ hash: "t1", from: TARGET, to: A })]
    const engine = new FundTracingEngine()
    const graph = await engine.trace({
      targetWallet: TARGET,
      chain: "ethereum",
      transactions: seed,
      provenance: "LIVE_BLOCKCHAIN_DATA",
      maxHops: 2,
    })

    expect(graph.hopsReached).toBe(1)
    expect(graph.truncated).toBe(true)
    expect(graph.truncationReasons.some((r) => r.includes("No transaction fetcher"))).toBe(true)
  })
})

describe("traceFundsFromContext (case-investigation integration)", () => {
  it("traces multiple hops directly from an AnalysisContext's transaction pool, without any external fetcher", async () => {
    // TARGET -> A -> VASP, all present in the same context transaction pool
    // (as a demo scenario's full multi-hop graph would provide).
    const transactions = [
      tx({ hash: "t1", from: TARGET, to: A }),
      tx({ hash: "t2", from: A, to: VASP }),
    ]
    const nodes: GraphNode[] = [
      { id: TARGET, kind: "SUSPICIOUS", chain: "ethereum", depth: 0, provenance: "DEMO_DATA" },
      { id: A, kind: "UNKNOWN", chain: "ethereum", depth: 1, provenance: "DEMO_DATA" },
      { id: VASP, kind: "EXCHANGE", chain: "ethereum", depth: 2, provenance: "DEMO_DATA" },
    ]
    const edges: GraphEdge[] = [
      { id: "e1", source: TARGET, target: A, kind: "SENT_FUNDS", amount: 1, asset: "ETH", usdValue: 100, timestamp: "2025-01-01T00:00:00.000Z", txHash: "t1" },
      { id: "e2", source: A, target: VASP, kind: "SENT_FUNDS", amount: 1, asset: "ETH", usdValue: 100, timestamp: "2025-01-01T00:05:00.000Z", txHash: "t2" },
    ]
    const ctx = buildContext({
      chain: "ethereum",
      rootAddress: TARGET,
      reportedLossUsd: 100,
      nodes,
      edges,
      transactions,
      depth: 5,
      provenance: "DEMO_DATA",
    })

    const graph = await traceFundsFromContext(ctx, { maxHops: 2 })

    expect(graph.hopsReached).toBe(2)
    expect(graph.nodes.map((n) => n.id).sort()).toEqual([A, TARGET, VASP].sort())
    expect(graph.edges).toHaveLength(2)
    expect(graph.paths.some((p) => p.addresses.join(">") === [TARGET, A, VASP].join(">"))).toBe(true)
  })

  it("stops gracefully when a counterparty's transactions are not present in the context pool", async () => {
    // A manual case: only the root wallet's own transactions were fetched.
    const transactions = [tx({ hash: "t1", from: TARGET, to: A })]
    const ctx = buildContext({
      chain: "ethereum",
      rootAddress: TARGET,
      reportedLossUsd: 100,
      nodes: [],
      edges: [],
      transactions,
      depth: 1,
      provenance: "LIVE_BLOCKCHAIN_DATA",
    })

    const graph = await traceFundsFromContext(ctx, { maxHops: 2 })

    expect(graph.hopsReached).toBe(2)
    expect(graph.edges).toHaveLength(1)
    // A has no transactions of its own in the pool, so the second hop yields nothing new.
    expect(graph.nodes.map((n) => n.id).sort()).toEqual([A, TARGET].sort())
  })

  it("prefers ExitPoint AI's VASP attribution when present for a traced address", async () => {
    const transactions = [tx({ hash: "t1", from: TARGET, to: VASP })]
    const ctx = buildContext({
      chain: "ethereum",
      rootAddress: TARGET,
      reportedLossUsd: 100,
      nodes: [],
      edges: [],
      transactions,
      depth: 1,
      provenance: "LIVE_BLOCKCHAIN_DATA",
    })

    const graph = await traceFundsFromContext(ctx, {
      maxHops: 1,
      exitPoints: [
        {
          address: VASP,
          usdValue: 100,
          inboundValue: 100,
          isTerminal: true,
          attribution: {
            category: "PROBABLE",
            vasp: {
              id: "v1",
              name: "Demo Exchange",
              type: "EXCHANGE",
              jurisdiction: "US",
              kycLevel: "MEDIUM",
              cooperationLevel: "MEDIUM",
              note: "",
            },
            confidence: 0.6,
            reason: "test",
            provenance: "PROBABLE_ATTRIBUTION",
          },
        },
      ],
    })

    const vaspNode = graph.nodes.find((n) => n.id === VASP)
    expect(vaspNode?.type).toBe("VASP")
    expect(vaspNode?.vasp?.name).toBe("Demo Exchange")
  })
})
