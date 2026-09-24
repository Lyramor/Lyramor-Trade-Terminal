import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { api, type EventLogEntry, type ToolCallRecord } from '../api'
import { toolsApi } from '../api/tools'
import { getIntlLocale } from '../lib/intl'
import { Container } from '../components/layout/Container'
import { TableScroll } from '../components/layout/TableScroll'
import { Toolbar, ToolbarGroup } from '../components/layout/Toolbar'
import { FilterSelect, useOptionUniverse, type FilterOption } from '../components/filters/FilterSelect'
import {
  useFilterEnum,
  useFilterFlag,
  useFilterNumber,
  useFilterParam,
  useFilterParamWriter,
} from '../hooks/useFilterParam'

// ==================== Helpers ====================

function formatDateTime(ts: number): string {
  const d = new Date(ts)
  const date = d.toLocaleDateString(getIntlLocale(), { month: 'short', day: 'numeric' })
  const time = d.toLocaleTimeString(getIntlLocale(), { hour12: false })
  return `${date} ${time}`
}

function eventTypeColor(type: string): string {
  if (type.startsWith('heartbeat.')) return 'text-purple'
  if (type.startsWith('cron.')) return 'text-accent'
  if (type.startsWith('message.')) return 'text-green'
  return 'text-text-muted'
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60_000).toFixed(1)}m`
}

function statusColor(status: string): string {
  return status === 'error' ? 'text-red' : 'text-green'
}

/** Try to pretty-print JSON output, fall back to raw string. */
function formatOutput(output: string): string {
  try {
    return JSON.stringify(JSON.parse(output), null, 2)
  } catch {
    return output
  }
}

/** Nama mentah jadi daftar option. Urutannya sudah diurus universe-nya. */
function toOptions(values: readonly string[]): FilterOption[] {
  return values.map((value) => ({ value, label: value }))
}

/**
 * Gulung wilayah geser tabel kembali ke atas setelah pindah halaman.
 *
 * TableScroll tidak meneruskan ref ke kotak yang benar-benar menggeser, jadi
 * elemennya dicari lewat `role="region"` yang dipasang komponen itu waktu
 * `label` diisi. Kalau suatu saat TableScroll punya ref sendiri, ganti ini.
 */
function scrollTableToTop(root: HTMLElement | null) {
  root?.querySelector<HTMLElement>('[role="region"]')?.scrollTo(0, 0)
}

/**
 * Pause di sini artinya "hentikan penyegaran otomatis", bukan "bekukan layar".
 *
 * Dulu perilakunya setengah-setengah: polling berhenti, tapi mengganti filter
 * tetap menarik data baru, sementara tombolnya cuma bertuliskan "Pause". Dua
 * jalan keluar yang masuk akal: mematikan semua kendali selama dijeda, atau
 * mempersempit arti Pause ke polling saja. Dipilih yang kedua, karena orang
 * menekan Pause justru supaya bisa membaca dan menyaring tanpa daftarnya
 * bergeser sendiri di bawah kursor. Kalau filter ikut mati, Pause malah bikin
 * halaman tidak bisa dipakai.
 *
 * Yang berubah: labelnya sekarang menyebut auto-refresh, jadi janjinya sama
 * dengan yang dikerjakan, dan tooltipnya bilang terang-terangan kalau aksi
 * eksplisit tetap menarik data.
 */
function AutoRefreshToggle({ paused, onChange }: { paused: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      aria-pressed={paused}
      title="Refreshes every 3s while running. Changing the filter or the page always fetches on demand, paused or not."
      onClick={() => onChange(!paused)}
      className={`shrink-0 cursor-pointer text-xs px-3 py-1.5 rounded-md border transition-colors ${
        paused
          ? 'border-notification-border text-notification-border hover:bg-notification-bg'
          : 'border-border text-text-muted hover:bg-bg-tertiary'
      }`}
    >
      {paused ? 'Resume auto-refresh' : 'Pause auto-refresh'}
    </button>
  )
}

interface PaginationProps {
  page: number
  totalPages: number
  loading: boolean
  onGo: (page: number) => void
}

function Pagination({ page, totalPages, loading, onGo }: PaginationProps) {
  if (totalPages <= 1) return null
  const cls =
    'text-xs px-2 py-1 rounded border border-border text-text-muted hover:text-text hover:bg-bg-tertiary transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed'
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 shrink-0">
      <button onClick={() => onGo(1)} disabled={page <= 1 || loading} aria-label="First page" className={cls}>
        &laquo;&laquo;
      </button>
      <button onClick={() => onGo(page - 1)} disabled={page <= 1 || loading} aria-label="Previous page" className={cls}>
        &laquo;
      </button>
      <span className="text-xs text-text-muted px-2">
        {page} / {totalPages}
      </span>
      <button onClick={() => onGo(page + 1)} disabled={page >= totalPages || loading} aria-label="Next page" className={cls}>
        &raquo;
      </button>
      <button onClick={() => onGo(totalPages)} disabled={page >= totalPages || loading} aria-label="Last page" className={cls}>
        &raquo;&raquo;
      </button>
    </div>
  )
}

// ==================== EventLog Section ====================

const EVENT_PAGE_SIZE = 100

/**
 * Sekali di awal, tarik jendela yang jauh lebih lebar dari satu halaman,
 * khusus untuk mengisi daftar tipe. Sisi server membaca seluruh berkas log
 * lalu memotongnya, jadi pageSize besar cuma menambah ongkos transfer, bukan
 * ongkos baca. 500 cukup jauh ke belakang supaya tipe yang jarang muncul
 * tetap kebagian tempat di dropdown.
 */
const TYPE_SAMPLE_SIZE = 500

const EVENTS_SCOPE = 'dev.logs.events'

function EventLogSection() {
  const [entries, setEntries] = useState<EventLogEntry[]>([])
  const [typeSample, setTypeSample] = useState<string[]>([])
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)

  // Filter tinggal di URL, bukan useState. Di bawah 768px TabHost membongkar
  // tab yang tidak aktif, jadi state lokal ikut hilang tiap kali pengguna
  // melirik tab sebelah lalu balik lagi.
  const [typeFilter] = useFilterParam('type', '', { scope: EVENTS_SCOPE })
  const [page] = useFilterNumber('page', 1, { scope: EVENTS_SCOPE })
  const [paused, setPaused] = useFilterFlag('paused', false, { scope: EVENTS_SCOPE })
  const write = useFilterParamWriter({ scope: EVENTS_SCOPE })

  const fetchPage = useCallback(async (p: number, type?: string) => {
    setLoading(true)
    try {
      const result = await api.events.query({
        page: p,
        pageSize: EVENT_PAGE_SIZE,
        type: type || undefined,
      })
      setEntries(result.entries)
      setTotalPages(result.totalPages)
      setTotal(result.total)
    } catch (err) {
      console.warn('Failed to load events:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  // Halaman dan filter sekarang datang dari URL, jadi satu efek ini yang
  // memuat ulang. Tidak ada lagi fetch yang diselipkan di dalam handler.
  useEffect(() => { fetchPage(page, typeFilter || undefined) }, [fetchPage, page, typeFilter])

  // Contoh tanpa filter untuk isi dropdown. Ini yang memutus lingkarannya:
  // daftar tipe tidak boleh dibangun dari entri yang sedang tersaring.
  useEffect(() => {
    let cancelled = false
    api.events
      .query({ page: 1, pageSize: TYPE_SAMPLE_SIZE })
      .then((result) => {
        if (!cancelled) setTypeSample(result.entries.map((e) => e.type))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Tipe yang baru muncul setelah halaman dibuka ikut tertangkap dari entri
  // yang lewat. useOptionUniverse tidak pernah membuang yang sudah tercatat,
  // jadi memilih satu tipe tidak lagi menghapus tipe lain dari daftar.
  const seenTypes = useMemo(
    () => [...typeSample, ...entries.map((e) => e.type)],
    [typeSample, entries],
  )
  const typeUniverse = useOptionUniverse(seenTypes)
  const typeOptions = useMemo(() => toOptions(typeUniverse), [typeUniverse])

  const handleTypeChange = useCallback((type: string) => {
    // Dua kunci dalam satu tulisan. Setter terpisah akan saling menimpa
    // karena keduanya membaca lokasi yang sama dalam satu tick.
    write({ type: type || null, page: null })
  }, [write])

  const goToPage = useCallback((p: number) => {
    write({ page: p === 1 ? null : String(p) })
    scrollTableToTop(containerRef.current)
  }, [write])

  // Penyegaran otomatis tiap 3 detik, khusus halaman pertama. Halaman lama
  // tidak ikut: kalau seseorang sedang menyusuri riwayat, daftarnya tidak
  // boleh melompat balik ke depan.
  useEffect(() => {
    if (paused || page !== 1) return
    const interval = setInterval(() => { fetchPage(1, typeFilter || undefined) }, 3000)
    return () => clearInterval(interval)
  }, [paused, page, typeFilter, fetchPage])

  return (
    <div className="flex flex-col gap-3 h-full">
      <Toolbar ariaLabel="Event log filters" className="shrink-0">
        <ToolbarGroup>
          <FilterSelect
            options={typeOptions}
            value={typeFilter}
            onChange={handleTypeChange}
            ariaLabel="Event type"
            allLabel="All types"
            emptyLabel="No event types yet"
          />
        </ToolbarGroup>

        <ToolbarGroup>
          <AutoRefreshToggle paused={paused} onChange={setPaused} />
        </ToolbarGroup>

        <ToolbarGroup end>
          <span className="text-xs text-text-muted">
            {total > 0 ? `Page ${page} of ${totalPages} · ${total} events` : '0 events'}
            {typeFilter && ' (filtered)'}
          </span>
        </ToolbarGroup>
      </Toolbar>

      {/* Kolom Time dan Type lebarnya dipatok, jadi tanpa geser mendatar
          kolom Payload tidak pernah kelihatan di telepon. */}
      {/* `innerClassName="h-full"` menjaga kotak gesernya tetap setinggi induk
          walau max-height persen tidak sempat terselesaikan tata letak flex. */}
      <div ref={containerRef} className="flex flex-1 min-h-0">
        <TableScroll
          label="Event log"
          maxHeight="100%"
          className="flex-1 bg-bg font-mono text-xs"
          innerClassName="h-full"
        >
          {loading && entries.length === 0 ? (
            <div className="px-4 py-8 text-center text-text-muted">Loading...</div>
          ) : entries.length === 0 ? (
            <div className="px-4 py-8 text-center text-text-muted">No events yet</div>
          ) : (
            <table className="w-full min-w-[640px]">
              <thead className="sticky top-0 bg-bg-secondary">
                <tr className="text-text-muted text-left">
                  <th className="px-3 py-2 w-12">#</th>
                  <th className="px-3 py-2 w-36">Time</th>
                  <th className="px-3 py-2 w-40">Type</th>
                  <th className="px-3 py-2">Payload</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <EventRow key={entry.seq} entry={entry} />
                ))}
              </tbody>
            </table>
          )}
        </TableScroll>
      </div>

      <Pagination page={page} totalPages={totalPages} loading={loading} onGo={goToPage} />
    </div>
  )
}

function EventRow({ entry }: { entry: EventLogEntry }) {
  const [expanded, setExpanded] = useState(false)
  const payloadStr = JSON.stringify(entry.payload)
  const isLong = payloadStr.length > 120

  return (
    <>
      <tr
        className="border-t border-border/50 hover:bg-bg-tertiary/30 transition-colors cursor-pointer"
        onClick={() => isLong && setExpanded(!expanded)}
      >
        <td className="px-3 py-1.5 text-text-muted">{entry.seq}</td>
        <td className="px-3 py-1.5 text-text-muted whitespace-nowrap">{formatDateTime(entry.ts)}</td>
        <td className={`px-3 py-1.5 ${eventTypeColor(entry.type)}`}>{entry.type}</td>
        <td className="px-3 py-1.5 text-text-muted truncate">
          {isLong ? payloadStr.slice(0, 120) + '...' : payloadStr}
          {isLong && (
            <span className="ml-1 text-accent">{expanded ? '▾' : '▸'}</span>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="border-t border-border/30">
          <td colSpan={4} className="px-3 py-2">
            <pre className="text-text-muted whitespace-pre-wrap break-all bg-bg-tertiary rounded p-2 text-[11px]">
              {JSON.stringify(entry.payload, null, 2)}
            </pre>
          </td>
        </tr>
      )}
    </>
  )
}

// ==================== Tool Call Log Section ====================

const TOOL_PAGE_SIZE = 100

const TOOLS_SCOPE = 'dev.logs.tools'

function ToolCallLogSection() {
  const [entries, setEntries] = useState<ToolCallRecord[]>([])
  const [inventory, setInventory] = useState<string[]>([])
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)

  const [nameFilter] = useFilterParam('tool', '', { scope: TOOLS_SCOPE })
  const [page] = useFilterNumber('page', 1, { scope: TOOLS_SCOPE })
  const [paused, setPaused] = useFilterFlag('paused', false, { scope: TOOLS_SCOPE })
  const write = useFilterParamWriter({ scope: TOOLS_SCOPE })

  const fetchPage = useCallback(async (p: number, name?: string) => {
    setLoading(true)
    try {
      const result = await api.agentStatus.query({
        page: p,
        pageSize: TOOL_PAGE_SIZE,
        name: name || undefined,
      })
      setEntries(result.entries)
      setTotalPages(result.totalPages)
      setTotal(result.total)
    } catch (err) {
      console.warn('Failed to load tool calls:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchPage(page, nameFilter || undefined) }, [fetchPage, page, nameFilter])

  // Daftar alat lengkap datang dari inventarisnya sendiri, bukan dari catatan
  // panggilan yang sedang tampil. Ini sumber yang benar: sebuah alat tetap
  // bisa dipilih walaupun belum pernah dipanggil dalam 100 catatan terakhir.
  useEffect(() => {
    let cancelled = false
    toolsApi
      .load()
      .then((r) => {
        if (!cancelled) setInventory(r.inventory.map((t) => t.name))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Nama dari catatan tetap ikut dikumpulkan sebagai jaring pengaman, buat
  // alat lama yang sudah dicabut dari inventaris tapi riwayatnya masih ada.
  const seenNames = useMemo(
    () => [...inventory, ...entries.map((e) => e.name)],
    [inventory, entries],
  )
  const toolUniverse = useOptionUniverse(seenNames)
  const toolOptions = useMemo(() => toOptions(toolUniverse), [toolUniverse])

  const handleNameChange = useCallback((name: string) => {
    write({ tool: name || null, page: null })
  }, [write])

  const goToPage = useCallback((p: number) => {
    write({ page: p === 1 ? null : String(p) })
    scrollTableToTop(containerRef.current)
  }, [write])

  useEffect(() => {
    if (paused || page !== 1) return
    const interval = setInterval(() => { fetchPage(1, nameFilter || undefined) }, 3000)
    return () => clearInterval(interval)
  }, [paused, page, nameFilter, fetchPage])

  return (
    <div className="flex flex-col gap-3 h-full">
      <Toolbar ariaLabel="Tool call filters" className="shrink-0">
        <ToolbarGroup>
          <FilterSelect
            options={toolOptions}
            value={nameFilter}
            onChange={handleNameChange}
            ariaLabel="Tool name"
            allLabel="All tools"
            emptyLabel="No tools yet"
          />
        </ToolbarGroup>

        <ToolbarGroup>
          <AutoRefreshToggle paused={paused} onChange={setPaused} />
        </ToolbarGroup>

        <ToolbarGroup end>
          <span className="text-xs text-text-muted">
            {total > 0 ? `Page ${page} of ${totalPages} · ${total} calls` : '0 calls'}
            {nameFilter && ' (filtered)'}
          </span>
        </ToolbarGroup>
      </Toolbar>

      {/* Enam kolom, empat di antaranya lebarnya dipatok. Totalnya sudah lewat
          lebar telepon sebelum kolom Input sempat muncul. */}
      <div ref={containerRef} className="flex flex-1 min-h-0">
        <TableScroll
          label="Tool call log"
          maxHeight="100%"
          className="flex-1 bg-bg font-mono text-xs"
          innerClassName="h-full"
        >
          {loading && entries.length === 0 ? (
            <div className="px-4 py-8 text-center text-text-muted">Loading...</div>
          ) : entries.length === 0 ? (
            <div className="px-4 py-8 text-center text-text-muted">No tool calls yet</div>
          ) : (
            <table className="w-full min-w-[760px]">
              <thead className="sticky top-0 bg-bg-secondary">
                <tr className="text-text-muted text-left">
                  <th className="px-3 py-2 w-12">#</th>
                  <th className="px-3 py-2 w-36">Time</th>
                  <th className="px-3 py-2 w-48">Tool</th>
                  <th className="px-3 py-2 w-20 text-right">Duration</th>
                  <th className="px-3 py-2 w-16 text-center">Status</th>
                  <th className="px-3 py-2">Input</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((record) => (
                  <ToolCallRow key={record.seq} record={record} />
                ))}
              </tbody>
            </table>
          )}
        </TableScroll>
      </div>

      <Pagination page={page} totalPages={totalPages} loading={loading} onGo={goToPage} />
    </div>
  )
}

function ToolCallRow({ record }: { record: ToolCallRecord }) {
  const [expanded, setExpanded] = useState(false)
  const inputStr = JSON.stringify(record.input)
  const inputPreview = inputStr.length > 100 ? inputStr.slice(0, 100) + '...' : inputStr

  return (
    <>
      <tr
        className="border-t border-border/50 hover:bg-bg-tertiary/30 transition-colors cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="px-3 py-1.5 text-text-muted">{record.seq}</td>
        <td className="px-3 py-1.5 text-text-muted whitespace-nowrap">{formatDateTime(record.timestamp)}</td>
        <td className="px-3 py-1.5 text-accent">{record.name}</td>
        <td className="px-3 py-1.5 text-right text-text-muted">{formatDuration(record.durationMs)}</td>
        <td className={`px-3 py-1.5 text-center ${statusColor(record.status)}`}>{record.status}</td>
        <td className="px-3 py-1.5 text-text-muted truncate max-w-0">
          {inputPreview}
          <span className="ml-1 text-accent">{expanded ? '▾' : '▸'}</span>
        </td>
      </tr>
      {expanded && (
        <tr className="border-t border-border/30">
          <td colSpan={6} className="px-3 py-2 space-y-2">
            <div>
              <span className="text-text-muted text-[11px] uppercase tracking-wide">Input</span>
              <pre className="text-text-muted whitespace-pre-wrap break-all bg-bg-tertiary rounded p-2 text-[11px] mt-1">
                {JSON.stringify(record.input, null, 2)}
              </pre>
            </div>
            <div>
              <span className="text-text-muted text-[11px] uppercase tracking-wide">Output</span>
              <pre className="text-text-muted whitespace-pre-wrap break-all bg-bg-tertiary rounded p-2 text-[11px] mt-1 max-h-64 overflow-y-auto">
                {formatOutput(record.output)}
              </pre>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ==================== Page ====================

type Tab = 'events' | 'tools'

const TABS: { key: Tab; label: string }[] = [
  { key: 'events', label: 'Events' },
  { key: 'tools', label: 'Tool Calls' },
]

const TAB_KEYS: readonly Tab[] = TABS.map((t) => t.key)

export function LogsPage() {
  const [tab, setTab] = useFilterEnum<Tab>('view', TAB_KEYS, 'events', { scope: 'dev.logs' })

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="border-b border-border/60">
        <Container size="wide">
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Log views">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={`px-3 py-2 text-sm font-medium transition-colors relative cursor-pointer ${
                  tab === t.key ? 'text-accent' : 'text-text-muted hover:text-text'
                }`}
              >
                {t.label}
                {tab === t.key && (
                  <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent rounded-t" />
                )}
              </button>
            ))}
          </div>
        </Container>
      </div>

      <Container size="wide" className="flex flex-1 flex-col min-h-0 py-5">
        <div className="flex-1 min-h-0">
          {tab === 'events' ? <EventLogSection /> : <ToolCallLogSection />}
        </div>
      </Container>
    </div>
  )
}
