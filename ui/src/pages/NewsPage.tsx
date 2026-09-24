import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatRelativeTime } from '../lib/intl'
import { api, type NewsArticle } from '../api'
import { PageHeader } from '../components/PageHeader'
import { EmptyState } from '../components/StateViews'
import { Container } from '../components/layout/Container'
import { Toolbar, ToolbarGroup } from '../components/layout/Toolbar'
import { FilterSelect, type FilterOption } from '../components/filters/FilterSelect'
import { useFilterEnum, useFilterParam } from '../hooks/useFilterParam'

// ==================== Helpers ====================

/** Nama ruang filter di URL. Lihat `useFilterParam` soal kenapa harus diisi. */
const NEWS_SCOPE = 'news'

const LOOKBACK_VALUES = ['1h', '12h', '24h', '7d'] as const
type Lookback = (typeof LOOKBACK_VALUES)[number]

const LOOKBACK_LABEL_KEYS = {
  '1h': 'news.lookback1h',
  '12h': 'news.lookback12h',
  '24h': 'news.lookback24h',
  '7d': 'news.lookback7d',
} as const

/** Rentang terlebar yang ditawarkan sebagai jalan keluar saat hasilnya kosong. */
const WIDEST_LOOKBACK: Lookback = '7d'

const DEFAULT_LOOKBACK: Lookback = '24h'

const FETCH_LIMIT = 200

/**
 * Waktu artikel dalam milidetik. Tanggal yang tidak terbaca didorong ke paling
 * bawah, bukan jadi NaN yang bikin hasil `sort` tidak bisa ditebak.
 */
function articleTime(article: NewsArticle): number {
  const ms = Date.parse(article.time)
  return Number.isNaN(ms) ? 0 : ms
}

function collectSources(items: readonly NewsArticle[]): string[] {
  const seen = new Set<string>()
  for (const item of items) {
    if (item.source) seen.add(item.source)
  }
  return [...seen].sort()
}

// ==================== Article Row ====================

function ArticleRow({ article }: { article: NewsArticle }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const contentPreview = article.content.length > 160
    ? article.content.slice(0, 160) + '...'
    : article.content

  return (
    <div
      className="px-4 py-3 hover:bg-bg-tertiary/30 transition-colors cursor-pointer"
      onClick={() => setExpanded(!expanded)}
    >
      {/* Header row */}
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium text-text leading-snug [overflow-wrap:anywhere]">{article.title}</p>
          {/* Dibungkus: di 360px sumber + waktu + kategori tidak muat sebaris,
              dan yang kepotong duluan justru kategorinya. */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
            {article.source && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-accent/10 text-accent">
                {article.source}
              </span>
            )}
            <span className="text-[11px] text-text-muted">{formatRelativeTime(article.time)}</span>
            {article.categories && (
              <span className="min-w-0 truncate text-[11px] text-text-muted/50">{article.categories}</span>
            )}
          </div>
        </div>
        <span className="text-text-muted text-xs shrink-0 mt-0.5">{expanded ? '▾' : '▸'}</span>
      </div>

      {/* Preview / Expanded */}
      {expanded ? (
        <div className="mt-2 space-y-2">
          <p className="text-[12px] text-text-muted/80 leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">{article.content}</p>
          {article.link && (
            <a
              href={article.link}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 text-[12px] text-accent hover:underline"
            >
              {t('news.openOriginal')}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
          )}
        </div>
      ) : (
        article.content && (
          <p className="mt-1 text-[12px] text-text-muted/50 truncate">{contentPreview}</p>
        )
      )}
    </div>
  )
}

// ==================== Page ====================

export function NewsPage() {
  const { t } = useTranslation()

  // Di URL, bukan `useState`: TabHost membongkar tab yang tidak aktif di bawah
  // 768px, jadi filter yang tinggal di komponen hilang tiap kali pindah tab.
  const [lookback, setLookback] = useFilterEnum<Lookback>(
    'lookback', LOOKBACK_VALUES, DEFAULT_LOOKBACK, { scope: NEWS_SCOPE },
  )
  const [source, setSource] = useFilterParam('source', '', { scope: NEWS_SCOPE })

  const [articles, setArticles] = useState<NewsArticle[]>([])
  const [loading, setLoading] = useState(true)
  /**
   * Daftar sumber untuk dropdown. Tidak boleh diturunkan dari `articles`,
   * karena `articles` adalah respons yang SUDAH disaring oleh `source` sendiri:
   * begitu satu sumber dipilih, daftarnya menyusut jadi berisi sumber itu saja
   * dan sumber lain tidak bisa dipilih lagi tanpa memuat ulang halaman.
   *
   * Backend tidak punya endpoint yang mendaftar semua sumber (lihat
   * `src/webui/routes/news.ts`, yang ada cuma `GET /api/news`), jadi ini diisi
   * dari pilihan terbaik berikutnya: respons yang belum disaring untuk lookback
   * yang sedang berlaku. Diganti utuh, bukan digabung, supaya sumber yang sudah
   * keluar dari jendela waktu ikut hilang alih-alih tinggal sebagai pilihan
   * yang selalu menghasilkan daftar kosong.
   */
  const [sourceUniverse, setSourceUniverse] = useState<string[]>([])

  // Filter bisa berganti lebih cepat dari jaringan, dan poll 60 detik jalan
  // barengan. Tanpa penanda ini, respons lama yang datang belakangan bisa
  // menimpa hasil filter yang baru.
  const runIdRef = useRef(0)

  const refresh = useCallback(async (lb: Lookback, src: string) => {
    const runId = ++runIdRef.current
    try {
      const filtered = await api.news.list({
        lookback: lb,
        limit: FETCH_LIMIT,
        source: src || undefined,
      })
      if (runId !== runIdRef.current) return
      setArticles(filtered.items)

      // Tanpa filter sumber, respons di atas memang sudah daftar lengkapnya,
      // jadi permintaan kedua tidak perlu.
      const universe = src
        ? (await api.news.list({ lookback: lb, limit: FETCH_LIMIT })).items
        : filtered.items
      if (runId !== runIdRef.current) return
      setSourceUniverse(collectSources(universe))
    } catch (err) {
      console.warn('Failed to load news:', err)
    } finally {
      if (runId === runIdRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    void refresh(lookback, source)
  }, [lookback, source, refresh])

  useEffect(() => {
    const id = setInterval(() => void refresh(lookback, source), 60_000)
    return () => clearInterval(id)
  }, [lookback, source, refresh])

  const lookbackOptions = useMemo<FilterOption[]>(
    () => LOOKBACK_VALUES.map((value) => ({ value, label: t(LOOKBACK_LABEL_KEYS[value]) })),
    [t],
  )

  const sourceOptions = useMemo<FilterOption[]>(
    () => sourceUniverse.map((value) => ({ value, label: value })),
    [sourceUniverse],
  )

  // Urutan ditentukan di sini, bukan diwarisi dari API. Versi lama memakai
  // `[...articles].reverse()`, jadi "terbaru dulu" cuma benar selama API
  // kebetulan mengirim urutan menaik.
  const sorted = useMemo(
    () => [...articles].sort((a, b) => articleTime(b) - articleTime(a)),
    [articles],
  )

  // Bawaan 24 jam bisa menipu kalau pengumpul beritanya jarang jalan: layar
  // kosong terbaca sebagai fitur rusak. Jadi keadaan kosong membawa jalan
  // keluarnya sendiri, bukan cuma memberitahu bahwa hasilnya kosong.
  const canWiden = lookback !== WIDEST_LOOKBACK
  const emptyAction = canWiden || source ? (
    <>
      {canWiden && (
        <button type="button" className="btn-secondary-sm" onClick={() => setLookback(WIDEST_LOOKBACK)}>
          {t('news.widenRange')}
        </button>
      )}
      {source && (
        <button type="button" className="btn-secondary-sm" onClick={() => setSource('')}>
          {t('news.allSources')}
        </button>
      )}
    </>
  ) : undefined

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader title={t('nav.item.news')} />

      <Container size="default" className="flex flex-1 flex-col min-h-0 py-[clamp(18px,2.8vw,28px)]">
        <div className="flex h-full min-h-0 flex-col gap-3">
          <Toolbar ariaLabel={t('nav.item.news')} className="shrink-0">
            <ToolbarGroup label={t('news.rangeLabel')}>
              <FilterSelect
                options={lookbackOptions}
                value={lookback}
                onChange={(next) => setLookback(next as Lookback)}
                allLabel={null}
                ariaLabel={t('news.rangeLabel')}
              />
            </ToolbarGroup>

            <ToolbarGroup label={t('news.sourceLabel')}>
              <FilterSelect
                options={sourceOptions}
                value={source}
                onChange={setSource}
                allLabel={t('news.allSources')}
                ariaLabel={t('news.sourceLabel')}
              />
            </ToolbarGroup>

            <ToolbarGroup end>
              <span className="text-xs text-text-muted">
                {t('news.articleCount', { count: sorted.length })}
              </span>
            </ToolbarGroup>
          </Toolbar>

          {/* Article list */}
          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-bg">
            {loading && sorted.length === 0 ? (
              <div className="px-4 py-8 text-center text-text-muted">{t('common.loading')}</div>
            ) : sorted.length === 0 ? (
              <EmptyState
                title={t('news.noArticles')}
                description={t('news.noArticlesDescription')}
                action={emptyAction}
              />
            ) : (
              <div className="divide-y divide-border/50">
                {sorted.map((article, i) => (
                  <ArticleRow key={`${article.time}-${i}`} article={article} />
                ))}
              </div>
            )}
          </div>
        </div>
      </Container>
    </div>
  )
}
