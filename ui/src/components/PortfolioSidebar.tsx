import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useTradingConfig } from '../hooks/useTradingConfig'
import { useWorkspace } from '../tabs/store'
import { getFocusedTab } from '../tabs/types'
import { SidebarRow } from './SidebarRow'
import { SidebarSectionHeader } from './SidebarSectionHeader'

/**
 * Portfolio sidebar — Overview + per-UTA accounts.
 *
 * - "All Accounts" opens the aggregate portfolio tab (`kind: 'portfolio'`).
 * - Each UTA row opens that account's detail tab (`kind: 'uta-detail'`).
 *
 * Active highlight is derived from the focused tab's spec, not from the
 * sidebar selection itself — focus and sidebar are independent.
 *
 * Kotak carinya menyamakan bilah ini dengan MarketSidebar, yang sudah punya
 * pencarian sejak awal. Daftar akun tumbuh terus dan menggulir mencari satu
 * nama di antara puluhan adalah pekerjaan yang tidak perlu ada.
 */
export function PortfolioSidebar() {
  const { t } = useTranslation()
  const { utas, loading } = useTradingConfig()
  const [query, setQuery] = useState('')
  const focused = useWorkspace((state) => getFocusedTab(state)?.spec)
  const openOrFocus = useWorkspace((state) => state.openOrFocus)

  const overviewActive = focused?.kind === 'portfolio'
  const focusedUtaId =
    focused?.kind === 'uta-detail' ? focused.params.id : null

  const visibleUtas = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return utas
    return utas.filter((uta) =>
      (uta.label ?? '').toLowerCase().includes(needle) || uta.id.toLowerCase().includes(needle),
    )
  }, [utas, query])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Teksnya belum lewat i18n: menambah kunci berarti menyunting katalog
          bahasa, dan katalog itu di luar jangkauan perubahan ini. */}
      <div className="px-3 pt-2 shrink-0">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search accounts…"
          aria-label="Search accounts"
          className="w-full px-2.5 py-1.5 bg-bg text-text border border-border/70 rounded-md text-[13px] outline-none focus:border-accent"
        />
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 py-1">
        <SidebarSectionHeader>{t('portfolio.overview')}</SidebarSectionHeader>
        <SidebarRow
          label={t('portfolio.allAccounts')}
          active={overviewActive}
          onClick={() => openOrFocus({ kind: 'portfolio', params: {} })}
        />

        <SidebarSectionHeader>
          {t('portfolio.accounts')}
          {!loading && utas.length > 0
            ? visibleUtas.length === utas.length
              ? ` (${utas.length})`
              : ` (${visibleUtas.length}/${utas.length})`
            : ''}
        </SidebarSectionHeader>

        {loading ? (
          <p className="px-3 py-2 text-[12px] text-text-muted/70">{t('common.loading')}</p>
        ) : utas.length === 0 ? (
          <p className="px-3 py-2 text-[12px] text-text-muted/70 leading-relaxed">
            {t('portfolio.noAccountsYet')}
          </p>
        ) : visibleUtas.length === 0 ? (
          <p className="px-3 py-2 text-[12px] text-text-muted/70 leading-relaxed">
            No account matches “{query.trim()}”.
          </p>
        ) : (
          visibleUtas.map((uta) => {
            const active = focusedUtaId === uta.id
            const display = uta.label?.trim() || uta.id
            return (
              <SidebarRow
                key={uta.id}
                label={display}
                active={active}
                dim={!uta.enabled}
                onClick={() =>
                  openOrFocus({ kind: 'uta-detail', params: { id: uta.id } })
                }
                trail={
                  !uta.enabled ? (
                    <span className="text-[10px] uppercase tracking-wide text-text-muted/60">{t('common.off')}</span>
                  ) : undefined
                }
              />
            )
          })
        )}
      </div>
    </div>
  )
}
