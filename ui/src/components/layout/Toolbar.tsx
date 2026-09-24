import type { ReactNode } from 'react'
import { cx } from './Container'

interface ToolbarProps {
  children: ReactNode
  /** Rapatkan jarak antar kelompok. Untuk bar kendali di dalam kartu. */
  dense?: boolean
  /** Nama aksesibel, misal "News filters". */
  ariaLabel?: string
  className?: string
}

/**
 * Baris kendali yang membungkus.
 *
 * Pola lama di repo ini `flex items-center gap-3 shrink-0` tanpa `flex-wrap`.
 * Di 360px, satu select tambahan sudah cukup untuk mendorong sisanya keluar
 * layar dan tidak ada yang bisa menggesernya kembali. Di sini `flex-wrap`
 * jadi bawaan, dengan jarak tegak yang lebih rapat dari jarak mendatar
 * supaya baris yang terbungkus tidak terlihat seperti dua bar terpisah.
 */
export function Toolbar({ children, dense = false, ariaLabel, className }: ToolbarProps) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cx(
        'flex min-w-0 flex-wrap items-center',
        dense ? 'gap-x-2.5 gap-y-1.5' : 'gap-x-4 gap-y-2',
        className,
      )}
    >
      {children}
    </div>
  )
}

interface ToolbarGroupProps {
  /**
   * Keterangan kecil di kiri kendali, misal "Interval" atau "Range".
   * Mengikuti bentuk yang sudah dipakai KlinePanel.
   */
  label?: ReactNode
  /**
   * Isi kalau kendalinya satu elemen form (`<select>`, `<input>`) dan punya
   * id. Kelompoknya jadi `<label>` betulan, jadi mengklik keterangannya
   * memfokuskan kendali. Jangan diisi untuk SegmentedControl: itu radiogroup
   * dan membungkusnya dalam `<label>` justru merusak semantiknya.
   */
  htmlFor?: string
  /** Dorong kelompok ini ke kanan selama masih sebaris. */
  end?: boolean
  /** Biarkan kelompok ini menyerap sisa ruang, misal kotak pencarian. */
  grow?: boolean
  className?: string
  children: ReactNode
}

/** Satu keterangan + satu kendali, sebagai unit yang tidak pernah terbelah saat membungkus. */
export function ToolbarGroup({
  label,
  htmlFor,
  end = false,
  grow = false,
  className,
  children,
}: ToolbarGroupProps) {
  const inner = (
    <>
      {label != null && (
        <span className="text-micro uppercase text-text-muted/70 shrink-0">{label}</span>
      )}
      {children}
    </>
  )
  const classes = cx(
    'flex min-w-0 items-center gap-2',
    grow && 'grow',
    // `ml-auto` cuma menempel selama kelompoknya masih sebaris. Begitu
    // terbungkus, dia jadi baris sendiri dan rata kiri seperti yang lain.
    end && 'ml-auto',
    className,
  )

  if (htmlFor) {
    return (
      <label htmlFor={htmlFor} className={classes}>
        {inner}
      </label>
    )
  }
  return <div className={classes}>{inner}</div>
}
