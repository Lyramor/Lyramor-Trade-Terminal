import { useState, useMemo } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import type { EquityCurvePoint } from '../api'
import { getIntlLocale } from '../lib/intl'
import { Toolbar } from './layout/Toolbar'
import { SegmentedControl, type SegmentedOption } from './filters/SegmentedControl'

// ==================== Time ranges ====================

const RANGES = [
  { label: '1H', ms: 60 * 60 * 1000 },
  { label: '6H', ms: 6 * 60 * 60 * 1000 },
  { label: '24H', ms: 24 * 60 * 60 * 1000 },
  { label: '7D', ms: 7 * 24 * 60 * 60 * 1000 },
  { label: '30D', ms: 30 * 24 * 60 * 60 * 1000 },
  { label: 'All', ms: 0 },
] as const

type RangeLabel = (typeof RANGES)[number]['label']

const RANGE_OPTIONS: SegmentedOption<RangeLabel>[] = RANGES.map((r) => ({
  value: r.label,
  label: r.label,
}))

const CHART_HEIGHT = 220

// ==================== Props ====================

interface EquityCurveProps {
  points: EquityCurvePoint[]
  accounts: Array<{ id: string; label: string }>
  selectedAccountId: string | 'all'
  onAccountChange: (id: string | 'all') => void
  onPointClick?: (point: EquityCurvePoint) => void
  selectedTimestamp?: string | null
  /**
   * Tampilkan pemilih akun, termasuk tombol "All".
   *
   * Bawaannya mengikuti perilaku lama (`accounts.length > 1`) supaya halaman
   * detail UTA yang cuma punya satu akun tidak mendadak dapat kendali yang
   * tidak berarti apa-apa di sana. Halaman Portfolio mengisinya `true` secara
   * eksplisit: di sana "All" adalah basis yang sama dengan angka hero, jadi
   * jalan kembali ke sana harus selalu ada, bahkan saat akunnya cuma satu.
   */
  showAccountSwitcher?: boolean
}

// ==================== Component ====================

export function EquityCurve({
  points, accounts, selectedAccountId, onAccountChange,
  onPointClick, selectedTimestamp,
  showAccountSwitcher,
}: EquityCurveProps) {
  const [range, setRange] = useState<RangeLabel>('24H')

  const filtered = useMemo(() => {
    const r = RANGES.find(r => r.label === range)
    if (!r || r.ms === 0) return points
    const cutoff = Date.now() - r.ms
    return points.filter(p => new Date(p.timestamp).getTime() >= cutoff)
  }, [points, range])

  // Convert to chart data
  const chartData = useMemo(() =>
    filtered.map(p => ({
      ...p,
      time: new Date(p.timestamp).getTime(),
      equityNum: Number(p.equity),
    })),
  [filtered])

  // Explicit Y domain + ticks. Recharts' default 'auto' domain rounds tick
  // values so coarsely that tight ranges render duplicate labels
  // ("$100.7K $100.7K $100.6K …") — compute our own 4 ticks with a
  // formatter precise enough to keep them distinct.
  const yAxis = useMemo(() => {
    const vals = chartData.map(d => d.equityNum).filter(v => Number.isFinite(v))
    if (vals.length === 0) return null
    let min = Math.min(...vals)
    let max = Math.max(...vals)
    if (min === max) { min -= 1; max += 1 }
    const pad = (max - min) * 0.08
    const lo = min - pad
    const hi = max + pad
    const ticks = [0, 1, 2, 3].map(i => lo + ((hi - lo) * i) / 3)
    return {
      domain: [lo, hi] as [number, number],
      ticks,
      formatter: makeCurrencyTickFormatter(max - min, (hi - lo) / 3),
    }
  }, [chartData])

  // Explicit X ticks aligned to round time boundaries (whole hours, local
  // midnights) instead of recharts' arbitrary data-point positions.
  const xTicks = useMemo(() => computeTimeTicks(chartData), [chartData])

  const isAllView = selectedAccountId === 'all'

  const accountOptions = useMemo<SegmentedOption<string>[]>(
    () => [
      ...accounts.map((a) => ({ value: a.id, label: a.label })),
      { value: 'all', label: 'All', title: 'Every account combined' },
    ],
    [accounts],
  )

  // Kalau pemanggil tidak menyebut, pakai perilaku lama supaya halaman
  // satu-akun tidak berubah tanpa diminta.
  const withSwitcher = showAccountSwitcher ?? accounts.length > 1

  return (
    <div className="border border-border rounded-lg bg-bg-secondary p-4">
      {/* Kepala: judul + kendali. Membungkus, karena deret rentang dan deret
          akun bersama-sama tidak pernah muat di telepon. */}
      <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <h3 className="text-[13px] font-semibold text-text-muted uppercase tracking-wide">
          Equity Curve
        </h3>
        <Toolbar dense ariaLabel="Equity curve controls" className="max-w-full">
          <SegmentedControl
            options={RANGE_OPTIONS}
            value={range}
            onChange={setRange}
            ariaLabel="Time range"
            size="sm"
          />
          {withSwitcher && (
            <SegmentedControl
              options={accountOptions}
              value={selectedAccountId}
              onChange={onAccountChange}
              ariaLabel="Chart account"
              size="sm"
            />
          )}
        </Toolbar>
      </div>

      {/* Kendalinya sudah digambar di atas, jadi keadaan kosong cuma mengganti
          badan isinya. Dulu seluruh komponen di-`return null` di sini, dan
          memilih rentang yang kebetulan kosong berarti tombol rentangnya ikut
          lenyap: tidak ada lagi jalan kembali ke "All" selain memuat ulang. */}
      {chartData.length === 0 ? (
        <div
          style={{ height: CHART_HEIGHT }}
          className="flex items-center justify-center rounded border border-dashed border-border px-4 text-center text-[12px] text-text-muted"
        >
          {points.length === 0 || range === 'All'
            ? 'No snapshots recorded for this account yet.'
            : `No equity data in the last ${range}. Pick a wider range.`}
        </div>
      ) : (
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <AreaChart
          data={chartData}
          onClick={(e: any) => {
            if (e?.activePayload?.[0]?.payload && onPointClick) {
              onPointClick(e.activePayload[0].payload as EquityCurvePoint)
            }
          }}
        >
          <defs>
            <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--color-accent)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="var(--color-accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="time"
            type="number"
            domain={['dataMin', 'dataMax']}
            ticks={xTicks}
            tickFormatter={formatTime}
            tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }}
            axisLine={{ stroke: 'var(--color-border)' }}
            tickLine={false}
            minTickGap={40}
          />
          <YAxis
            tickFormatter={yAxis?.formatter ?? formatCurrency}
            tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }}
            axisLine={false}
            tickLine={false}
            width={70}
            domain={yAxis?.domain ?? ['auto', 'auto']}
            ticks={yAxis?.ticks}
          />
          <Tooltip content={<CustomTooltip isAllView={isAllView} accounts={accounts} />} />
          <Area
            type="monotone"
            dataKey="equityNum"
            stroke="var(--color-accent)"
            strokeWidth={1.5}
            fill="url(#equityGradient)"
            dot={false}
            activeDot={{ r: 4, fill: 'var(--color-accent)', stroke: 'var(--color-bg-secondary)', strokeWidth: 2 }}
          />
          {selectedTimestamp && (
            <ReferenceLine
              x={new Date(selectedTimestamp).getTime()}
              stroke="var(--color-accent)"
              strokeDasharray="3 3"
              strokeOpacity={0.6}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
      )}
    </div>
  )
}

// ==================== Custom Tooltip ====================

function CustomTooltip({ active, payload, isAllView, accounts }: any) {
  if (!active || !payload?.[0]) return null
  const data = payload[0].payload as EquityCurvePoint & { time: number }
  const accountMap = new Map((accounts as Array<{ id: string; label: string }>).map(a => [a.id, a.label]))

  return (
    <div className="bg-bg-secondary border border-border rounded-md px-3 py-2 shadow-lg text-[12px]">
      <p className="text-text-muted mb-1">
        {new Date(data.time).toLocaleString()}
      </p>
      <p className="text-text font-semibold tabular-nums">
        ${Number(data.equity).toLocaleString(getIntlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </p>
      {isAllView && data.accounts && Object.keys(data.accounts).length > 1 && (
        <div className="mt-1.5 pt-1.5 border-t border-border space-y-0.5">
          {Object.entries(data.accounts).map(([id, val]) => (
            <div key={id} className="flex justify-between gap-4">
              <span className="text-text-muted">{accountMap.get(id) ?? id}</span>
              <span className="text-text tabular-nums">
                ${Number(val).toLocaleString(getIntlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ==================== Formatters ====================

function formatTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString(getIntlLocale(), { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString(getIntlLocale(), { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString(getIntlLocale(), { hour: '2-digit', minute: '2-digit' })
}

function formatCurrency(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`
  if (val >= 1_000) return `$${(val / 1_000).toFixed(1)}K`
  return `$${val.toFixed(0)}`
}

/**
 * Tick formatter with range-aware precision: tight ranges (< $2,000 across
 * the visible window) render full dollars with thousands separators
 * ("$100,680"); wider ranges keep the compact K/M form but with enough
 * decimals that adjacent ticks stay distinct ("$100.68K").
 */
function makeCurrencyTickFormatter(range: number, tickSpacing: number): (val: number) => string {
  return (val: number) => {
    if (range < 2000) {
      const decimals = range < 10 ? 2 : 0
      return `$${val.toLocaleString(getIntlLocale(), { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
    }
    if (Math.abs(val) < 1_000) return `$${val.toFixed(0)}`
    const unit = Math.abs(val) >= 1_000_000 ? 1_000_000 : 1_000
    const suffix = unit === 1_000_000 ? 'M' : 'K'
    // Enough fractional digits that one tick step is resolvable at this unit.
    const decimals = Math.min(4, Math.max(1, Math.ceil(-Math.log10(tickSpacing / unit))))
    return `$${(val / unit).toFixed(decimals)}${suffix}`
  }
}

// ==================== X-axis round ticks ====================

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Candidate tick steps, smallest first. */
const TICK_STEPS = [5 * MINUTE, 15 * MINUTE, HOUR, 3 * HOUR, 6 * HOUR, DAY] as const

/**
 * Pick the smallest step that yields ≤ 6 ticks across the visible range and
 * align tick values to round boundaries — epoch-aligned for sub-day steps
 * (whole hours / 5-minute marks), local midnight for day-sized steps. For
 * ranges beyond what 1-day steps can cover in 6 ticks, step by N days.
 */
function computeTimeTicks(data: Array<{ time: number }>): number[] | undefined {
  if (data.length < 2) return undefined
  const t0 = data[0].time
  const t1 = data[data.length - 1].time
  const span = t1 - t0
  if (span <= 0) return undefined

  const step = TICK_STEPS.find(s => span / s <= 6) ?? DAY
  const ticks: number[] = []
  if (step >= DAY) {
    const stride = Math.max(1, Math.ceil(span / (6 * DAY)))
    const d = new Date(t0)
    d.setHours(0, 0, 0, 0)
    if (d.getTime() < t0) d.setDate(d.getDate() + 1)
    for (; d.getTime() <= t1; d.setDate(d.getDate() + stride)) ticks.push(d.getTime())
  } else {
    for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) ticks.push(t)
  }
  return ticks.length >= 2 ? ticks : undefined
}
