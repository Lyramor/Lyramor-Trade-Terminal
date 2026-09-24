import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { LineChart, Line, ResponsiveContainer, YAxis, XAxis, Tooltip } from 'recharts'
import { useReferenceBoard } from '../components/market/useReferenceBoard'
import { BoardMeta } from '../components/market/BoardMeta'
import { PageHeader } from '../components/PageHeader'
import { CenteredLoading } from '../components/StateViews'
import { Container } from '../components/layout/Container'
import { TableScroll } from '../components/layout/TableScroll'
import { SegmentedControl } from '../components/filters/SegmentedControl'
import { DateRangeFilter, resolvePreset, toDateInput, type DateRangePreset } from '../components/filters/DateRangeFilter'
import { useFilterRange, type FilterRange } from '../hooks/useFilterParam'
import { SeriesCard, fmtSeriesValue, fmtCompactNum } from '../components/market/SeriesCard'
import {
  referenceApi,
  type MoversBoard, type MoverRow, type ReferenceMeta, type CalendarBoard,
  type MacroBoard, type MacroSeriesCard, type TermStructureBoard, type TermCurve,
  type GlobalMacroBoard, type GlobalMacroCell, type ShippingBoard, type ShippingCurve,
  type FedBoard,
} from '../api/reference'
import { useWorkspace } from '../tabs/store'
import type { ViewSpec } from '../tabs/types'

type BoardKind = Extract<ViewSpec, { kind: 'market-board' }>['params']['board']

/** Tab titles (plain English, matching the registry's other title strings). */
export const MARKET_BOARD_TITLES: Record<BoardKind, string> = {
  movers: 'Movers',
  calendar: 'Calendar',
  macro: 'Macro',
  'term-structure': 'Term Structure',
  'global-macro': 'Global Macro',
  shipping: 'Shipping',
  fed: 'Fed',
}

const REFRESH_MS = 5 * 60 * 1000

interface PageProps {
  spec: Extract<ViewSpec, { kind: 'market-board' }>
  visible: boolean
}

export function MarketBoardPage({ spec }: PageProps) {
  switch (spec.params.board) {
    case 'movers':
      return <MoversBoardView />
    case 'calendar':
      return <CalendarBoardView />
    case 'macro':
      return <MacroBoardView />
    case 'term-structure':
      return <TermStructureBoardView />
    case 'global-macro':
      return <GlobalMacroBoardView />
    case 'shipping':
      return <ShippingBoardView />
    case 'fed':
      return <FedBoardView />
  }
}

// ==================== Movers ====================

const MOVERS_LISTS = [
  'gainers', 'losers', 'active', 'undervaluedGrowth', 'growthTech', 'smallCaps', 'undervaluedLarge',
] as const

type MoversList = (typeof MOVERS_LISTS)[number]

function MoversBoardView() {
  const { t } = useTranslation()
  const { data, updatedAt, loading, error } = useReferenceBoard<MoversBoard>(referenceApi.movers, REFRESH_MS)
  const [list, setList] = useState<MoversList>('gainers')

  const rows = data?.[list] ?? []

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title={t('market.boardMovers')}
        description={
          <>
            {t('market.moversSubtitle')}
            {data && <BoardMeta meta={data.meta} />}
          </>
        }
        live={{ lastUpdated: updatedAt }}
      />
      <div className="flex-1 overflow-y-auto min-h-0">
        <Container size="wide" className="flex flex-col gap-4 py-4">
          <SegmentedControl
            options={MOVERS_LISTS.map((k) => ({ value: k, label: listLabel(k, t) }))}
            value={list}
            onChange={setList}
            ariaLabel={t('market.boardMovers')}
          />

          {loading && !data && <CenteredLoading label={t('common.loading')} />}
          {error && (
            <div className="text-[13px] text-red border border-red/30 rounded-md px-3 py-2 bg-red/5">{error}</div>
          )}
          {data && rows.length === 0 && !loading && (
            <div className="text-[13px] text-text-muted">{t('market.noMatches')}</div>
          )}
          {rows.length > 0 && <MoversTable rows={rows} />}
        </Container>
      </div>
    </div>
  )
}

function listLabel(k: MoversList, t: ReturnType<typeof useTranslation>['t']): string {
  switch (k) {
    case 'gainers': return t('market.moversGainers')
    case 'losers': return t('market.moversLosers')
    case 'active': return t('market.moversActive')
    case 'undervaluedGrowth': return t('market.moversUndervaluedGrowth')
    case 'growthTech': return t('market.moversGrowthTech')
    case 'smallCaps': return t('market.moversSmallCaps')
    case 'undervaluedLarge': return t('market.moversUndervaluedLarge')
  }
}

function MoversTable({ rows }: { rows: MoverRow[] }) {
  const { t } = useTranslation()
  const openOrFocus = useWorkspace((s) => s.openOrFocus)
  return (
    <TableScroll bordered={false} label={t('market.boardMovers')}>
      <table className="w-full text-[12px] border-collapse">
        <thead>
          <tr className="text-text-muted/70 text-left border-b border-border">
            <th className="py-1.5 pr-3 font-medium">{t('market.colSymbol')}</th>
            <th className="py-1.5 px-3 font-medium text-right">{t('market.colPrice')}</th>
            <th className="py-1.5 px-3 font-medium text-right">{t('market.colChangePct')}</th>
            <th className="py-1.5 px-3 font-medium text-right">{t('market.colVolume')}</th>
            <th className="py-1.5 px-3 font-medium text-right">{t('market.colRvol')}</th>
            <th className="py-1.5 pl-3 font-medium text-right">{t('market.colDollarVolume')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.symbol}
              className="border-b border-border/50 hover:bg-bg-secondary/40 cursor-pointer"
              onClick={() => openOrFocus({ kind: 'market-detail', params: { assetClass: 'equity', symbol: r.symbol } })}
            >
              <td className="py-1.5 pr-3">
                <span className="font-mono font-semibold text-text">{r.symbol}</span>
                {r.name && <span className="ml-2 text-text-muted">{r.name}</span>}
              </td>
              <td className="py-1.5 px-3 text-right font-mono text-text">{fmtPrice(r.price)}</td>
              <td className={`py-1.5 px-3 text-right font-mono ${signColor(r.percent_change)}`}>{fmtPct(r.percent_change)}</td>
              <td className="py-1.5 px-3 text-right text-text">{fmtCompact(r.volume)}</td>
              <td className={`py-1.5 px-3 text-right ${rvolColor(r.relative_volume)}`}>{r.relative_volume?.toFixed(2) ?? '—'}</td>
              <td className="py-1.5 pl-3 text-right text-text">{fmtCompact(r.dollar_volume, '$')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  )
}

// ==================== Calendar ====================

type CalendarList = 'earnings' | 'ipos' | 'dividends'

function CalendarBoardView() {
  const { t } = useTranslation()
  const { data, updatedAt, loading, error } = useReferenceBoard<CalendarBoard>(referenceApi.calendar, 30 * 60 * 1000)
  const [list, setList] = useState<CalendarList>('earnings')

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title={t('market.boardCalendar')}
        description={
          <>
            {t('market.calendarSubtitle')}
            {data && <BoardMeta meta={data.meta} extra={`${data.window.start} → ${data.window.end}`} />}
          </>
        }
        live={{ lastUpdated: updatedAt }}
      />
      <div className="flex-1 overflow-y-auto min-h-0">
        <Container size="wide" className="flex flex-col gap-4 py-4">
          <SegmentedControl
            options={(['earnings', 'ipos', 'dividends'] as const).map((k) => ({
              value: k,
              label: `${calendarLabel(k, t)} (${data?.[k].length ?? 0})`,
            }))}
            value={list}
            onChange={setList}
            ariaLabel={t('market.boardCalendar')}
          />

          {loading && !data && <CenteredLoading label={t('common.loading')} />}
          {error && (
            <div className="text-[13px] text-red border border-red/30 rounded-md px-3 py-2 bg-red/5">{error}</div>
          )}
          {/* Per-list upstream failure — loud, with the provider's own message. */}
          {data?.errors?.[list] && (
            <div className="text-[13px] text-red border border-red/30 rounded-md px-3 py-2 bg-red/5">{data.errors[list]}</div>
          )}
          {data && data[list].length === 0 && !loading && !data.errors?.[list] && (
            <div className="text-[13px] text-text-muted">{t('market.noMatches')}</div>
          )}
          {data && list === 'earnings' && data.earnings.length > 0 && <EarningsTable board={data} />}
          {data && list === 'ipos' && data.ipos.length > 0 && <IpoTable board={data} />}
          {data && list === 'dividends' && data.dividends.length > 0 && <DividendTable board={data} />}
        </Container>
      </div>
    </div>
  )
}

function calendarLabel(k: CalendarList, t: ReturnType<typeof useTranslation>['t']): string {
  switch (k) {
    case 'earnings': return t('market.calEarnings')
    case 'ipos': return t('market.calIpos')
    case 'dividends': return t('market.calDividends')
  }
}

function useOpenEquity() {
  const openOrFocus = useWorkspace((s) => s.openOrFocus)
  return (symbol: string | null) => {
    if (!symbol) return
    openOrFocus({ kind: 'market-detail', params: { assetClass: 'equity', symbol } })
  }
}

function EarningsTable({ board }: { board: CalendarBoard }) {
  const { t } = useTranslation()
  const open = useOpenEquity()
  // Sorted by date so the board reads as an agenda.
  const rows = [...board.earnings].sort((a, b) => a.report_date.localeCompare(b.report_date))
  return (
    <CalTable label={t('market.calEarnings')} head={[t('market.colDate'), t('market.colSymbol'), t('market.colEpsPrev'), t('market.colEpsEst')]} rightCols={[2, 3]}>
      {rows.map((r, i) => (
        <tr key={`${r.symbol}-${i}`} className="border-b border-border/50 hover:bg-bg-secondary/40 cursor-pointer" onClick={() => open(r.symbol)}>
          <td className="py-1.5 pr-3 text-text-muted whitespace-nowrap">{r.report_date}</td>
          <td className="py-1.5 px-3">
            <span className="font-mono font-semibold text-text">{r.symbol}</span>
            {r.name && <span className="ml-2 text-text-muted">{r.name}</span>}
          </td>
          <td className="py-1.5 px-3 text-right font-mono text-text">{r.eps_previous ?? '—'}</td>
          <td className="py-1.5 pl-3 text-right font-mono text-text">{r.eps_consensus ?? '—'}</td>
        </tr>
      ))}
    </CalTable>
  )
}

function IpoTable({ board }: { board: CalendarBoard }) {
  const { t } = useTranslation()
  const open = useOpenEquity()
  const rows = [...board.ipos].sort((a, b) => (a.ipo_date ?? '').localeCompare(b.ipo_date ?? ''))
  return (
    <CalTable label={t('market.calIpos')} head={[t('market.colDate'), t('market.colSymbol'), t('market.colExchange')]}>
      {rows.map((r, i) => (
        <tr key={`${r.symbol}-${i}`} className="border-b border-border/50 hover:bg-bg-secondary/40 cursor-pointer" onClick={() => open(r.symbol)}>
          <td className="py-1.5 pr-3 text-text-muted whitespace-nowrap">{r.ipo_date ?? '—'}</td>
          <td className="py-1.5 px-3">
            <span className="font-mono font-semibold text-text">{r.symbol ?? '—'}</span>
            {typeof r.name === 'string' && r.name && <span className="ml-2 text-text-muted">{r.name}</span>}
          </td>
          <td className="py-1.5 pl-3 text-text-muted">{typeof r.exchange === 'string' ? r.exchange : '—'}</td>
        </tr>
      ))}
    </CalTable>
  )
}

function DividendTable({ board }: { board: CalendarBoard }) {
  const { t } = useTranslation()
  const open = useOpenEquity()
  const rows = [...board.dividends].sort((a, b) => a.ex_dividend_date.localeCompare(b.ex_dividend_date))
  return (
    <CalTable label={t('market.calDividends')} head={[t('market.colExDate'), t('market.colSymbol'), t('market.colDivAmount'), t('market.colPayDate')]} rightCols={[2]}>
      {rows.map((r, i) => (
        <tr key={`${r.symbol}-${i}`} className="border-b border-border/50 hover:bg-bg-secondary/40 cursor-pointer" onClick={() => open(r.symbol)}>
          <td className="py-1.5 pr-3 text-text-muted whitespace-nowrap">{r.ex_dividend_date}</td>
          <td className="py-1.5 px-3">
            <span className="font-mono font-semibold text-text">{r.symbol}</span>
            {r.name && <span className="ml-2 text-text-muted">{r.name}</span>}
          </td>
          <td className="py-1.5 px-3 text-right font-mono text-text">{r.amount ?? '—'}</td>
          <td className="py-1.5 pl-3 text-text-muted whitespace-nowrap">{r.payment_date ?? '—'}</td>
        </tr>
      ))}
    </CalTable>
  )
}

function CalTable({ head, rightCols = [], label, children }: { head: string[]; rightCols?: number[]; label: string; children: React.ReactNode }) {
  return (
    <TableScroll bordered={false} label={label}>
      <table className="w-full text-[12px] border-collapse">
        <thead>
          <tr className="text-text-muted/70 text-left border-b border-border">
            {head.map((h, i) => (
              <th key={h} className={`py-1.5 font-medium ${i === 0 ? 'pr-3' : i === head.length - 1 ? 'pl-3' : 'px-3'} ${rightCols.includes(i) ? 'text-right' : ''}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </TableScroll>
  )
}

// ==================== Macro ====================

/**
 * Jendela tanggal papan Macro. Preset di sini MENGISI kedua isian tanggal,
 * jadi tidak ada lagi dua filter yang saling meniadakan seperti versi lama:
 * dulu mengisi satu kotak tanggal mematikan preset sepenuhnya, sementara
 * nilai presetnya masih tersimpan diam-diam dan hidup lagi begitu tombol
 * bersihkan ditekan.
 *
 * Angka presetnya tetap sama dengan sebelumnya (30 / 90 / 180 hari), cuma
 * labelnya sekarang jujur: dulu tertulis "30H" di antarmuka berbahasa
 * Inggris, dan itu terbaca sebagai 30 jam padahal kodenya memang hari.
 */
const MACRO_PRESETS: readonly DateRangePreset[] = [
  { id: '30d', label: '30D', days: 30 },
  { id: '90d', label: '90D', days: 90 },
  { id: '180d', label: '180D', days: 180 },
  { id: '1y', label: '1Y', days: 365 },
]

/** Jendela bawaan, sama dengan yang dipakai papan ini sejak awal. */
const MACRO_DEFAULT_PRESET = MACRO_PRESETS[1]

function MacroBoardView() {
  const { t } = useTranslation()
  const { data, updatedAt, loading, error } = useReferenceBoard<MacroBoard>(referenceApi.macro, 30 * 60 * 1000)
  // Jendela tanggal sisi klien di atas riwayat yang sudah diambil (~1 tahun).
  // Disimpan di URL supaya selamat saat pindah tab, lihat useFilterParam.
  const [range, setRange] = useFilterRange({ scope: 'market-macro' })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const today = useMemo(() => toDateInput(new Date()), [])

  // Isi jendela bawaan sekali saat papan dibuka tanpa rentang di URL. Ditulis
  // ke isian tanggalnya, bukan disimpan diam-diam, supaya yang dilihat
  // pengguna persis sama dengan yang dipakai menyaring. Setelah itu tombol
  // bersihkan benar-benar berarti "seluruh riwayat" dan tidak ada yang
  // menghidupkan preset lama di belakang punggungnya.
  const [seeded, setSeeded] = useState(false)
  useEffect(() => {
    if (seeded) return
    setSeeded(true)
    if (!range.from && !range.to) setRange(resolvePreset(MACRO_DEFAULT_PRESET))
  }, [seeded, range.from, range.to, setRange])

  const cards = (data?.cards ?? []).map((c) => {
    let pts = c.points
    if (range.from) pts = pts.filter((p) => p.date >= range.from)
    if (range.to) pts = pts.filter((p) => p.date <= range.to)
    const latest = pts[pts.length - 1] ?? null
    const prev = pts[pts.length - 2] ?? null
    return {
      ...c,
      points: pts,
      latest: latest?.value ?? null,
      latestDate: latest?.date ?? null,
      change: latest && prev ? latest.value - prev.value : null,
    }
  })

  const selected = data?.cards.find((c) => c.id === selectedId) ?? null

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title={t('market.boardMacro')}
        description={
          <>
            {t('market.macroSubtitle')}
            {data && <BoardMeta meta={data.meta} />}
          </>
        }
        live={{ lastUpdated: updatedAt }}
      />
      <div className="flex-1 overflow-y-auto min-h-0">
        <Container size="wide" className="flex flex-col gap-4 py-4">
          {/* Preset dan isian tanggal hidup berdampingan: preset mengisi
              isiannya, mengubah isian cuma memadamkan presetnya. */}
          <DateRangeFilter
            value={range}
            onChange={setRange}
            presets={MACRO_PRESETS}
            label={t('market.rangePeriod')}
            fromLabel={t('market.rangeFrom')}
            toLabel={t('market.rangeTo')}
            clearLabel={t('market.rangeAll')}
            invalidMessage={t('market.rangeInvalid')}
            max={today}
          />

          {loading && !data && <CenteredLoading label={t('common.loading')} />}
          {error && (
            <div className="text-[13px] text-red border border-red/30 rounded-md px-3 py-2 bg-red/5">{error}</div>
          )}
          {data && (
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {cards.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  className="text-left rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 hover:opacity-90 transition-opacity"
                >
                  <SeriesCard card={c} label={macroLabel(c, t)} emptyText={t('market.noMatches')} />
                </button>
              ))}
            </div>
          )}
        </Container>
      </div>
      {selected && (
        <MacroDetailModal
          card={selected}
          label={macroLabel(selected, t)}
          boardRange={range}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  )
}

/**
 * Full-history detail for one macro series, opened by clicking its card:
 * backdrop + big chart + a scrollable table of the value's progression.
 *
 * Jendela ini sengaja menampilkan SELURUH riwayat dan mengabaikan jendela
 * tanggal yang sedang aktif di papan. Itu keputusan pemilik dan tetap
 * dipertahankan, tapi harus diberi tanda: tanpa penanda, angka Min dan Max
 * di sini tidak akan cocok dengan kartu di belakangnya dan orang mengira
 * datanya salah.
 */
function MacroDetailModal({ card, label, boardRange, onClose }: { card: MacroSeriesCard; label: string; boardRange: FilterRange; onClose: () => void }) {
  const { t } = useTranslation()
  const windowed = Boolean(boardRange.from || boardRange.to)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const values = card.points.map((p) => p.value)
  const min = values.length ? Math.min(...values) : null
  const max = values.length ? Math.max(...values) : null
  const first = card.points[0] ?? null
  const rows = [...card.points].reverse()

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-2xl max-h-[85dvh] flex flex-col rounded-2xl border border-accent/20 bg-bg-secondary/95 backdrop-blur-xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border">
          <div className="flex min-w-0 flex-col">
            <span className="text-[15px] font-semibold text-text [overflow-wrap:anywhere]">{label}</span>
            <span className="text-[11px] font-mono text-text-muted">{card.id} · {card.latestDate ?? ''}</span>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 text-text-muted hover:text-text px-2 py-1 rounded-md hover:bg-bg-tertiary" aria-label={t('market.macroClose')}>✕</button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-4 overflow-y-auto min-h-0">
          {/* Penanda yang bikin Min / Max / Sejak di bawah masuk akal walau
              papannya sedang disaring ke rentang yang jauh lebih pendek. */}
          <p className="rounded-md border border-border bg-bg-tertiary/50 px-3 py-2 text-[11px] leading-relaxed text-text-muted">
            {t('market.macroFullHistory')}
            {windowed && (
              <span className="ml-1 font-mono text-text-muted/80">
                {t('market.macroBoardRange', { from: boardRange.from || '…', to: boardRange.to || '…' })}
              </span>
            )}
          </p>

          <div className="flex flex-wrap gap-x-6 gap-y-1 text-[12px]">
            <MacroStat label={t('market.macroLatest')} value={fmtSeriesValue(card, card.latest)} />
            <MacroStat
              label={t('market.macroChange')}
              value={card.change == null ? '—' : `${card.change > 0 ? '+' : ''}${card.unit === 'count' ? fmtCompactNum(card.change) : card.change.toFixed(2)}`}
              tone={card.change == null || card.change === 0 ? undefined : card.change > 0 ? 'up' : 'down'}
            />
            <MacroStat label={t('market.macroMin')} value={fmtSeriesValue(card, min)} />
            <MacroStat label={t('market.macroMax')} value={fmtSeriesValue(card, max)} />
            <MacroStat label={t('market.macroSince')} value={first?.date ?? '—'} />
          </div>

          <div className="h-64">
            {card.points.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={card.points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#7d8590' }} stroke="#7d8590" minTickGap={40} tickFormatter={(d: string) => d.slice(2)} />
                  <YAxis domain={['dataMin', 'dataMax']} width={56} tick={{ fontSize: 10, fill: '#7d8590' }} stroke="#7d8590" tickFormatter={(v: number) => fmtSeriesValue(card, v)} />
                  <Tooltip
                    formatter={(v) => [fmtSeriesValue(card, Number(v)), label]}
                    contentStyle={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', fontSize: 11, borderRadius: 8 }}
                  />
                  <Line type="monotone" dataKey="value" stroke="var(--color-accent)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-[12px] text-text-muted">{t('market.noData')}</div>
            )}
          </div>

          {/* Dulu pembungkusnya `overflow-hidden` dan memotong kolom di layar
              sempit. TableScroll menggeser mendatar dan tegak sekaligus. */}
          <TableScroll maxHeight="14rem" label={label}>
            <table className="w-full text-[12px] border-collapse">
              <thead className="sticky top-0 bg-bg-tertiary">
                <tr className="text-text-muted text-left">
                  <th className="py-1.5 px-3 font-mono uppercase text-[11px] tracking-wide">{t('market.colDate')}</th>
                  <th className="py-1.5 px-3 font-mono uppercase text-[11px] tracking-wide text-right">{t('market.colValue')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.date} className="border-t border-border/60">
                    <td className="py-1 px-3 font-mono text-text-muted">{p.date}</td>
                    <td className="py-1 px-3 font-mono text-text text-right tabular-nums">{fmtSeriesValue(card, p.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </div>
      </div>
    </div>
  )
}

function MacroStat({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wide text-text-muted/60">{label}</span>
      <span className={`font-mono ${tone === 'up' ? 'text-green' : tone === 'down' ? 'text-red' : 'text-text'}`}>{value}</span>
    </div>
  )
}

/** Known FRED ids → localized labels; anything else falls back to the
 *  English label the contract carries. */
function macroLabel(card: MacroSeriesCard, t: ReturnType<typeof useTranslation>['t']): string {
  switch (card.id) {
    case 'DFF': return t('market.macroFedFunds')
    case 'DGS2': return t('market.macro2y')
    case 'DGS10': return t('market.macro10y')
    case 'T10Y2Y': return t('market.macroSpread')
    case 'UNRATE': return t('market.macroUnemployment')
    case 'CPI_YOY': return t('market.macroCpiYoy')
    case 'ICSA': return t('market.macroClaims')
    case 'DCOILWTICO': return t('market.macroWti')
    case 'DTWEXBGS': return t('market.macroDollar')
    case 'PAYEMS': return t('market.macroPayrolls')
    case 'M2SL': return t('market.macroM2')
    case 'UMCSENT': return t('market.macroSentiment')
    case 'T10YIE': return t('market.macroBreakeven')
    case 'DRTSCILM': return t('market.macroSloos')
    default: return card.label
  }
}

// ==================== Term structure ====================

function TermStructureBoardView() {
  const { t } = useTranslation()
  const { data, updatedAt, loading, error } = useReferenceBoard<TermStructureBoard>(referenceApi.termStructure, 5 * 60 * 1000)

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title={t('market.boardTermStructure')}
        description={
          <>
            {t('market.termSubtitle')}
            {data && <BoardMeta meta={data.meta} />}
          </>
        }
        live={{ lastUpdated: updatedAt }}
      />
      <div className="flex-1 overflow-y-auto min-h-0">
        <Container size="wide" className="flex flex-col gap-6 py-4">
          {loading && !data && <CenteredLoading label={t('common.loading')} />}
          {error && (
            <div className="text-[13px] text-red border border-red/30 rounded-md px-3 py-2 bg-red/5">{error}</div>
          )}
          {data?.errors && Object.entries(data.errors).map(([sym, msg]) => (
            <div key={sym} className="text-[13px] text-red border border-red/30 rounded-md px-3 py-2 bg-red/5">{sym}: {msg}</div>
          ))}
          {data?.curves.map((curve) => <TermCurveCard key={curve.symbol} curve={curve} />)}
        </Container>
      </div>
    </div>
  )
}

function TermCurveCard({ curve }: { curve: TermCurve }) {
  const { t } = useTranslation()
  // Contango when the far end trades above spot; backwardation otherwise.
  const far = curve.points[curve.points.length - 1]
  const regime = far?.price != null && curve.spot != null
    ? (far.price >= curve.spot ? t('market.termContango') : t('market.termBackwardation'))
    : null
  const chartData = curve.points
    .filter((p) => p.price != null)
    .map((p) => ({ ...p, label: p.expiration.slice(2) }))
  return (
    <div className="border border-border rounded-md bg-bg-secondary/40 px-4 py-3 flex flex-col gap-2">
      <div className="flex items-baseline gap-3">
        <span className="text-[15px] font-semibold font-mono text-text">{curve.symbol}</span>
        {curve.spot != null && (
          <span className="text-[12px] text-text-muted">{t('market.termSpotPerp')} <span className="font-mono text-text">{curve.spot.toLocaleString('en-US')}</span></span>
        )}
        {regime && <span className="text-[11px] uppercase tracking-wide text-text-muted/70">{regime}</span>}
      </div>
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#7d8590' }} stroke="#7d8590" />
            <YAxis domain={['dataMin', 'dataMax']} tick={{ fontSize: 10, fill: '#7d8590' }} stroke="#7d8590" width={70}
              tickFormatter={(v: number) => v.toLocaleString('en-US')} />
            <Tooltip
              formatter={(v) => [Number(v).toLocaleString('en-US'), '']}
              labelFormatter={(l) => `20${l}`}
              contentStyle={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', fontSize: 11 }}
            />
            <Line type="monotone" dataKey="price" stroke="var(--color-accent)" strokeWidth={1.5} dot={{ r: 2.5 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {curve.points.map((p) => (
          <span key={p.expiration} className="text-[11px] px-1.5 py-0.5 rounded bg-bg-tertiary/60 font-mono" title={`${p.daysToExpiry ?? '—'}d`}>
            {p.expiration.slice(2)}{' '}
            <span className={p.annualizedBasis == null ? 'text-text-muted' : p.annualizedBasis >= 0 ? 'text-green' : 'text-red'}>
              {p.annualizedBasis == null ? '—' : `${p.annualizedBasis >= 0 ? '+' : ''}${p.annualizedBasis.toFixed(1)}%`}
            </span>
          </span>
        ))}
        {curve.points.length > 0 && (
          <span className="text-[10px] text-text-muted/60 self-center ml-1">{t('market.termBasisNote')}</span>
        )}
      </div>
    </div>
  )
}

// ==================== Global macro ====================

function GlobalMacroBoardView() {
  const { t } = useTranslation()
  const { data, updatedAt, loading, error } = useReferenceBoard<GlobalMacroBoard>(referenceApi.globalMacro, 60 * 60 * 1000)

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title={t('market.boardGlobalMacro')}
        description={
          <>
            {t('market.globalMacroSubtitle')}
            {data && <BoardMeta meta={data.meta} />}
          </>
        }
        live={{ lastUpdated: updatedAt }}
      />
      <div className="flex-1 overflow-y-auto min-h-0">
        <Container size="wide" className="py-4">
          {loading && !data && <CenteredLoading label={t('common.loading')} />}
          {error && (
            <div className="text-[13px] text-red border border-red/30 rounded-md px-3 py-2 bg-red/5">{error}</div>
          )}
          {data && (
            <>
              <TableScroll bordered={false} label={t('market.boardGlobalMacro')}>
                <table className="w-full text-[12px] border-collapse">
                  <thead>
                    <tr className="text-text-muted/70 text-left border-b border-border">
                      <th className="py-1.5 pr-3 font-medium">{t('market.colCountry')}</th>
                      <th className="py-1.5 px-3 font-medium text-right">{t('market.colCpiYoy')}</th>
                      <th className="py-1.5 px-3 font-medium text-right">{t('market.colShortRate')}</th>
                      <th className="py-1.5 px-3 font-medium text-right">{t('market.colCli')}</th>
                      <th className="py-1.5 px-3 font-medium text-right">{t('market.colHousePrice')}</th>
                      <th className="py-1.5 pl-3 font-medium text-right">{t('market.colSharePrice')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r) => (
                      <tr key={r.country} className="border-b border-border/50 hover:bg-bg-secondary/40">
                        <td className="py-1.5 pr-3 text-text font-medium">{r.label}</td>
                        <GlobalCell cell={r.cpiYoy} fmt={(v) => `${v.toFixed(2)}%`} colorBy="cpi" />
                        <GlobalCell cell={r.shortRate} fmt={(v) => `${v.toFixed(2)}%`} />
                        <GlobalCell cell={r.cli} fmt={(v) => v.toFixed(1)} colorBy="cli" />
                        <GlobalCell cell={r.housePrice} fmt={(v) => v.toFixed(1)} />
                        <GlobalCell cell={r.sharePrice} fmt={(v) => v.toFixed(1)} />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
              <p className="mt-2 text-[10px] text-text-muted/60">{t('market.globalMacroNote')}</p>
            </>
          )}
        </Container>
      </div>
    </div>
  )
}

function GlobalCell({ cell, fmt, colorBy }: { cell: GlobalMacroCell; fmt: (v: number) => string; colorBy?: 'cpi' | 'cli' }) {
  if (cell.value == null) {
    return <td className="py-1.5 px-3 text-right text-text-muted/50" title={cell.error ?? 'no data'}>—</td>
  }
  let color = 'text-text'
  if (colorBy === 'cpi') color = cell.value >= 4 ? 'text-red' : cell.value <= 1 ? 'text-text-muted' : 'text-text'
  if (colorBy === 'cli') color = cell.value >= 100 ? 'text-green' : 'text-red'
  return (
    <td className={`py-1.5 px-3 text-right font-mono ${color}`} title={cell.date ?? ''}>{fmt(cell.value)}</td>
  )
}

// ==================== Shipping ====================

function ShippingBoardView() {
  const { t } = useTranslation()
  const { data, updatedAt, loading, error } = useReferenceBoard<ShippingBoard>(referenceApi.shipping, 60 * 60 * 1000)

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title={t('market.boardShipping')}
        description={
          <>
            {t('market.shippingSubtitle')}
            {data && <BoardMeta meta={data.meta} />}
          </>
        }
        live={{ lastUpdated: updatedAt }}
      />
      <div className="flex-1 overflow-y-auto min-h-0">
        <Container size="wide" className="py-4">
          {loading && !data && <CenteredLoading label={t('common.loading')} />}
          {error && (
            <div className="text-[13px] text-red border border-red/30 rounded-md px-3 py-2 bg-red/5">{error}</div>
          )}
          {data?.errors && Object.entries(data.errors).map(([key, msg]) => (
            <div key={key} className="mb-3 text-[13px] text-red border border-red/30 rounded-md px-3 py-2 bg-red/5">{key}: {msg}</div>
          ))}
          {data && (
            <div className="grid gap-3 grid-cols-1 lg:grid-cols-2">
              {data.curves.map((c) => <ChokepointCard key={c.key} curve={c} />)}
            </div>
          )}
        </Container>
      </div>
    </div>
  )
}

function ChokepointCard({ curve }: { curve: ShippingCurve }) {
  const { t } = useTranslation()
  const chartData = curve.points
    .filter((p) => p.tons != null)
    .map((p) => ({ ...p, mt: (p.tons as number) / 1e6, label: p.date.slice(5) }))
  return (
    <div className="border border-border rounded-md bg-bg-secondary/40 px-4 py-3 flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold text-text">{curve.name}</span>
        {curve.latest && (
          <span className="text-[11px] text-text-muted">
            {curve.latest.date} · {curve.latest.vessels ?? '—'} {t('market.shippingVessels')} · {curve.latest.tons != null ? (curve.latest.tons / 1e6).toFixed(2) + 'M t' : '—'}
          </span>
        )}
      </div>
      <div className="h-28">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#7d8590' }} stroke="#7d8590" minTickGap={28} />
            <YAxis tick={{ fontSize: 9, fill: '#7d8590' }} stroke="#7d8590" width={36}
              tickFormatter={(v: number) => v.toFixed(1)} domain={['auto', 'auto']} />
            <Tooltip
              formatter={(v) => [`${Number(v).toFixed(2)}M t`, '']}
              contentStyle={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', fontSize: 11 }}
            />
            <Line type="monotone" dataKey="mt" stroke="var(--color-accent)" strokeWidth={1.25} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ==================== Fed ====================

function FedBoardView() {
  const { t } = useTranslation()
  const { data, updatedAt, loading, error } = useReferenceBoard<FedBoard>(referenceApi.fed, 60 * 60 * 1000)

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title={t('market.boardFed')}
        description={
          <>
            {t('market.fedSubtitle')}
            {data && <BoardMeta meta={data.meta} />}
          </>
        }
        live={{ lastUpdated: updatedAt }}
      />
      <div className="flex-1 overflow-y-auto min-h-0">
        <Container size="wide" className="flex flex-col gap-5 py-4">
          {loading && !data && <CenteredLoading label={t('common.loading')} />}
          {error && (
            <div className="text-[13px] text-red border border-red/30 rounded-md px-3 py-2 bg-red/5">{error}</div>
          )}
          {data?.errors && Object.entries(data.errors).map(([k, msg]) => (
            <div key={k} className="text-[13px] text-red border border-red/30 rounded-md px-3 py-2 bg-red/5">{k}: {msg}</div>
          ))}
          {data && data.cards.length > 0 && (
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {data.cards.map((c) => (
                <SeriesCard key={c.id} card={c} label={fedLabel(c.id, t) ?? c.label} emptyText={t('market.noMatches')} />
              ))}
            </div>
          )}
          {data && data.documents.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted/60">{t('market.fedDocuments')}</h3>
              {data.documents.map((d) => (
                <a
                  key={`${d.type}-${d.date}`}
                  href={d.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-3 px-3 py-1.5 rounded-md border border-border/60 bg-bg-secondary/30 hover:bg-bg-secondary text-[12px]"
                >
                  <span className="font-mono text-text-muted shrink-0">{d.date}</span>
                  <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded shrink-0 ${
                    d.type === 'statement' ? 'bg-accent/15 text-accent'
                    : d.type === 'minutes' ? 'bg-green/15 text-green'
                    : 'bg-bg-tertiary text-text-muted'
                  }`}>{d.type}</span>
                  <span className="text-text truncate">{d.title}</span>
                </a>
              ))}
            </div>
          )}
        </Container>
      </div>
    </div>
  )
}

function fedLabel(id: string, t: ReturnType<typeof useTranslation>['t']): string | null {
  switch (id) {
    case 'WALCL': return t('market.fedTotalAssets')
    case 'TREAST': return t('market.fedTreasuries')
    case 'WSHOMCB': return t('market.fedMbs')
    case 'PD_NET': return t('market.fedDealerNet')
    case 'PD_UST': return t('market.fedDealerTreasuries')
    default: return null
  }
}

function fmtPrice(x: number | null): string {
  return x == null ? '—' : x.toLocaleString('en-US', { maximumFractionDigits: 2 })
}
function fmtPct(x: number | null): string {
  // percent_change is normalized to a fraction in the provider (0.052 = +5.2%).
  return x == null ? '—' : `${x > 0 ? '+' : ''}${(x * 100).toFixed(2)}%`
}
function fmtCompact(x: number | null, prefix = ''): string {
  if (x == null) return '—'
  const abs = Math.abs(x)
  if (abs >= 1e12) return `${prefix}${(x / 1e12).toFixed(2)}T`
  if (abs >= 1e9) return `${prefix}${(x / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${prefix}${(x / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `${prefix}${(x / 1e3).toFixed(1)}K`
  return `${prefix}${x.toFixed(0)}`
}
function signColor(x: number | null): string {
  if (x == null) return 'text-text-muted'
  return x > 0 ? 'text-green' : x < 0 ? 'text-red' : 'text-text-muted'
}
function rvolColor(x: number | null): string {
  if (x == null) return 'text-text-muted'
  return x >= 2 ? 'text-amber-400 font-semibold' : 'text-text'
}
