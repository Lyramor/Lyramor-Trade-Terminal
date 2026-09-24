import { Fragment, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { TrendingUp, Hash, Shapes } from 'lucide-react'
import { entitiesLive } from '../live/entities'
import { useTrackedSelection } from '../live/tracked-selection'
import { SidebarRow } from './SidebarRow'
import { SidebarSectionHeader } from './SidebarSectionHeader'
import type { EntityListItem } from '../api/entities'

/**
 * Tipe yang memang dikenal UI ini, beserta urutan tampilnya. Apa pun di luar
 * daftar ini tidak dipaksa masuk ke salah satunya, lihat `groups` di bawah.
 */
const KNOWN_TYPES = [
  { type: 'asset', labelKey: 'tracked.assets', Icon: TrendingUp },
  { type: 'topic', labelKey: 'tracked.topics', Icon: Hash },
] as const

interface EntityGroup {
  key: string
  label: string
  Icon: typeof TrendingUp
  items: EntityListItem[]
}

/**
 * Tracked sidebar — the watchlist. Entities grouped by type (assets, topics,
 * and any type this UI does not know yet), newest-first inside each group,
 * each row showing a type glyph, the kebab name, and how many notes link to
 * it. Selection lives in `useTrackedSelection` so it survives remounts and is
 * read by TrackedPage in the editor area.
 */
export function TrackedSidebar() {
  const { t } = useTranslation()
  const entities = entitiesLive.useStore((s) => s.entities)
  const loading = entitiesLive.useStore((s) => s.loading)
  const selected = useTrackedSelection((s) => s.selectedName)
  const select = useTrackedSelection((s) => s.select)

  // Default-select the first entity once, on first non-empty load. Latch so
  // the user's later picks are never overridden.
  const everSelectedRef = useRef(false)
  useEffect(() => {
    if (everSelectedRef.current) return
    if (entities.length === 0) return
    if (!selected) select(entities[0]!.name)
    everSelectedRef.current = true
  }, [entities, selected, select])

  /**
   * Kelompokkan menurut `type` yang sebenarnya.
   *
   * Versi lama memakai `e.type !== 'asset'` sebagai definisi "Topics". Artinya
   * tipe baru apa pun yang muncul dari backend langsung masuk ke situ dengan
   * label yang salah, dan tidak ada yang sadar ada tipe baru. Sekarang tipe
   * yang tidak dikenal dapat kelompoknya sendiri dengan nama tipenya apa
   * adanya, jadi kelihatan alih-alih tersembunyi.
   *
   * Urutan di dalam kelompok tidak diubah: tetap mengikuti urutan store
   * (terbaru dulu).
   */
  const groups = useMemo<EntityGroup[]>(() => {
    const byType = new Map<string, EntityListItem[]>()
    for (const entity of entities) {
      const key = typeof entity.type === 'string' ? entity.type.trim() : ''
      const bucket = byType.get(key)
      if (bucket) bucket.push(entity)
      else byType.set(key, [entity])
    }

    const out: EntityGroup[] = []
    for (const known of KNOWN_TYPES) {
      const items = byType.get(known.type)
      byType.delete(known.type)
      if (items?.length) {
        out.push({ key: known.type, label: t(known.labelKey), Icon: known.Icon, items })
      }
    }
    // Sisanya: tipe yang belum dikenal UI ini. Namanya dipakai apa adanya,
    // bukan diterjemahkan, karena itu data dari backend, bukan teks UI.
    for (const [type, items] of [...byType].sort(([a], [b]) => a.localeCompare(b))) {
      out.push({
        key: type || '__unknown__',
        label: type || t('tracked.unknownType'),
        Icon: Shapes,
        items,
      })
    }
    return out
  }, [entities, t])

  if (loading && entities.length === 0) {
    return <div className="px-3 py-3 text-[12px] text-text-muted">{t('common.loading')}</div>
  }

  if (entities.length === 0) {
    return (
      <div className="px-3 py-4 text-[12px] text-text-muted/70 leading-relaxed">
        {t('tracked.nothingTrackedYet')}
        <div className="mt-1 text-text-muted/50">
          Agents register assets &amp; topics with the{' '}
          <code className="text-[11px]">entity_upsert</code> tool, then link to them with{' '}
          <code className="text-[11px]">[[name]]</code> in their notes.
        </div>
      </div>
    )
  }

  const renderRow = (e: EntityListItem, Icon: typeof TrendingUp) => {
    return (
      <SidebarRow
        key={e.name}
        active={e.name === selected}
        onClick={() => select(e.name)}
        title={e.description}
        icon={<Icon size={13} strokeWidth={1.75} className="text-text-muted/70" aria-hidden />}
        label={<span className="font-mono text-[12px]">{e.name}</span>}
        trail={
          e.backlinkCount > 0 ? (
            <span
              className="text-[10px] text-text-muted/60 tabular-nums"
              title={t('tracked.backlinksTooltip', { count: e.backlinkCount })}
            >
              {e.backlinkCount}
            </span>
          ) : undefined
        }
      />
    )
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto py-1">
      {groups.map((group) => (
        <Fragment key={group.key}>
          <SidebarSectionHeader>{group.label}</SidebarSectionHeader>
          {group.items.map((entity) => renderRow(entity, group.Icon))}
        </Fragment>
      ))}
    </div>
  )
}
