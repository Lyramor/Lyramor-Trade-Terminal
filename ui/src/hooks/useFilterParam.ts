import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * Filter yang bertahan lintas navigasi, disimpan di search params URL.
 *
 * ## Kenapa ini ada
 *
 * `TabHost` membongkar tab yang tidak aktif di bawah 768px (lihat komentar di
 * sana soal kenapa itu dipertahankan). Semua filter di aplikasi ini dulu
 * disimpan sebagai `useState` lokal komponen, dan `ViewSpec.params` untuk
 * sebagian besar view kosong (`Record<string, never>`). Jadi di telepon,
 * setiap kali pengguna pindah tab dan kembali, rentang tanggal, sumber
 * berita, dan tipe log yang barusan dipilih hilang semua.
 *
 * Satu-satunya filter yang selamat adalah interval dan range di KlinePanel,
 * karena dia menyimpan nilainya di URL. Berkas ini mengangkat pola itu jadi
 * primitif supaya semua filter lain bisa ikut selamat.
 *
 * ## Kenapa URL, bukan `ViewSpec.params`
 *
 * `specEquals` di `src/tabs/types.ts` membandingkan seluruh `params` untuk
 * menentukan "ini tab yang sama atau bukan". Kalau nilai filter ikut masuk ke
 * `params`, setiap kali pengguna mengubah filter, `openOrFocus` akan menganggap
 * itu view yang berbeda dan membuka TAB BARU. Params adalah identitas, bukan
 * keadaan. Jadi filter tinggal di URL.
 *
 * ## Yang perlu diketahui soal UrlSync
 *
 * `UrlSync` di `src/tabs/UrlAdopter.tsx` menulis `toUrl(spec)` ke
 * `window.history.replaceState` setiap kali tab fokus berganti, dan `toUrl`
 * tidak tahu apa-apa soal filter. Jadi di bilah alamat, query filter memang
 * kebuang saat pindah tab.
 *
 * Nilainya sendiri TIDAK ikut hilang: `replaceState` mentah tidak memberi tahu
 * react-router, jadi lokasi internal router masih memegang query-nya, dan itulah
 * yang dibaca `useSearchParams`. Inilah alasan filter KlinePanel selamat hari ini,
 * dan alasan yang sama berlaku untuk hook ini, termasuk saat komponennya dibongkar
 * di telepon.
 *
 * Konsekuensi yang dipilih sadar: filter selamat selama sesi, tapi tidak ikut
 * saat URL-nya disalin atau halaman dimuat ulang. Untuk filter tampilan, itu
 * pertukaran yang benar.
 *
 * ## Namai ruangnya
 *
 * Search params itu satu ruang global untuk seluruh aplikasi. Dua halaman yang
 * sama-sama memakai kunci `status` akan saling membaca nilai satu sama lain.
 * Jadi isi `scope`, dan pakai nama view sebagai nilainya:
 *
 * ```ts
 * const [status, setStatus] = useFilterEnum(
 *   'status', ['open', 'closed'] as const, 'open', { scope: 'issues' },
 * )
 * // → ?issues.status=closed
 * ```
 *
 * Halaman yang menerima `spec` bisa memakai `filterScope(spec)` dari
 * `src/tabs/types.ts` supaya nama ruangnya konsisten tanpa ditebak-tebak.
 */

export interface FilterParamOptions {
  /** Awalan nama parameter supaya tidak bentrok antar halaman. Sangat dianjurkan. */
  scope?: string
  /**
   * Catat perubahan ke riwayat browser, jadi tombol Back mengembalikan filter
   * sebelumnya. Bawaannya `false` (replace), mengikuti KlinePanel: mengubah
   * filter lima kali tidak seharusnya butuh lima kali Back untuk keluar halaman.
   */
  push?: boolean
}

function paramName(key: string, scope?: string): string {
  return scope ? `${scope}.${key}` : key
}

/**
 * Penulis tingkat rendah: menulis beberapa parameter sekaligus dalam satu
 * pembaruan. Dipakai kalau satu kendali memegang lebih dari satu nilai,
 * misal DateRangeFilter yang mengisi `from` dan `to` bersamaan.
 *
 * Penting: jangan memanggil dua setter terpisah dalam satu tick untuk maksud
 * yang sama. Keduanya membaca lokasi yang sama dan yang kedua akan menimpa
 * yang pertama. Untuk itulah patch ini ada.
 *
 * Nilai `null` atau string kosong berarti hapus parameternya.
 */
export function useFilterParamWriter(
  options?: FilterParamOptions,
): (patch: Record<string, string | null>) => void {
  const [, setSearchParams] = useSearchParams()
  const scope = options?.scope
  const push = options?.push ?? false

  return useCallback(
    (patch: Record<string, string | null>) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [key, value] of Object.entries(patch)) {
            const name = paramName(key, scope)
            if (value == null || value === '') next.delete(name)
            else next.set(name, value)
          }
          return next
        },
        { replace: !push },
      )
    },
    [setSearchParams, scope, push],
  )
}

/**
 * Satu filter berupa string bebas: kotak cari, id sumber, apa pun.
 *
 * Nilai yang sama dengan `defaultValue` disimpan sebagai "parameter dihapus",
 * bukan ditulis apa adanya, supaya URL-nya tidak penuh nilai bawaan.
 */
export function useFilterParam(
  key: string,
  defaultValue = '',
  options?: FilterParamOptions,
): [string, (next: string) => void] {
  const [searchParams] = useSearchParams()
  const write = useFilterParamWriter(options)
  const raw = searchParams.get(paramName(key, options?.scope))
  const value = raw ?? defaultValue

  const setValue = useCallback(
    (next: string) => {
      write({ [key]: next === defaultValue ? null : next })
    },
    [write, key, defaultValue],
  )

  return [value, setValue]
}

/**
 * Filter dengan himpunan nilai tertutup: tab, rentang, mode urut.
 *
 * Nilai di URL divalidasi terhadap `allowed`. URL bisa diketik orang atau
 * tertinggal dari versi lama, dan halaman tidak boleh percaya begitu saja
 * pada nilai yang tidak dikenal.
 */
export function useFilterEnum<T extends string>(
  key: string,
  allowed: readonly T[],
  defaultValue: T,
  options?: FilterParamOptions,
): [T, (next: T) => void] {
  const [raw, setRaw] = useFilterParam(key, defaultValue, options)
  const value = (allowed as readonly string[]).includes(raw) ? (raw as T) : defaultValue
  const setValue = useCallback((next: T) => setRaw(next), [setRaw])
  return [value, setValue]
}

/** Filter hidup/mati: "cuma yang punya posisi", "sembunyikan nol". */
export function useFilterFlag(
  key: string,
  defaultValue = false,
  options?: FilterParamOptions,
): [boolean, (next: boolean) => void] {
  const [raw, setRaw] = useFilterParam(key, defaultValue ? '1' : '0', options)
  const value = raw === '1' || raw === 'true'
  const setValue = useCallback((next: boolean) => setRaw(next ? '1' : '0'), [setRaw])
  return [value, setValue]
}

/**
 * Filter angka: nomor halaman, batas baris.
 *
 * Nilai yang bukan angka jatuh ke bawaan, bukan ke NaN. NaN yang bocor ke
 * parameter fetch adalah cara paling gampang menampilkan tabel kosong tanpa
 * penjelasan.
 */
export function useFilterNumber(
  key: string,
  defaultValue: number,
  options?: FilterParamOptions,
): [number, (next: number) => void] {
  const [raw, setRaw] = useFilterParam(key, String(defaultValue), options)
  const parsed = Number(raw)
  const value = Number.isFinite(parsed) ? parsed : defaultValue
  const setValue = useCallback((next: number) => setRaw(String(next)), [setRaw])
  return [value, setValue]
}

export interface FilterRange {
  /** `YYYY-MM-DD`, atau string kosong kalau belum diisi. */
  from: string
  to: string
}

export interface FilterRangeOptions extends FilterParamOptions {
  fromKey?: string
  toKey?: string
}

/**
 * Rentang tanggal sebagai satu nilai. Pasangan untuk `DateRangeFilter`.
 *
 * Kedua ujungnya ditulis dalam satu pembaruan, jadi memilih preset tidak
 * pernah meninggalkan keadaan setengah jadi di mana `from` sudah berubah
 * tapi `to` masih yang lama, dan fetch terlanjur jalan dengan rentang campur.
 */
export function useFilterRange(
  options?: FilterRangeOptions,
): [FilterRange, (next: FilterRange) => void] {
  const fromKey = options?.fromKey ?? 'from'
  const toKey = options?.toKey ?? 'to'
  const [searchParams] = useSearchParams()
  const write = useFilterParamWriter(options)

  const from = searchParams.get(paramName(fromKey, options?.scope)) ?? ''
  const to = searchParams.get(paramName(toKey, options?.scope)) ?? ''

  // Dijaga identitasnya supaya aman dipakai sebagai dependency effect fetch.
  const value = useMemo<FilterRange>(() => ({ from, to }), [from, to])

  const setValue = useCallback(
    (next: FilterRange) => {
      write({ [fromKey]: next.from || null, [toKey]: next.to || null })
    },
    [write, fromKey, toKey],
  )

  return [value, setValue]
}
