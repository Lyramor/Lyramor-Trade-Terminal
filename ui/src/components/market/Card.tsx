import { type ReactNode } from 'react'

interface Props {
  title: string
  /**
   * Free-form hover explanation surfaced next to the title as a small
   * circled "i". Panels pass context like the data source, provider-
   * specific caveats ("ratios not reported here"), period conventions,
   * or anything else worth whispering without spending chrome. Rendered
   * via the native `title` attribute — newlines are honoured.
   */
  info?: string | null
  right?: ReactNode
  className?: string
  contentClassName?: string
  children: ReactNode
}

/**
 * Panel shell used across the Market workbench.
 * Title + optional info hint + optional right slot + content. No
 * cross-panel smarts — each panel owns its own fetch and render.
 *
 * Kepalanya sekarang membungkus. Slot `right` sering diisi deretan tab
 * (FinancialStatementsPanel menaruh empat di sana), dan di layar sempit
 * empat tab plus judul tidak muat sebaris. Dulu judulnya yang mengalah jadi
 * elipsis; sekarang tab-nya yang turun ke baris bawah dan judulnya utuh.
 */
export function Card({ title, info, right, className, contentClassName, children }: Props) {
  return (
    <section className={`flex flex-col min-w-0 border border-border rounded bg-bg-secondary/30 ${className ?? ''}`}>
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-2 border-b border-border/60">
        <div className="flex items-center gap-1.5 min-w-0 flex-1 basis-[10rem]">
          <h3 className="text-subhead text-text min-w-0 [overflow-wrap:anywhere]">{title}</h3>
          {info && (
            // Custom CSS-only tooltip via Tailwind's group/group-hover.
            // Native `title=` was the first instinct but the browser-level
            // hover delay (~700ms) feels unresponsive — this one pops
            // instantly and lets us style / wrap freely.
            <span className="relative group inline-flex items-center">
              <span
                className="inline-flex items-center justify-center w-[14px] h-[14px] rounded-full bg-text-muted/30 text-bg text-[10px] font-bold leading-none cursor-help select-none shrink-0"
                aria-label={info}
              >
                i
              </span>
              <span
                role="tooltip"
                className="absolute left-0 top-full mt-1.5 z-50 hidden group-hover:block w-max max-w-sm whitespace-pre-line px-2.5 py-1.5 bg-bg-tertiary border border-border rounded shadow-lg text-[11px] text-text leading-relaxed pointer-events-none"
              >
                {info}
              </span>
            </span>
          )}
        </div>
        {right && (
          <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{right}</div>
        )}
      </header>
      <div className={`min-w-0 ${contentClassName ?? 'p-3'}`}>{children}</div>
    </section>
  )
}
