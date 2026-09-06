import { NextResponse } from "next/server"
import { ensureSeeded } from "@/lib/store"
import { requireUser } from "@/lib/api/session"
import { blockchain, DATA_SOURCE_LABEL } from "@/lib/blockchain"
import { validateAddress } from "@/lib/blockchain/address-utils"
import type { TxQueryOptions } from "@/lib/blockchain/data-source"
import type { Chain } from "@/lib/types"

// Parse the optional investigation-scoping query params into TxQueryOptions.
// Absent/blank/invalid values are simply omitted so the provider defaults apply.
function parseQueryOptions(url: URL): TxQueryOptions {
  const options: TxQueryOptions = {}
  const startDate = url.searchParams.get("startDate")
  const endDate = url.searchParams.get("endDate")
  const maxTransactions = Number(url.searchParams.get("maxTransactions"))
  const page = Number(url.searchParams.get("page"))
  const offset = Number(url.searchParams.get("offset"))
  const maxPages = Number(url.searchParams.get("maxPages"))
  if (startDate && !Number.isNaN(Date.parse(startDate))) options.startDate = startDate
  if (endDate && !Number.isNaN(Date.parse(endDate))) options.endDate = endDate
  if (Number.isFinite(maxTransactions) && maxTransactions > 0) options.maxTransactions = maxTransactions
  if (Number.isFinite(page) && page > 0) options.page = page
  if (Number.isFinite(offset) && offset > 0) options.offset = offset
  if (Number.isFinite(maxPages) && maxPages > 0) options.maxPages = maxPages
  return options
}

export async function GET(req: Request, { params }: { params: Promise<{ address: string }> }) {
  await ensureSeeded()
  const auth = await requireUser()
  if ("response" in auth) return auth.response
  const { address } = await params
  const url = new URL(req.url)
  const chainParam = url.searchParams.get("chain") as Chain | null

  const validation = validateAddress(address, chainParam ?? undefined)
  if (!validation.valid || !validation.chain) {
    return NextResponse.json({ error: validation.reason, validation }, { status: 400 })
  }
  const chain = (chainParam && validation.candidateChains.includes(chainParam) ? chainParam : validation.chain) as Chain

  const options = parseQueryOptions(url)
  const inspection = await blockchain.inspectWallet(address, chain, options)

  return NextResponse.json({
    validation,
    // New, honest source labeling:
    dataSource: inspection.dataSource,
    dataSourceLabel: DATA_SOURCE_LABEL[inspection.dataSource],
    demo: inspection.demo,
    notice: inspection.notice ?? null,
    provider: inspection.provider,
    fetchedAt: inspection.fetchedAt,
    cached: inspection.cached,
    // Pagination / truncation metadata so the UI can honestly say when the
    // returned history was capped at the investigation maximum.
    meta: inspection.meta ?? null,
    truncated: inspection.meta?.truncated ?? false,
    metadata: inspection.metadata,
    balance: inspection.balance,
    transactions: inspection.transactions,
    tokenTransfers: inspection.tokenTransfers,
    // Back-compat fields for existing UI consumers:
    mode: inspection.demo ? "DEMO" : "LIVE",
    provenance: inspection.demo ? "DEMO_DATA" : "LIVE_BLOCKCHAIN_DATA",
  })
}
