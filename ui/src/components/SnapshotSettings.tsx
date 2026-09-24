import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { useAutoSave } from '../hooks/useAutoSave'
import { Toolbar, ToolbarGroup } from './layout/Toolbar'
import { SegmentedControl, type SegmentedOption } from './filters/SegmentedControl'
import { SaveIndicator } from './SaveIndicator'
import { Toggle } from './Toggle'

/**
 * Setelan perekaman snapshot: hidup/mati dan seberapa sering.
 *
 * ## Kenapa berkas ini ada
 *
 * Baris ini dulu duduk di tengah halaman Portfolio, persis di bawah grafik
 * equity dan persis di atas panel detail snapshot. Bentuknya deret tombol
 * "1m 5m 15m 30m 1h", sama persis dengan deret rentang grafik di atasnya.
 * Pemiliknya bertahun-tahun mengira baris ini MENYARING grafik, padahal dia
 * MENULIS KONFIGURASI SERVER: menekan "1h" di situ mengubah seberapa sering
 * seluruh sistem merekam keadaan akun, bukan mengubah apa yang dilihat.
 *
 * Dua kendali yang terlihat sama tapi satunya mengubah tampilan dan satunya
 * mengubah perilaku server tidak boleh bertetangga. Jadi baris ini diangkat
 * keluar dari halaman Portfolio dan pindah ke Settings, tempat orang memang
 * datang untuk mengubah perilaku.
 *
 * ## Cara memakai
 *
 * Tanpa prop, komponen ini memuat dan menyimpan konfigurasinya sendiri:
 *
 * ```tsx
 * <SnapshotSettings />
 * ```
 *
 * Kalau halaman pemanggil sudah memegang `AppConfig`, kirim nilainya lewat
 * `initial` supaya tidak ada fetch kedua:
 *
 * ```tsx
 * <SnapshotSettings initial={config.snapshot} />
 * ```
 *
 * `initial` cuma dipakai sebagai benih saat render pertama. Komponen ini
 * pemilik nilainya setelah itu, jadi tidak ada tarik-menarik antara state
 * halaman dan state di sini.
 */

const INTERVAL_PRESETS = ['1m', '5m', '15m', '30m', '1h'] as const

/** Nilai semu untuk segmen "Custom". Bukan interval yang sah, jadi tidak
 *  mungkin bentrok dengan nilai asli dari server. */
const CUSTOM = '__custom__'

const INTERVAL_OPTIONS: SegmentedOption<string>[] = [
  ...INTERVAL_PRESETS.map((value) => ({ value, label: value })),
  { value: CUSTOM, label: 'Custom', title: 'Type any interval, e.g. 2h' },
]

const DEFAULTS = { enabled: true, every: '15m' }

export interface SnapshotConfigValue {
  enabled: boolean
  every: string
}

export interface SnapshotSettingsProps {
  /** Nilai awal dari konfigurasi yang sudah dipegang pemanggil. Kalau kosong,
   *  komponen memuat sendiri lewat `api.config.load()`. */
  initial?: SnapshotConfigValue | null
  className?: string
}

export function SnapshotSettings({ initial = null, className }: SnapshotSettingsProps) {
  const [enabled, setEnabled] = useState(initial?.enabled ?? DEFAULTS.enabled)
  const [every, setEvery] = useState(initial?.every ?? DEFAULTS.every)

  // Autosave ditahan sampai nilai server benar-benar mendarat. Tanpa gerbang
  // ini, bawaan komponen sempat ditulis balik ke server dan menimpa setelan
  // asli pengguna beberapa ratus milidetik setelah halaman dibuka.
  const seeded = initial != null
  const [ready, setReady] = useState(seeded)

  useEffect(() => {
    if (seeded) return
    let alive = true
    api.config
      .load()
      .then((config) => {
        if (!alive || !config?.snapshot) return
        setEnabled(config.snapshot.enabled)
        setEvery(config.snapshot.every)
      })
      .catch(() => {
        // Gagal memuat bukan alasan mengunci kendalinya. Yang tampil jadi
        // nilai bawaan, dan perubahan pertama pengguna tetap tersimpan.
      })
      .finally(() => {
        if (alive) setReady(true)
      })
    return () => {
      alive = false
    }
  }, [seeded])

  const value = useMemo(() => ({ enabled, every }), [enabled, every])
  const save = useCallback(async (next: SnapshotConfigValue) => {
    await api.config.updateSection('snapshot', next)
  }, [])
  const { status, retry } = useAutoSave({ data: value, save, enabled: ready })

  const isPreset = (INTERVAL_PRESETS as readonly string[]).includes(every)

  // `customIntent` cuma merekam "pengguna menekan Custom". Mode custom sendiri
  // DITURUNKAN dari nilainya, bukan disimpan. Versi lama menyimpannya sebagai
  // state yang diisi sekali saat render pertama, jadi begitu nilai dari server
  // mendarat belakangan dan ternyata bukan preset, tidak ada preset yang
  // menyala sekaligus isian custom-nya tersembunyi: intervalnya tidak terbaca
  // di mana pun.
  const [customIntent, setCustomIntent] = useState(false)
  const showCustom = customIntent || !isPreset

  const pick = (next: string) => {
    if (next === CUSTOM) {
      setCustomIntent(true)
      return
    }
    setCustomIntent(false)
    setEvery(next)
  }

  return (
    <Toolbar dense ariaLabel="Snapshot capture settings" className={className}>
      <ToolbarGroup label="Snapshots">
        <Toggle
          checked={enabled}
          onChange={setEnabled}
          size="sm"
          ariaLabel="Record snapshots periodically"
        />
      </ToolbarGroup>

      <ToolbarGroup label="Every">
        <SegmentedControl
          options={INTERVAL_OPTIONS}
          value={showCustom ? CUSTOM : every}
          onChange={pick}
          ariaLabel="Snapshot interval"
          size="sm"
        />
      </ToolbarGroup>

      {showCustom && (
        <input
          value={every}
          onChange={(e) => setEvery(e.target.value)}
          placeholder="e.g. 2h"
          aria-label="Custom snapshot interval"
          className="w-20 shrink-0 rounded border border-border bg-bg px-1.5 py-1 text-center text-[12px] text-text outline-none transition-colors focus:border-accent [@media(pointer:coarse)]:py-1.5"
        />
      )}

      <ToolbarGroup end>
        <SaveIndicator status={status} onRetry={retry} />
      </ToolbarGroup>
    </Toolbar>
  )
}
