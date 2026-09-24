import { useEffect, useState } from 'react'
import { marketApi, type FinancialStatementRow } from '../../api/market'
import { Card } from './Card'
import { TableScroll } from '../layout/TableScroll'
import { SegmentedControl } from '../filters/SegmentedControl'
import { fmtMoneyShort } from './format'

type Tab = 'balance' | 'income' | 'cashflow'

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'balance',  label: 'Balance' },
  { key: 'income',   label: 'Income' },
  { key: 'cashflow', label: 'Cash Flow' },
]

// Curated row picks per statement — the raw rows carry 80+ keys, most of
// which are duplicates or derived. Pick the common ones every investor wants.
const ROWS: Record<Tab, Array<{ key: string; label: string; indent?: boolean }>> = {
  balance: [
    { key: 'cash_and_cash_equivalents', label: 'Cash & Equivalents' },
    { key: 'short_term_investments',    label: 'Short-Term Investments' },
    { key: 'net_receivables',           label: 'Receivables', indent: true },
    { key: 'inventory',                 label: 'Inventory', indent: true },
    { key: 'total_current_assets',      label: 'Total Current Assets' },
    { key: 'plant_property_equipment_net', label: 'PP&E (net)' },
    { key: 'goodwill',                  label: 'Goodwill' },
    { key: 'intangible_assets',         label: 'Intangibles' },
    { key: 'long_term_investments',     label: 'Long-Term Investments' },
    { key: 'total_assets',              label: 'Total Assets' },
    { key: 'accounts_payable',          label: 'Accounts Payable' },
    { key: 'short_term_debt',           label: 'Short-Term Debt' },
    { key: 'total_current_liabilities', label: 'Total Current Liabilities' },
    { key: 'long_term_debt',            label: 'Long-Term Debt' },
    { key: 'total_liabilities',         label: 'Total Liabilities' },
    { key: 'total_common_equity',       label: 'Total Equity' },
    { key: 'net_debt',                  label: 'Net Debt' },
  ],
  income: [
    { key: 'revenue',                           label: 'Revenue' },
    { key: 'cost_of_revenue',                   label: 'Cost of Revenue', indent: true },
    { key: 'gross_profit',                      label: 'Gross Profit' },
    { key: 'research_and_development_expense',  label: 'R&D', indent: true },
    { key: 'selling_general_and_admin_expense', label: 'SG&A', indent: true },
    { key: 'total_operating_income',            label: 'Operating Income' },
    { key: 'ebitda',                            label: 'EBITDA' },
    { key: 'ebit',                              label: 'EBIT' },
    { key: 'income_tax_expense',                label: 'Income Tax', indent: true },
    { key: 'consolidated_net_income',           label: 'Net Income' },
    { key: 'basic_earnings_per_share',          label: 'EPS (basic)' },
    { key: 'diluted_earnings_per_share',        label: 'EPS (diluted)' },
  ],
  cashflow: [
    { key: 'net_income',                               label: 'Net Income' },
    { key: 'depreciation_and_amortization',            label: 'D&A', indent: true },
    { key: 'change_in_working_capital',                label: 'Δ Working Capital', indent: true },
    { key: 'net_cash_from_operating_activities',       label: 'CF from Operations' },
    { key: 'capital_expenditure',                      label: 'CapEx', indent: true },
    { key: 'acquisitions',                             label: 'Acquisitions', indent: true },
    { key: 'net_cash_from_investing_activities',       label: 'CF from Investing' },
    { key: 'commonDividendsPaid',                      label: 'Dividends Paid', indent: true },
    { key: 'net_cash_from_financing_activities',       label: 'CF from Financing' },
    { key: 'free_cash_flow',                           label: 'Free Cash Flow' },
    { key: 'cash_at_end_of_period',                    label: 'Ending Cash' },
  ],
}

interface Props {
  symbol: string
}

type CacheEntry = { rows: FinancialStatementRow[]; provider?: string; error?: string }

/** Cache selalu membawa simbol pemiliknya, lihat komentar di bawah. */
type StatementCache = { symbol: string; entries: Partial<Record<Tab, CacheEntry>> }

const NO_ENTRIES: Partial<Record<Tab, CacheEntry>> = {}

export function FinancialStatementsPanel({ symbol }: Props) {
  const [tab, setTab] = useState<Tab>('income')
  // Simbolnya ikut disimpan di dalam cache, jadi cache milik simbol lama
  // otomatis tidak terbaca lagi begitu simbolnya ganti.
  //
  // Dulu ada efek terpisah yang menulis `setCache({})` saat symbol berubah,
  // sementara efek pengambil datanya memasang `cache` sebagai dependency dan
  // memanggil `setCache` di dalamnya. Dua efek yang saling memicu lewat state
  // yang sama itu bikin panel ini rapuh: urutannya bergantung pada kapan
  // React sempat menerapkan pembaruan, dan respons simbol lama punya celah
  // untuk mendarat di bawah simbol baru. Di layar yang dipakai memutuskan
  // soal uang, laporan keuangan perusahaan lain yang nongol diam-diam adalah
  // kesalahan paling mahal yang bisa dibuat panel ini.
  const [cache, setCache] = useState<StatementCache>({ symbol, entries: {} })
  const [loading, setLoading] = useState(false)

  const entries = cache.symbol === symbol ? cache.entries : NO_ENTRIES
  const entry = entries[tab]

  useEffect(() => {
    if (entry) return
    setLoading(true)
    const fetcher =
      tab === 'balance'  ? marketApi.equity.balance  :
      tab === 'income'   ? marketApi.equity.income   :
                           marketApi.equity.cashflow
    let cancelled = false
    const store = (next: CacheEntry) => {
      setCache((prev) => (
        prev.symbol === symbol
          ? { symbol, entries: { ...prev.entries, [tab]: next } }
          : { symbol, entries: { [tab]: next } }
      ))
    }
    fetcher(symbol).then((res) => {
      if (cancelled) return
      store({ rows: res.results ?? [], provider: res.provider, error: res.error })
    })
      .catch((e) => {
        if (cancelled) return
        store({ rows: [], error: e instanceof Error ? e.message : String(e) })
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [symbol, tab, entry])

  const rows = entry?.rows ?? []
  const rowDefs = ROWS[tab]

  const info = [
    entry?.provider ? `Source: ${entry.provider}` : 'Source: (unknown)',
    `Endpoint: /api/market/equity/${tab === 'cashflow' ? 'cash' : tab}`,
    'Annual periods, most recent first. Values scaled (K / M / B / T).',
    'Blank cells are line items this provider doesn\u2019t report for the current period.',
  ].join('\n')

  return (
    <Card
      title="Financial Statements"
      info={info}
      contentClassName="p-0"
      right={
        <SegmentedControl
          options={TABS.map((t) => ({ value: t.key, label: t.label }))}
          value={tab}
          onChange={setTab}
          ariaLabel="Statement"
          size="sm"
        />
      }
    >
      {loading && !entry && <div className="p-3 text-[12px] text-text-muted">Loading…</div>}
      {entry?.error && <div className="p-3 text-[12px] text-red">{entry.error}</div>}
      {!entry?.error && rows.length === 0 && !loading && (
        <div className="p-3 text-[12px] text-text-muted">No data.</div>
      )}
      {rows.length > 0 && (
        <TableScroll bordered={false} label="Financial statements">
          <table className="w-full text-[12px] border-collapse">
            <thead>
              <tr className="border-b border-border/60">
                <th className="text-left font-medium text-text-muted/70 px-3 py-2 sticky left-0 bg-bg-secondary/30">Item</th>
                {rows.map((row) => (
                  <th key={String(row.period_ending ?? row.filing_date)}
                      className="text-right font-medium text-text-muted/70 px-3 py-2 whitespace-nowrap">
                    {periodLabel(row)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rowDefs.map((r) => (
                <tr key={r.key} className="border-b border-border/30 last:border-b-0">
                  <td className={`px-3 py-1.5 ${r.indent ? 'pl-6 text-text-muted' : 'text-text'}`}>
                    {r.label}
                  </td>
                  {rows.map((row) => (
                    <td key={String(row.period_ending)} className="text-right font-mono tabular-nums px-3 py-1.5 whitespace-nowrap">
                      {fmtMoneyShort(row[r.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </Card>
  )
}

function periodLabel(row: FinancialStatementRow): string {
  const period = row.fiscal_period as string | undefined
  const ending = row.period_ending as string | undefined
  const year = ending?.slice(0, 4) ?? ''
  return `${period ?? 'FY'} ${year}`.trim()
}
