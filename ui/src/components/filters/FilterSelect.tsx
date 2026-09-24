import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { cx } from '../layout/Container'

export interface FilterOption {
  value: string
  label: string
  disabled?: boolean
}

interface FilterSelectProps {
  /**
   * Seluruh pilihan yang mungkin. Baca baik-baik catatan "sumber terpisah"
   * di bawah sebelum mengisi ini.
   */
  options: readonly FilterOption[]
  value: string
  onChange: (next: string) => void
  /** Keterangan kecil di kiri. Sekaligus menjadikan kendalinya `<label>` betulan. */
  label?: string
  /** Nama aksesibel kalau `label` tidak ditampilkan. */
  ariaLabel?: string
  /**
   * Teks untuk pilihan "tanpa saring". Isi `null` kalau filternya wajib
   * dan tidak boleh kosong.
   */
  allLabel?: string | null
  /** Nilai yang mewakili "tanpa saring". Bawaannya string kosong. */
  allValue?: string
  /** Teks saat `options` kosong. Kendalinya tetap tampil. */
  emptyLabel?: string
  size?: 'sm' | 'md'
  disabled?: boolean
  className?: string
}

const SIZES = {
  sm: 'px-2 py-1 text-[11px]',
  md: 'px-2 py-1.5 text-[12px]',
} as const

/**
 * Pemilih satu nilai dari daftar panjang.
 *
 * ## Aturan yang dipaksakan berkas ini
 *
 * **Daftar pilihan harus datang dari sumber yang TERPISAH dari data yang
 * sudah tersaring.** Ada tiga tempat di aplikasi ini yang membangun isi
 * dropdown-nya dari hasil yang sudah difilter. Begitu pengguna memilih
 * sumber A, daftar pilihannya menyusut jadi cuma berisi A, dan sumber B
 * tidak akan pernah bisa dipilih lagi tanpa memuat ulang halaman. Pilihannya
 * melingkar: yang menentukan isi daftar adalah nilai yang sudah dipilih.
 *
 * Urutan sumber yang benar, dari yang paling baik:
 *
 * 1. Endpoint atau konstanta yang memang mendaftar semua nilai yang mungkin.
 * 2. Respons yang belum disaring, diambil sekali saat halaman dibuka.
 * 3. `useOptionUniverse` di bawah, yang mengumpulkan setiap nilai yang
 *    pernah lewat dan tidak pernah membuangnya lagi.
 *
 * Sebagai jaring pengaman terakhir, kalau `value` yang sedang dipakai tidak
 * ada di `options`, komponen ini MENYISIPKANNYA sebagai pilihan tambahan.
 * Tanpa itu, `<select>` diam-diam pindah ke pilihan pertama, dan filter yang
 * ditampilkan berbeda dari filter yang sebenarnya sedang berlaku. Di layar
 * yang dipakai mengambil keputusan uang, itu jenis kebohongan yang paling
 * mahal.
 */
export function FilterSelect({
  options,
  value,
  onChange,
  label,
  ariaLabel,
  allLabel = 'All',
  allValue = '',
  emptyLabel = 'No options yet',
  size = 'md',
  disabled = false,
  className,
}: FilterSelectProps) {
  const id = useId()

  const resolved = useMemo<FilterOption[]>(() => {
    const list = [...options]
    const known = value === allValue || list.some((option) => option.value === value)
    if (!known && value !== '') {
      // Nilai asing, biasanya dari URL yang ditulis tangan atau dari daftar
      // yang belum selesai dimuat. Ditampilkan apa adanya supaya kendalinya
      // jujur soal apa yang sedang disaring.
      list.unshift({ value, label: value })
    }
    return list
  }, [options, value, allValue])

  const control = (
    <select
      id={id}
      value={value}
      disabled={disabled}
      aria-label={label ? undefined : ariaLabel}
      onChange={(event) => onChange(event.target.value)}
      className={cx(
        SIZES[size],
        'min-w-0 max-w-[220px] rounded-md border border-border bg-bg-tertiary text-text',
        'cursor-pointer outline-none transition-colors focus:border-accent',
        '[@media(pointer:coarse)]:py-2',
        'disabled:cursor-default disabled:opacity-50',
      )}
    >
      {allLabel !== null && <option value={allValue}>{allLabel}</option>}
      {resolved.length === 0 && allLabel === null && (
        <option value="" disabled>
          {emptyLabel}
        </option>
      )}
      {resolved.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  )

  if (!label) return <div className={cx('flex min-w-0 items-center', className)}>{control}</div>

  return (
    <label htmlFor={id} className={cx('flex min-w-0 items-center gap-2', className)}>
      <span className="text-micro uppercase text-text-muted/70 shrink-0">{label}</span>
      {control}
    </label>
  )
}

/**
 * Kumpulkan setiap nilai yang pernah terlihat, dan jangan pernah buang lagi.
 *
 * Ini jaring pengaman untuk halaman yang memang cuma punya data tersaring
 * sebagai sumber pilihan. Hasilnya monoton menaik: daftar boleh bertambah,
 * tidak boleh menyusut, jadi memilih satu sumber tidak akan menghapus sumber
 * yang lain dari dropdown.
 *
 * Tetap bukan pengganti daftar yang benar. Kalau sebuah nilai belum pernah
 * lewat sama sekali sejak halaman dibuka, dia tetap tidak akan muncul.
 *
 * ```ts
 * const sources = useOptionUniverse(articles.map((a) => a.source))
 * <FilterSelect options={sources.map((s) => ({ value: s, label: s }))} … />
 * ```
 */
export function useOptionUniverse(values: readonly string[] | null | undefined): string[] {
  const seen = useRef<Set<string>>(new Set())
  const [snapshot, setSnapshot] = useState<string[]>([])

  useEffect(() => {
    if (!values) return
    let grew = false
    for (const value of values) {
      if (!value || seen.current.has(value)) continue
      seen.current.add(value)
      grew = true
    }
    // setState cuma saat benar-benar ada yang baru, jadi memanggil hook ini
    // dengan array inline tidak bikin render berulang tanpa henti.
    if (grew) setSnapshot([...seen.current].sort())
  }, [values])

  return snapshot
}
