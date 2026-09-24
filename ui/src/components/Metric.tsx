import type { ReactNode } from 'react'

export type MetricSize = 'sm' | 'md' | 'lg'
export type MetricSign = 'up' | 'down' | 'flat'

export interface MetricDelta {
  /** Pre-formatted display string, e.g. "+$201.40 (+0.84%)". */
  value: string
  sign: MetricSign
}

interface MetricProps {
  label: string
  value: ReactNode
  delta?: MetricDelta
  /** Color the value itself by sign — for PnL metrics. Falls back to neutral text. */
  valueSign?: MetricSign
  size?: MetricSize
  className?: string
}

/**
 * Label + big-number + optional delta block. Replaces the per-page inline
 * `Metric` components in UTADetailPage / SnapshotDetail / etc. Sign-driven
 * color logic (green up, red down, neutral flat) lives in one place so
 * the visual contract is consistent.
 *
 * Sizes:
 *   sm — secondary metrics row (Cash, Buying Power, etc.). 16px value.
 *   md — card-level metric (UTA card NLV). 22px value.
 *   lg — page hero (UTA detail page NLV). Pakai `.text-display`.
 *
 * Ukuran `lg` dulu menulis sendiri `text-[28px] md:text-[36px]`, yaitu salinan
 * tangan dari `.text-display` yang sudah ada di index.css. Sekarang memakai
 * kelasnya langsung, jadi angka hero di seluruh aplikasi ikut satu skala dan
 * mengalir mulus, bukan melompat di 768px.
 *
 * Nilainya selalu `tabular-nums` karena angka di sini berdetak: tanpa lebar
 * digit yang sama, seluruh baris bergoyang tiap kali harganya berubah.
 */
export function Metric({ label, value, delta, valueSign, size = 'md', className }: MetricProps) {
  const valueClass = (() => {
    const color = signColor(valueSign)
    switch (size) {
      case 'sm': return `text-[16px] font-semibold tabular-nums ${color}`
      case 'lg': return `text-display ${color}`
      case 'md':
      default:   return `text-[22px] font-bold tabular-nums ${color}`
    }
  })()

  return (
    <div className={`min-w-0 ${className ?? ''}`}>
      <p className="text-micro text-text-muted uppercase [overflow-wrap:anywhere]">{label}</p>
      <p className={`[overflow-wrap:anywhere] ${valueClass}`}>{value}</p>
      {delta && (
        <p className={`text-caption tabular-nums mt-0.5 ${signColor(delta.sign)}`}>
          {arrowFor(delta.sign)} {delta.value}
        </p>
      )}
    </div>
  )
}

function signColor(sign?: MetricSign): string {
  if (sign === 'up') return 'text-green'
  if (sign === 'down') return 'text-red'
  return 'text-text'
}

function arrowFor(sign: MetricSign): string {
  if (sign === 'up') return '▲'
  if (sign === 'down') return '▼'
  return '·'
}

/** Pick a sign from a numeric delta. `flat` for `0` (or NaN). */
export function signFromDelta(n: number | null | undefined): MetricSign {
  if (n == null || !Number.isFinite(n) || n === 0) return 'flat'
  return n > 0 ? 'up' : 'down'
}
