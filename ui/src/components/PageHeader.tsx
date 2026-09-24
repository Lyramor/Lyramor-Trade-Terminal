import type { ReactNode } from 'react'
import { LiveIndicator } from './LiveIndicator'

interface PageHeaderProps {
  title: string
  description?: ReactNode
  right?: ReactNode
  /** Show a pulsing "data is live" indicator next to the title and a
   *  relative-time microcopy ("updated 14s ago") in the description row.
   *  Pass the timestamp of the last successful refresh; pass `null` to
   *  show the pulse without a time (pre-first-load). */
  live?: { lastUpdated: Date | null }
}

/**
 * Kepala halaman, dipakai minimal 14 halaman.
 *
 * Dulu judul dan slot aksi dipaksa sebaris tanpa `flex-wrap`, dan judulnya
 * ber-`truncate`. Di 360px itu berarti judul dipotong jadi elipsis padahal
 * kalau aksinya turun satu baris, judulnya muat utuh. Satu perbaikan di sini
 * menyembuhkan semua halaman sekaligus.
 *
 * Caranya: barisnya `flex-wrap`, dan sisi judul diberi `basis-[15rem]`.
 * Selama aksi masih kebagian ruang, keduanya duduk sebaris persis seperti
 * sebelumnya. Begitu tidak muat, aksinya turun utuh ke baris bawah alih-alih
 * memampatkan judul. `truncate` diganti pembungkusan kata, jadi judul panjang
 * jatuh ke baris kedua, bukan disembunyikan.
 */
export function PageHeader({ title, description, right, live }: PageHeaderProps) {
  return (
    <div className="shrink-0 border-b border-border">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-[var(--page-gutter)] py-[clamp(14px,2.2vw,20px)]">
        <div className="min-w-0 flex-1 basis-[15rem]">
          <div className="flex items-center gap-2">
            <h2 className="text-title font-bold text-text min-w-0 [overflow-wrap:anywhere]">
              {title}
            </h2>
            {live && (
              <span
                className="relative inline-block w-1.5 h-1.5 rounded-full bg-green live-pulse shrink-0"
                aria-label="Live"
              />
            )}
          </div>
          {(description || live) && (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-text-muted">
              {description && <span className="min-w-0">{description}</span>}
              {live && (
                <>
                  {description && <span className="text-text-muted/40">·</span>}
                  <LiveIndicator lastUpdated={live.lastUpdated} hideDot />
                </>
              )}
            </div>
          )}
        </div>
        {right && (
          // Slot aksinya sendiri juga membungkus: beberapa halaman menaruh
          // tiga tombol di sini, dan tiga tombol belum tentu muat sebaris
          // walaupun sudah turun ke baris kedua.
          <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{right}</div>
        )}
      </div>
    </div>
  )
}
