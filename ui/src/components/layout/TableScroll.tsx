import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cx } from './Container'

interface TableScrollProps {
  children: ReactNode
  /**
   * Bingkai 1px + sudut membulat, resep yang sudah dipakai tabel Portfolio
   * dan UTA. Matikan kalau tabelnya sudah duduk di dalam Card.
   */
  bordered?: boolean
  /**
   * Batasi tinggi dan hidupkan geser tegak. Isi `'320px'`, `'50vh'`, apa pun
   * nilai CSS yang sah. Kalau dipakai bersama `<thead className="sticky top-0">`,
   * kepala tabel ikut diam di tempat.
   */
  maxHeight?: string
  /**
   * Nama aksesibel untuk wilayah geser, misal "Open positions". Wajib diisi
   * kalau tabelnya bisa digeser: pembaca layar butuh tahu wilayah ini apa
   * sebelum pengguna keyboard masuk ke dalamnya.
   */
  label?: string
  /** Tanda panah kecil di tepi saat masih ada isi ke samping. Nyala by default. */
  hint?: boolean
  className?: string
  /** Kelas tambahan untuk kotak yang benar-benar menggeser. */
  innerClassName?: string
  style?: CSSProperties
}

/**
 * Pembungkus tabel yang bisa digeser mendatar.
 *
 * Kenapa ini ada: aplikasi trading isinya tabel lebar, dan 12 di antaranya
 * kepotong permanen di layar sempit karena tidak ada yang menggeser. Angka
 * yang tidak bisa dilihat sama saja dengan angka yang tidak ada, dan di sini
 * orang memakainya untuk memutuskan soal uang.
 *
 * Tiga hal yang dikerjakan di luar sekadar `overflow-x-auto`:
 *
 * 1. Wilayah gesernya bisa difokus keyboard, tapi HANYA saat benar-benar ada
 *    yang bisa digeser. Kalau selalu `tabIndex=0`, setiap tabel yang muat
 *    penuh jadi perhentian Tab yang tidak berguna.
 * 2. Tepi kiri/kanan memberi tanda panah kecil saat masih ada isi di arah itu.
 *    Tanpa tanda, di telepon tabel terlihat seperti memang cuma segitu.
 * 3. Pengukurannya mengamati anak pertama juga, karena baris tabel datang
 *    dari fetch: ukuran pembungkus tidak berubah, isinya yang tiba-tiba lebar.
 *
 * ```tsx
 * <TableScroll label="Positions" maxHeight="420px">
 *   <table className="w-full text-[12px] border-collapse">…</table>
 * </TableScroll>
 * ```
 */
export function TableScroll({
  children,
  bordered = true,
  maxHeight,
  label,
  hint = true,
  className,
  innerClassName,
  style,
}: TableScrollProps) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ start: false, end: false })

  const measure = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    // Toleransi 1px: tata letak sub-pixel bikin scrollLeft nyaris tidak
    // pernah mendarat persis di 0 atau di max, jadi perbandingan ketat
    // bikin panahnya kedip-kedip.
    const start = el.scrollLeft > 1
    const end = el.scrollLeft < max - 1
    setEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }))
  }, [])

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    // Anak pertama = tabelnya. Diamati terpisah karena barisnya bertambah
    // setelah data datang sementara kotak pembungkusnya diam saja.
    if (el.firstElementChild) observer.observe(el.firstElementChild)
    return () => observer.disconnect()
  }, [measure, children])

  const scrollable = edges.start || edges.end

  return (
    <div
      className={cx(
        'relative min-w-0',
        bordered && 'rounded-lg border border-border overflow-hidden',
        className,
      )}
      style={style}
    >
      <div
        ref={scrollerRef}
        onScroll={measure}
        role={label ? 'region' : undefined}
        aria-label={label}
        tabIndex={scrollable ? 0 : undefined}
        style={maxHeight ? { maxHeight } : undefined}
        className={cx(
          'overflow-x-auto',
          maxHeight && 'overflow-y-auto',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/50',
          innerClassName,
        )}
      >
        {children}
      </div>

      {hint && edges.start && <EdgeHint side="start" />}
      {hint && edges.end && <EdgeHint side="end" />}
    </div>
  )
}

/** Panah kecil di tepi. `pointer-events-none` supaya tidak menghalangi klik baris. */
function EdgeHint({ side }: { side: 'start' | 'end' }) {
  const Icon = side === 'start' ? ChevronLeft : ChevronRight
  return (
    <span
      aria-hidden="true"
      className={cx(
        'pointer-events-none absolute top-1/2 -translate-y-1/2 z-10',
        'flex h-5 w-5 items-center justify-center rounded-full',
        'border border-border bg-bg-tertiary text-text-muted shadow-sm',
        side === 'start' ? 'left-1' : 'right-1',
      )}
    >
      <Icon size={12} />
    </span>
  )
}
