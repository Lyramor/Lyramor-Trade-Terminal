import { useMemo } from 'react'
import { cx } from '../layout/Container'
import { SegmentedControl, type SegmentedOption } from './SegmentedControl'
import type { FilterRange } from '../../hooks/useFilterParam'

export interface DateRangePreset {
  id: string
  label: string
  /** Berapa hari ke belakang dari hari ini. `0` berarti hari ini saja. */
  days: number
}

export const DEFAULT_DATE_PRESETS: readonly DateRangePreset[] = [
  { id: '7d', label: '7D', days: 7 },
  { id: '30d', label: '30D', days: 30 },
  { id: '90d', label: '90D', days: 90 },
  { id: '1y', label: '1Y', days: 365 },
]

/**
 * `YYYY-MM-DD` menurut jam dinding setempat.
 *
 * Sengaja tidak memakai `toISOString().slice(0, 10)`, yang membaca tanggal
 * dalam UTC. Untuk siapa pun di timur Greenwich, malam hari itu sudah
 * "besok" menurut UTC, jadi preset "7 hari terakhir" diam-diam meleset satu
 * hari. Input `<input type="date">` sendiri bekerja dalam waktu setempat,
 * jadi dua-duanya harus bicara bahasa yang sama.
 */
export function toDateInput(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Jabarkan sebuah preset jadi rentang tanggal yang konkret. */
export function resolvePreset(preset: DateRangePreset, today: Date = new Date()): FilterRange {
  const end = new Date(today)
  const start = new Date(today)
  start.setDate(start.getDate() - preset.days)
  return { from: toDateInput(start), to: toDateInput(end) }
}

interface DateRangeFilterProps {
  value: FilterRange
  onChange: (next: FilterRange) => void
  presets?: readonly DateRangePreset[]
  /** Keterangan kecil di kiri, misal "Period". */
  label?: string
  fromLabel?: string
  toLabel?: string
  clearLabel?: string
  /** Batas bawah dan atas untuk kedua isian, format `YYYY-MM-DD`. */
  min?: string
  max?: string
  /** Pesan saat tanggal awal melewati tanggal akhir. */
  invalidMessage?: string
  className?: string
}

/**
 * Preset dan isian tanggal yang hidup berdampingan.
 *
 * ## Aturan yang dipaksakan berkas ini
 *
 * **Preset MENGISI isian tanggal, bukan menggantikannya.** Pola yang salah
 * dan berulang di aplikasi ini adalah memperlakukan keduanya sebagai dua
 * cabang yang saling meniadakan: ada mode preset dan ada mode tanggal, dan
 * memilih salah satu menyembunyikan yang lain. Akibatnya pengguna tidak bisa
 * mengambil "30 hari terakhir" lalu menggeser ujungnya sedikit, padahal itu
 * justru yang paling sering dia mau. Lebih buruk lagi, dia jadi tidak pernah
 * bisa melihat tanggal persis yang sedang berlaku.
 *
 * Di sini keduanya selalu tampil. Menekan preset menulis tanggal konkret ke
 * kedua isian. Mengubah salah satu isian cuma membuat tidak ada preset yang
 * menyala lagi, dan itu sudah cukup sebagai tanda "ini rentang khusus".
 * Tidak ada yang disembunyikan, tidak ada yang perlu ditebak.
 *
 * Preset yang menyala dihitung dengan membandingkan nilai sekarang terhadap
 * preset yang dijabarkan hari ini. Jadi rentang yang tersimpan dari kemarin
 * otomatis terbaca sebagai rentang khusus, bukan ikut menyala sebagai preset
 * yang sebenarnya sudah menunjuk tanggal lain.
 *
 * Pasangkan dengan `useFilterRange` supaya rentangnya selamat saat pindah tab:
 *
 * ```tsx
 * const [range, setRange] = useFilterRange({ scope: 'logs' })
 * <DateRangeFilter value={range} onChange={setRange} label="Period" />
 * ```
 */
export function DateRangeFilter({
  value,
  onChange,
  presets = DEFAULT_DATE_PRESETS,
  label,
  fromLabel = 'From',
  toLabel = 'To',
  clearLabel = 'Clear',
  min,
  max,
  invalidMessage = 'The start date is after the end date.',
  className,
}: DateRangeFilterProps) {
  const activeId = useMemo(() => {
    if (!value.from || !value.to) return ''
    const today = new Date()
    const match = presets.find((preset) => {
      const resolved = resolvePreset(preset, today)
      return resolved.from === value.from && resolved.to === value.to
    })
    return match?.id ?? ''
  }, [presets, value.from, value.to])

  const presetOptions = useMemo<SegmentedOption<string>[]>(
    () => presets.map((preset) => ({ value: preset.id, label: preset.label })),
    [presets],
  )

  const pickPreset = (id: string) => {
    const preset = presets.find((candidate) => candidate.id === id)
    if (preset) onChange(resolvePreset(preset))
  }

  // Perbandingan string cukup: format `YYYY-MM-DD` berurut secara leksikal.
  const invalid = Boolean(value.from && value.to && value.from > value.to)
  const dirty = Boolean(value.from || value.to)

  const inputClass = cx(
    'min-w-0 rounded border border-border bg-bg-tertiary px-2 py-1 text-[12px] text-text',
    'outline-none transition-colors focus:border-accent',
    '[@media(pointer:coarse)]:py-1.5',
  )

  return (
    <div className={cx('flex min-w-0 flex-col gap-1.5', className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        {label && <span className="text-micro uppercase text-text-muted/70 shrink-0">{label}</span>}

        <SegmentedControl
          options={presetOptions}
          value={activeId}
          onChange={pickPreset}
          ariaLabel={label ? `${label} presets` : 'Date presets'}
          size="sm"
        />

        <div className="flex min-w-0 items-center gap-1.5">
          <input
            type="date"
            value={value.from}
            min={min}
            max={max}
            aria-label={fromLabel}
            aria-invalid={invalid || undefined}
            onChange={(event) => onChange({ ...value, from: event.target.value })}
            className={cx(inputClass, invalid && 'border-red/60')}
          />
          <span aria-hidden="true" className="shrink-0 text-[11px] text-text-muted/60">
            &rarr;
          </span>
          <input
            type="date"
            value={value.to}
            min={min}
            max={max}
            aria-label={toLabel}
            aria-invalid={invalid || undefined}
            onChange={(event) => onChange({ ...value, to: event.target.value })}
            className={cx(inputClass, invalid && 'border-red/60')}
          />
        </div>

        {dirty && (
          <button
            type="button"
            onClick={() => onChange({ from: '', to: '' })}
            className="shrink-0 cursor-pointer rounded px-1.5 py-1 text-[11px] text-text-muted transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
          >
            {clearLabel}
          </button>
        )}
      </div>

      {invalid && (
        // Tidak ditukar otomatis. Menukar diam-diam berarti mengubah rentang
        // yang diminta pengguna, dan di layar angka itu tidak boleh terjadi
        // tanpa dia tahu.
        <p role="alert" className="text-[11px] text-red">
          {invalidMessage}
        </p>
      )}
    </div>
  )
}
