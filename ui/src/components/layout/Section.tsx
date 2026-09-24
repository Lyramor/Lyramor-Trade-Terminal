import type { ReactNode } from 'react'
import { cx } from './Container'

/**
 * Irama vertikal antar blok isi. Angkanya sengaja rapat karena ini aplikasi
 * kerja di dalam cangkang jendela, bukan halaman pemasaran yang boleh lega.
 * Batas bawahnya mengikuti yang sudah dipakai halaman sekarang (py-5 / py-6)
 * supaya tidak ada yang mendadak melompat.
 */
export type SectionPad = 'none' | 'sm' | 'default' | 'lg'

const PADS: Record<SectionPad, string> = {
  none: '',
  sm: 'py-[clamp(12px,2vw,18px)]',
  default: 'py-[clamp(18px,2.8vw,28px)]',
  lg: 'py-[clamp(28px,4.5vw,48px)]',
}

interface SectionProps {
  /** Judul blok. Boleh node kalau perlu lencana kecil di sebelahnya. */
  title?: ReactNode
  /** Satu baris penjelas di bawah judul. */
  description?: ReactNode
  /**
   * Slot aksi di kanan judul: tombol, SegmentedControl, penghitung baris.
   * Di layar sempit slot ini turun ke barisnya sendiri, tidak memampatkan
   * judul sampai terpotong.
   */
  actions?: ReactNode
  pad?: SectionPad
  /** Level heading supaya urutan h2 → h3 → h4 di satu halaman tetap masuk akal. */
  headingLevel?: 2 | 3 | 4
  /** Nama aksesibel kalau blok ini tidak menampilkan judul. */
  ariaLabel?: string
  className?: string
  /** Kelas untuk badan isi di bawah kepala judul. */
  bodyClassName?: string
  children: ReactNode
}

/**
 * Satu blok isi: judul + penjelas + slot aksi + badan.
 *
 * Kepalanya memakai `flex-wrap` dengan `basis` di sisi judul. Efeknya: selama
 * masih muat, judul dan aksi duduk sebaris; begitu aksi tidak kebagian ruang,
 * aksi turun utuh ke baris bawah alih-alih memaksa judul jadi elipsis. Ini
 * perbaikan yang sama seperti di PageHeader, cuma satu tingkat lebih dalam.
 *
 * ```tsx
 * <Section title="Open orders" actions={<SegmentedControl … />}>
 *   <TableScroll label="Open orders">…</TableScroll>
 * </Section>
 * ```
 */
export function Section({
  title,
  description,
  actions,
  pad = 'default',
  headingLevel = 3,
  ariaLabel,
  className,
  bodyClassName,
  children,
}: SectionProps) {
  const Heading = (`h${headingLevel}`) as 'h2' | 'h3' | 'h4'
  const hasHead = title != null || description != null || actions != null

  return (
    <section className={cx(PADS[pad], className)} aria-label={ariaLabel}>
      {hasHead && (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          {(title != null || description != null) && (
            // `basis-[14rem]` yang bikin pembungkusan terasa benar: di bawah
            // itu, sisi aksi tidak lagi muat dan langsung pindah baris.
            <div className="min-w-0 flex-1 basis-[14rem]">
              {title != null && (
                <Heading className="text-subhead text-text [overflow-wrap:anywhere]">
                  {title}
                </Heading>
              )}
              {description != null && (
                <p className="text-caption text-text-muted mt-0.5 [overflow-wrap:anywhere]">
                  {description}
                </p>
              )}
            </div>
          )}
          {actions != null && (
            <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">
              {actions}
            </div>
          )}
        </div>
      )}
      <div className={cx('min-w-0', bodyClassName)}>{children}</div>
    </section>
  )
}
