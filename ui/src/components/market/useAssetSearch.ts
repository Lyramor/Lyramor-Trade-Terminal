import { useCallback, useEffect, useState } from 'react'
import { barsApi, type BarSourceCandidate } from '../../api/market'

export interface AssetSearchState {
  results: BarSourceCandidate[]
  loading: boolean
  /**
   * Hasilnya mentok di batas, jadi besar kemungkinan masih ada sisanya.
   * Endpoint-nya mengembalikan `count` sebesar jumlah kandidat yang dikirim,
   * bukan total yang cocok, jadi ini tebakan yang jujur dan bukan angka pasti.
   */
  truncated: boolean
  /** Berapa yang sedang tampil, buat dipasang di pesan "baru sekian". */
  shown: number
  /** Ambil satu halaman lagi. */
  showMore: () => void
}

/**
 * The single source of truth for asset search — used by BOTH the market sidebar
 * and the main search box, so their logic can't drift apart again. Debounced
 * (300ms) federated source search: each result is a specific provider's K-line
 * (vendor or a connected broker), with the provider always explicit — never
 * merged. Pick a result → open the chart on exactly that source.
 *
 * Batasnya sekarang diurus dari dalam hook ini, bukan dari pemakainya, supaya
 * sidebar dan kotak cari halaman kebagian perilaku yang sama. Dulu batasnya
 * dipatok 24 tanpa tanda apa pun: hasil ke-25 dan seterusnya tidak pernah
 * terlihat, dan tidak ada yang memberi tahu bahwa masih ada sisanya.
 */
export function useAssetSearch(query: string, pageSize = 24): AssetSearchState {
  const [limit, setLimit] = useState(pageSize)
  const [results, setResults] = useState<BarSourceCandidate[]>([])
  const [loading, setLoading] = useState(false)

  // Kata kuncinya ganti berarti halamannya mulai dari awal. Ditaruh di atas
  // efek pengambil data supaya batas yang dipakai fetch berikutnya sudah baru.
  useEffect(() => { setLimit(pageSize) }, [query, pageSize])

  useEffect(() => {
    const q = query.trim()
    if (!q) { setResults([]); setLoading(false); return }
    setLoading(true)
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const res = await barsApi.searchSources(q, limit)
        if (!cancelled) setResults(res.candidates)
      } catch (e) {
        console.error('asset search failed', e)
        if (!cancelled) setResults([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 300)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [query, limit])

  const showMore = useCallback(() => { setLimit((current) => current + pageSize) }, [pageSize])

  return {
    results,
    loading,
    truncated: !loading && results.length >= limit,
    shown: results.length,
    showMore,
  }
}
