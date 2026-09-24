import { useWorkspace } from '../tabs/store'
import { type Tab } from '../tabs/types'
import { getView } from '../tabs/registry'
import { useIsDesktop } from '../live/use-is-desktop'
import { TabStrip } from './TabStrip'
import { EmptyEditor } from './EmptyEditor'

/**
 * The main editor area — replaces the old `<Routes>` block.
 *
 * Renders every open tab in the focused group concurrently, hiding all but
 * the active one via CSS `display: none`. Reasoning:
 *
 * - Tabs that hold long-lived state (ChatPage's SSE / message buffers,
 *   in-progress charts) survive switching without re-fetch or re-mount.
 * - Components don't need to be aware of "tab-hosted vs route-hosted" —
 *   they just render normally; the host controls visibility.
 *
 * The `visible` prop threaded into each tab's component lets surfaces that
 * care (ChatPage's catch-up scroll) react to becoming visible.
 *
 * Mobile (< md): single-tab mode. Only the active tab renders, no strip.
 *
 * ---
 *
 * ## Kenapa tab non-aktif tetap dibongkar di telepon
 *
 * Pilihan ini dipertahankan, bukan karena warisan, tapi karena alasannya
 * masih berlaku. Satu tab di aplikasi ini bukan halaman ringan: ada koneksi
 * SSE hidup, grafik lightweight-charts dengan buffer bar, terminal xterm
 * dengan WebGL, dan tabel yang ikut polling tiap 60 detik. Di telepon kelas
 * menengah, membiarkan lima tab seperti itu hidup berbarengan di latar
 * belakang bukan cuma boros memori, tapi ikut memakan baterai dan kuota untuk
 * layar yang sedang tidak dilihat siapa pun. Di desktop `display: none` murah,
 * jadi di sana tetap disembunyikan saja.
 *
 * ## Tapi keadaan filter tidak boleh ikut mati
 *
 * Membongkar komponen berarti membunuh seluruh `useState` di dalamnya, dan
 * dulu di situlah semua filter disimpan. Hasilnya keluhan yang berulang: di
 * telepon, setiap kali pengguna pindah tab dan kembali, rentang tanggal dan
 * pilihan sumber yang barusan disetel hilang semua.
 *
 * Jawabannya bukan mempertahankan komponennya, tapi memindahkan nilainya ke
 * tempat yang tidak ikut dibongkar. Pakai `useFilterParam` dan kerabatnya di
 * `src/hooks/useFilterParam.ts` untuk SETIAP keadaan filter yang pengguna
 * pilih sendiri. Nilainya tinggal di search params, yang hidup di luar pohon
 * komponen, jadi selamat melewati pembongkaran ini.
 *
 * Yang boleh tetap `useState` biasa: hal yang memang wajar hilang saat
 * pindah, misal baris yang sedang di-hover, atau dialog yang sedang terbuka.
 */
export function TabHost() {
  const tabIds = useWorkspace((state) =>
    state.tree.kind === 'leaf' ? state.tree.group.tabIds : [],
  )
  const activeTabId = useWorkspace((state) =>
    state.tree.kind === 'leaf' ? state.tree.group.activeTabId : null,
  )
  const tabsMap = useWorkspace((state) => state.tabs)
  const isDesktop = useIsDesktop()

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TabStrip />
      <div className="relative flex-1 min-h-0">
        {tabIds.length === 0 ? (
          <EmptyEditor />
        ) : (
          tabIds.map((id) => {
            const tab = tabsMap[id]
            if (!tab) return null
            const isActive = id === activeTabId
            // Telepon: cuma tab aktif yang dirender. Lihat catatan panjang di
            // atas soal kenapa ini dipertahankan, dan kenapa filter karena itu
            // wajib lewat useFilterParam.
            if (!isDesktop && !isActive) return null
            return <TabFrame key={id} tab={tab} visible={isActive} />
          })
        )}
      </div>
    </div>
  )
}

/** One mounted tab. Hidden frames are kept in the DOM but `display: none`. */
function TabFrame({ tab, visible }: { tab: Tab; visible: boolean }) {
  const view = getView(tab.spec.kind)
  // Cast: each ViewModule has a Component constrained to its spec kind. The
  // map lookup loses that narrowing; the runtime type matches by construction.
  const Component = view.Component as React.ComponentType<{ spec: typeof tab.spec; visible: boolean }>
  return (
    <div
      className="absolute inset-0 flex flex-col min-h-0"
      style={{ display: visible ? 'flex' : 'none' }}
      aria-hidden={!visible}
      // `inert` keeps focusable elements in hidden frames out of tab order.
      // React 19 supports it as a JSX attribute.
      inert={!visible}
    >
      <Component spec={tab.spec} visible={visible} />
    </div>
  )
}
