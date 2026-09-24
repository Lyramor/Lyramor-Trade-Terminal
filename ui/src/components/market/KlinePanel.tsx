import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  type CandlestickData,
  type HistogramData,
} from 'lightweight-charts'
import { barsApi, type AssetClass, type HistoricalBar, type BarSourceCandidate, type BarMeta } from '../../api/market'
import { SegmentedControl } from '../filters/SegmentedControl'
import { Toolbar, ToolbarGroup } from '../layout/Toolbar'

type Interval = '1m' | '5m' | '1h' | '1d'
type Timeframe = '1D' | '5D' | '1M' | '3M' | '1Y' | '5Y' | 'All'

const INTERVALS: Interval[] = ['1m', '5m', '1h', '1d']
const TIMEFRAMES: Timeframe[] = ['1D', '5D', '1M', '3M', '1Y', '5Y', 'All']
const DEFAULT_INTERVAL: Interval = '1d'
const DEFAULT_RANGE: Timeframe = '1Y'

function parseInterval(s: string | null): Interval {
  return (INTERVALS as string[]).includes(s ?? '') ? (s as Interval) : DEFAULT_INTERVAL
}

function parseTimeframe(s: string | null): Timeframe {
  return (TIMEFRAMES as string[]).includes(s ?? '') ? (s as Timeframe) : DEFAULT_RANGE
}

const INTRADAY: ReadonlySet<Interval> = new Set(['1m', '5m', '1h'])

/**
 * Penjagaan silang antara Interval dan Range.
 *
 * Dua kendali ini dulu berdiri sendiri tanpa saling tahu, dan sebagian
 * pasangannya tidak mungkin dilayani: `1m` dengan `1Y` berarti meminta 365
 * hari data per menit, yang berakhir jadi muatan raksasa atau pesan "No bars
 * in this range" tanpa sebab yang kelihatan. Sebaliknya `1d` dengan `1D` cuma
 * menghasilkan satu batang, jadi grafiknya kosong secara visual.
 *
 * Daftar di bawah menyebut rentang yang masih wajar untuk tiap lebar batang,
 * kira-kira sampai sepuluh ribu batang sekali muat. Ini soal apa yang muat di
 * layar dan di jaringan, bukan soal perhitungan harga, jadi tidak ada angka
 * pasar yang tersentuh.
 */
const RANGES_FOR_INTERVAL: Record<Interval, readonly Timeframe[]> = {
  '1m': ['1D', '5D'],
  '5m': ['1D', '5D', '1M'],
  '1h': ['1D', '5D', '1M', '3M', '1Y'],
  '1d': ['5D', '1M', '3M', '1Y', '5Y', 'All'],
}

function rangeAllowed(interval: Interval, tf: Timeframe): boolean {
  return RANGES_FOR_INTERVAL[interval].includes(tf)
}

/** Rentang sah yang paling dekat dengan yang sedang dipilih. */
function nearestRange(interval: Interval, tf: Timeframe): Timeframe {
  const allowed = RANGES_FOR_INTERVAL[interval]
  if (allowed.includes(tf)) return tf
  const wanted = TIMEFRAMES.indexOf(tf)
  let best = allowed[0]
  let bestDistance = Infinity
  for (const candidate of allowed) {
    const distance = Math.abs(TIMEFRAMES.indexOf(candidate) - wanted)
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}

/** Kalimat yang memberi tahu apa yang barusan digeser, dan kenapa. */
function adjustmentNote(interval: Interval, from: Timeframe, to: Timeframe): string {
  const allowed = RANGES_FOR_INTERVAL[interval]
  const tooWide = TIMEFRAMES.indexOf(from) > TIMEFRAMES.indexOf(to)
  return tooWide
    ? `Range moved from ${from} to ${to}. ${interval} bars load at most ${allowed[allowed.length - 1]} of history.`
    : `Range moved from ${from} to ${to}. ${interval} bars need at least ${allowed[0]} to draw more than a candle or two.`
}

function intervalHint(interval: Interval): string {
  const allowed = RANGES_FOR_INTERVAL[interval]
  return `Candle width. Works with ${allowed[0]} to ${allowed[allowed.length - 1]}.`
}

function daysForTimeframe(tf: Timeframe): number | null {
  switch (tf) {
    case '1D': return 1
    case '5D': return 5
    case '1M': return 30
    case '3M': return 90
    case '1Y': return 365
    case '5Y': return 365 * 5
    case 'All': return null
  }
}

function startDateFromToday(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

function toUTCTimestamp(s: string): UTCTimestamp {
  // Daily bars use `YYYY-MM-DD`; intraday uses `YYYY-MM-DD HH:MM:SS`.
  const iso = s.includes(' ') ? s.replace(' ', 'T') + 'Z' : `${s}T00:00:00Z`
  return Math.floor(new Date(iso).getTime() / 1000) as UTCTimestamp
}

interface Props {
  selection: { symbol: string; assetClass: AssetClass } | null
}

export function KlinePanel({ selection }: Props) {
  const sourceSelectId = useId()
  const [searchParams, setSearchParams] = useSearchParams()
  const interval = parseInterval(searchParams.get('interval'))
  const tf = parseTimeframe(searchParams.get('range'))
  // The provider picked at search time (a barId), if any — opens the chart on it.
  const sourceParam = searchParams.get('source')

  // Local setter named `selectInterval` rather than `setInterval` so it
  // doesn't shadow the global timer function we use for polling below.
  const selectInterval = (iv: Interval) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (iv === DEFAULT_INTERVAL) next.delete('interval')
      else next.set('interval', iv)
      return next
    }, { replace: true })
  }
  const setTf = (t: Timeframe) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (t === DEFAULT_RANGE) next.delete('range')
      else next.set('range', t)
      return next
    }, { replace: true })
  }

  // Pesan yang muncul saat rentangnya digeser sendiri karena intervalnya
  // berubah. Tanpa ini, tombol Range terlihat pindah tanpa sebab.
  //
  // Pasangan yang sedang dijelaskan ikut disimpan. Efek di bawah jalan lagi
  // tepat setelah rentangnya digeser, dan kalau pesannya dibuang begitu
  // pasangannya sudah sah, dia cuma berkedip sepersekian detik lalu hilang.
  const [autoNote, setAutoNote] = useState<{ interval: Interval; tf: Timeframe; text: string } | null>(null)

  // Rapikan pasangan interval dan range yang tidak bisa dilayani. Dijalankan
  // dari efek, bukan cuma dari penanganan klik, karena pasangannya juga bisa
  // datang dari URL: SearchBox membawa interval dan range lama ke simbol baru,
  // dan alamat bisa diketik tangan.
  useEffect(() => {
    const fixed = nearestRange(interval, tf)
    if (fixed === tf) {
      // Simpan pesan yang memang menjelaskan pasangan ini, buang yang lain.
      setAutoNote((prev) => (prev && prev.interval === interval && prev.tf === tf ? prev : null))
      return
    }
    setAutoNote({ interval, tf: fixed, text: adjustmentNote(interval, tf, fixed) })
    setTf(fixed)
    // setTf dibuat ulang tiap render (bukan useCallback), jadi tidak ikut
    // jadi dependency supaya efeknya tidak berputar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interval, tf])

  const [bars, setBars] = useState<HistoricalBar[] | null>(null)
  const [meta, setMeta] = useState<BarMeta | null>(null)
  const [candidates, setCandidates] = useState<BarSourceCandidate[]>([])
  // null = vendor default for this symbol; a barId = an explicitly-picked source.
  // Seed from the URL so the very first fetch is the right source (no vendor flicker).
  const [selectedBarId, setSelectedBarId] = useState<string | null>(sourceParam)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null)

  // Build chart once.
  useEffect(() => {
    if (!containerRef.current) return
    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: 'transparent' },
        textColor: '#c9d1d9',
        panes: { separatorColor: '#30363d', separatorHoverColor: '#58a6ff33' },
      },
      grid: {
        vertLines: { color: '#21262d' },
        horzLines: { color: '#21262d' },
      },
      rightPriceScale: { borderColor: '#30363d' },
      timeScale: { borderColor: '#30363d', timeVisible: false, secondsVisible: false },
      autoSize: true,
    })

    const candle = chart.addSeries(CandlestickSeries, {
      upColor: '#3fb950',
      downColor: '#f85149',
      borderUpColor: '#3fb950',
      borderDownColor: '#f85149',
      wickUpColor: '#3fb950',
      wickDownColor: '#f85149',
    })

    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    }, 1)
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0 } })

    chartRef.current = chart
    candleRef.current = candle
    volumeRef.current = volume

    return () => {
      chart.remove()
      chartRef.current = null
      candleRef.current = null
      volumeRef.current = null
    }
  }, [])

  // Toggle time-axis detail when interval flips between intraday and daily.
  useEffect(() => {
    chartRef.current?.timeScale().applyOptions({ timeVisible: INTRADAY.has(interval) })
  }, [interval])

  // Discover the available bar sources for this symbol (populates the picker).
  // Seed the picked source from the URL (?source=barId, set at search time);
  // otherwise null → vendor default.
  useEffect(() => {
    setSelectedBarId(sourceParam)
    setCandidates([])
    if (!selection || selection.assetClass === 'commodity') return
    let cancelled = false
    barsApi.searchSources(selection.symbol, 12)
      .then((r) => { if (!cancelled) setCandidates(r.candidates) })
      .catch(() => { if (!cancelled) setCandidates([]) })
    return () => { cancelled = true }
  }, [selection, sourceParam])

  // Fetch bars: an explicitly-picked source (barId) or the vendor default
  // (symbol+assetClass). Re-polls so a long-open tab doesn't show stale bars.
  useEffect(() => {
    if (!selection) { setBars(null); setMeta(null); setError(null); return }
    if (selection.assetClass === 'commodity') {
      setBars(null)
      setMeta(null)
      setError('Commodity K-line support is coming in the next step.')
      return
    }
    // Pasangan yang mustahil tidak usah dikirim ke jaringan sama sekali.
    // Efek penjaga di atas sudah menggeser rentangnya, dan efek ini jalan
    // lagi begitu URL-nya berubah.
    if (!rangeAllowed(interval, tf)) return
    let cancelled = false
    const run = (isInitial: boolean) => {
      if (isInitial) setLoading(true)
      setError(null)
      const days = daysForTimeframe(tf)
      const params: Parameters<typeof barsApi.bars>[0] = { interval }
      if (selectedBarId) params.barId = selectedBarId
      else { params.symbol = selection.symbol; params.assetClass = selection.assetClass }
      if (days != null) params.start = startDateFromToday(days)

      barsApi.bars(params)
        .then((res) => {
          if (cancelled) return
          if (res.error || !res.results) {
            setError(res.error ?? 'No data returned.'); setBars(null); setMeta(null)
          } else if (res.results.length === 0) {
            setError('No bars in this range.'); setBars([]); setMeta(res.meta)
          } else {
            setBars(res.results); setMeta(res.meta)
          }
        })
        .catch((e) => {
          if (cancelled) return
          setError(e instanceof Error ? e.message : String(e)); setBars(null); setMeta(null)
        })
        .finally(() => { if (!cancelled && isInitial) setLoading(false) })
    }
    run(true)
    // 60s for intraday intervals (1m/5m/1h) because each tick is a fresh bar;
    // 5min for daily because a refresh within a single day is cosmetic.
    const pollMs = INTRADAY.has(interval) ? 60_000 : 300_000
    const timer = setInterval(() => run(false), pollMs)
    return () => { cancelled = true; clearInterval(timer) }
  }, [selection, selectedBarId, interval, tf])

  // Push bars into chart and fit.
  useEffect(() => {
    if (!candleRef.current || !volumeRef.current || !chartRef.current) return
    if (!bars || bars.length === 0) {
      candleRef.current.setData([])
      volumeRef.current.setData([])
      return
    }

    const candleData: CandlestickData[] = bars.map((b) => ({
      time: toUTCTimestamp(b.date),
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    }))
    const volumeData: HistogramData[] = bars.map((b) => ({
      time: toUTCTimestamp(b.date),
      value: b.volume ?? 0,
      color: b.close >= b.open ? '#3fb95055' : '#f8514955',
    }))

    candleRef.current.setData(candleData)
    volumeRef.current.setData(volumeData)
    chartRef.current.timeScale().fitContent()
  }, [bars])

  const title = useMemo(() => {
    if (!selection) return 'Select a symbol'
    return `${selection.symbol} · ${selection.assetClass}`
  }, [selection])

  // Source options for the picker — always include the currently-shown provider
  // (even if it wasn't in the search results), so the dropdown reflects reality.
  const sourceOptions = useMemo<BarSourceCandidate[]>(() => {
    const opts = [...candidates]
    if (meta?.barId && !opts.some((c) => c.barId === meta.barId)) {
      opts.unshift({ barId: meta.barId, source: meta.source, sourceId: meta.sourceId, symbol: meta.symbol, assetClass: 'unknown', label: meta.sourceId, barCapability: meta.barCapability })
    }
    return opts
  }, [candidates, meta])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between py-2 px-1 gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[13px] font-medium text-text truncate">{title}</span>
          {meta && (
            <span
              className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-bg-tertiary text-text-muted font-medium"
              title={`Provider: ${meta.barId}${meta.barCapability ? ` (${meta.barCapability})` : ''}`}
            >
              {meta.sourceId}{meta.barCapability ? ` · ${meta.barCapability}` : ''}
            </span>
          )}
          {bars && bars.length > 0 && (
            <span className="text-[11px] text-text-muted/60 truncate">
              {bars.length} bars · {bars[0].date} → {bars[bars.length - 1].date}
            </span>
          )}
        </div>
        <Toolbar ariaLabel="Chart controls">
          {sourceOptions.length > 1 && (
            <ToolbarGroup label="Source" htmlFor={sourceSelectId}>
              <select
                id={sourceSelectId}
                value={selectedBarId ?? meta?.barId ?? ''}
                onChange={(e) => setSelectedBarId(e.target.value || null)}
                className="bg-bg-tertiary border border-border rounded px-2 py-1 text-[12px] text-text cursor-pointer max-w-[240px]"
                title="Which provider's K-line to show — sources are never merged; you pick"
              >
                {sourceOptions.map((c) => (
                  <option key={c.barId} value={c.barId}>
                    {c.sourceId} · {c.symbol}{c.barCapability ? ` (${c.barCapability})` : ''}
                  </option>
                ))}
              </select>
            </ToolbarGroup>
          )}
          {/* Interval selalu bisa dipilih: itu maksud utama pengguna. Range
              yang menyesuaikan, dan pilihan yang tidak bisa dilayani interval
              sekarang ditampilkan redup, bukan dihilangkan, supaya kelihatan
              bahwa pilihan itu memang ada. */}
          <SegmentedControl
            label="Interval"
            options={INTERVALS.map((iv) => ({ value: iv, label: iv, title: intervalHint(iv) }))}
            value={interval}
            onChange={selectInterval}
          />
          <SegmentedControl
            label="Range"
            options={TIMEFRAMES.map((t) => ({
              value: t,
              label: t,
              disabled: !rangeAllowed(interval, t),
              title: rangeAllowed(interval, t)
                ? 'How far back to load history'
                : `Not available at ${interval} bars`,
            }))}
            value={tf}
            onChange={(t) => { setAutoNote(null); setTf(t) }}
          />
        </Toolbar>
      </div>

      {autoNote && (
        <p role="status" className="px-1 pb-2 text-[11px] text-text-muted">
          {autoNote.text}
        </p>
      )}

      <div className="relative flex-1 min-h-0 border border-border rounded bg-bg-secondary/30">
        <div ref={containerRef} className="absolute inset-0" />
        {!selection && (
          <div className="absolute inset-0 flex items-center justify-center text-[13px] text-text-muted">
            Pick an asset to see the K-line.
          </div>
        )}
        {selection && loading && (
          <div className="absolute top-2 right-2 text-[11px] text-text-muted">Loading…</div>
        )}
        {selection && error && !loading && (
          <div className="absolute inset-0 flex items-center justify-center text-[13px] text-text-muted px-8 text-center">
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
