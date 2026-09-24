import type { ReactNode } from 'react'

interface SidebarProps {
  /** Header title — shown at the top of the sidebar (e.g. "CHAT", "SETTINGS"). */
  title: string
  /** Optional action buttons rendered right-aligned in the header (e.g. "+ new"). */
  actions?: ReactNode
  /** Scrollable body content — usually the activity-specific navigator (channel list, file tree, etc.). */
  children: ReactNode
  /** Optional left-aligned leading slot in the header (e.g. mobile back arrow). */
  leading?: ReactNode
}

/**
 * VS Code-style Side Bar — sits between the Activity Bar and the Editor area.
 * Hosts the activity-specific navigator (channel list, file tree, search results,
 * deploy panel, etc.). Desktop layout renders it as a static column; on mobile
 * the parent wraps it in a slide-in drawer (see App.tsx).
 *
 * Width and resize are managed by the surrounding Group (react-resizable-panels)
 * at the App layout level. This component is a pure content wrapper.
 *
 * `aria-label` diambil dari judulnya supaya tiga landmark `aside` di satu
 * halaman (rail, sidebar, panel) bisa dibedakan pembaca layar. Tanpa nama,
 * ketiganya terbaca cuma sebagai "complementary".
 */
export function Sidebar({ title, actions, children, leading }: SidebarProps) {
  return (
    <aside aria-label={title} className="flex h-full w-full min-w-0 flex-col bg-bg-secondary">
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 px-4 border-b border-border/60">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {leading}
          {/* Di sini `truncate` memang yang benar: lebar sidebar disetel
              pengguna lewat panel yang bisa ditarik, jadi judul panjang harus
              mengalah pada lebar yang dia pilih sendiri, bukan mendorong
              tombol aksinya keluar. */}
          <h2 className="text-[13px] font-semibold leading-snug text-text truncate">{title}</h2>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-0.5">{actions}</div>}
      </div>
      <div className="flex-1 min-h-0 flex flex-col">{children}</div>
    </aside>
  )
}
