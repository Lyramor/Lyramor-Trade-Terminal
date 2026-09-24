import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { cx } from '../layout/Container'

export interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
  /** Penjelasan singkat lewat tooltip bawaan browser. */
  title?: string
  /**
   * Redupkan dan matikan pilihan ini, TAPI tetap tampilkan. Kalau sebuah
   * pilihan memang sedang tidak berlaku, katakan begitu; jangan dibuang dari
   * baris, karena pengguna jadi tidak tahu pilihan itu pernah ada.
   */
  disabled?: boolean
}

interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedOption<T>[]
  value: T | ''
  onChange: (next: T) => void
  /** Keterangan kecil di kiri, misal "Range". Sekaligus jadi nama aksesibelnya. */
  label?: string
  /** Nama aksesibel kalau `label` tidak ditampilkan. */
  ariaLabel?: string
  size?: 'sm' | 'md'
  /** Teks saat `options` kosong. Kendalinya tetap tampil, cuma tidak bisa dipakai. */
  emptyLabel?: string
  className?: string
}

const SIZES = {
  sm: 'px-2 py-1 text-[11px]',
  md: 'px-2.5 py-1 text-[12px]',
} as const

/**
 * Deretan tombol saling menempel untuk memilih satu dari beberapa: rentang
 * waktu, tab papan, mode urut.
 *
 * ## Aturan yang dipaksakan berkas ini
 *
 * **Kendali ini tidak boleh hilang saat hasilnya kosong.** Ada komponen di
 * aplikasi ini yang menyembunyikan dirinya sendiri ketika datanya kosong.
 * Akibatnya pengguna memilih rentang yang memang tidak ada datanya, lalu
 * tombolnya ikut lenyap bersama data, dan satu-satunya jalan kembali adalah
 * memuat ulang halaman. Jadi jangan pernah menulis
 * `{rows.length > 0 && <SegmentedControl … />}`. Pilihan adalah navigasi,
 * bukan bagian dari hasil. Pesan "tidak ada data" adalah urusan badan isi,
 * bukan urusan kendalinya.
 *
 * Kalau `options` sendiri yang kosong, kendalinya tetap menggambar satu
 * segmen mati berisi `emptyLabel`, supaya tata letak tidak melompat dan
 * pengguna tahu tempat ini memang ada.
 *
 * `value` yang tidak ada di `options` juga bukan kesalahan fatal: tidak ada
 * segmen yang menyala, dan semuanya tetap bisa diklik. Ini penting untuk
 * DateRangeFilter, yang memakai keadaan "tidak ada preset yang cocok" sebagai
 * cara menunjukkan rentang khusus.
 *
 * ## Layar sempit
 *
 * Deret preset bisa berisi tujuh segmen; di 360px itu tidak muat. Barisnya
 * digeser mendatar, bukan dibungkus, karena segmen yang terbungkus dengan
 * garis pemisah di antaranya terbaca seperti kendali yang rusak. Segmen yang
 * aktif digeser ke dalam pandangan setiap kali pilihannya berubah.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  ariaLabel,
  size = 'md',
  emptyLabel = 'No options',
  className,
}: SegmentedControlProps<T>) {
  const groupRef = useRef<HTMLDivElement>(null)

  // Setelah panah memindahkan pilihan, fokus harus ikut pindah. Tanpa ini,
  // tombol yang sedang dipegang keyboard berubah jadi tabIndex -1 dan
  // fokusnya jatuh ke body. Dicek dulu apakah fokusnya memang di dalam
  // kendali ini, supaya klik mouse tidak ikut menarik fokus.
  useEffect(() => {
    const root = groupRef.current
    if (!root || !root.contains(document.activeElement)) return
    const active = root.querySelector<HTMLButtonElement>('[data-segment-active="true"]')
    if (active && active !== document.activeElement) active.focus()
  }, [value])

  // Geser segmen aktif ke dalam pandangan. `nearest` dua-duanya supaya
  // halaman di belakangnya tidak ikut melompat.
  useEffect(() => {
    const root = groupRef.current
    const active = root?.querySelector<HTMLButtonElement>('[data-segment-active="true"]')
    active?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [value])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const enabled = options.filter((option) => !option.disabled)
    if (enabled.length === 0) return
    const current = enabled.findIndex((option) => option.value === value)
    let target = -1
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      target = (current + 1 + enabled.length) % enabled.length
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      target = (current - 1 + enabled.length) % enabled.length
    } else if (event.key === 'Home') {
      target = 0
    } else if (event.key === 'End') {
      target = enabled.length - 1
    } else {
      return
    }
    event.preventDefault()
    onChange(enabled[target].value)
  }

  const name = ariaLabel ?? label

  return (
    <div className={cx('flex min-w-0 items-center gap-2', className)}>
      {label && <span className="text-micro uppercase text-text-muted/70 shrink-0">{label}</span>}
      <div className="min-w-0 overflow-hidden rounded border border-border">
        <div
          ref={groupRef}
          role="radiogroup"
          aria-label={name}
          onKeyDown={onKeyDown}
          className="scrollbar-hide flex overflow-x-auto"
        >
          {options.length === 0 ? (
            <span className={cx(SIZES[size], 'shrink-0 text-text-muted/60 whitespace-nowrap')}>
              {emptyLabel}
            </span>
          ) : (
            options.map((option, index) => {
              const active = option.value === value
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  data-segment-active={active}
                  disabled={option.disabled}
                  title={option.title}
                  // Roving tabindex: satu perhentian Tab untuk seluruh
                  // kelompok, lalu panah untuk berpindah di dalamnya.
                  tabIndex={active ? 0 : -1}
                  onClick={() => onChange(option.value)}
                  className={cx(
                    SIZES[size],
                    'shrink-0 whitespace-nowrap transition-colors cursor-pointer',
                    // Sasaran sentuh di telepon jauh lebih kecil dari lebar
                    // jari, jadi tingginya ditambah khusus penunjuk kasar.
                    '[@media(pointer:coarse)]:py-2',
                    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent/60',
                    'disabled:cursor-default disabled:opacity-40',
                    index > 0 && 'border-l border-border',
                    active ? 'bg-bg-tertiary text-text' : 'text-text-muted hover:text-text',
                  )}
                >
                  {option.label}
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
