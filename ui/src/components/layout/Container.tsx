import type { CSSProperties, ReactNode } from 'react'

/**
 * Penggabung className seadanya. Repo ini belum pakai clsx / tailwind-merge,
 * dan menambah dua dependensi cuma buat menyambung string rasanya kelewatan.
 *
 * Catatan penting: ini TIDAK menyelesaikan bentrok utilitas Tailwind. Kalau
 * pemanggil mengirim `max-w-[900px]` sementara Container sudah menulis
 * `max-w-[1100px]`, yang menang ditentukan urutan di stylesheet, bukan urutan
 * argumen di sini. Jadi untuk mengubah lebar, pakai prop `size`, jangan
 * menimpa lewat `className`.
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

/**
 * Lebar kanonis. Sebelum ada berkas ini, ada 13 lebar berbeda tersebar di
 * 28 tempat (420, 460, 520, 640, 720, 820, 880, 900, 1040, 1100, 1200, 1240),
 * jadi dua halaman bersebelahan punya tepi yang tidak sama. Lima nama di
 * bawah menampung semuanya:
 *
 *   prose   — satu kolom bacaan: file viewer, halaman kosong, blok penjelasan
 *   form    — halaman setelan / konfigurasi (dulu 820 / 880 / 900)
 *   default — halaman isi biasa (dulu 1040 / 1100)
 *   wide    — papan padat dan tabel lebar (dulu 1200 / 1240)
 *   full    — tanpa batas, isi mengikuti lebar induk
 *
 * Lebar dipatok supaya kolom baca di monitor 27" sama dengan di laptop 15";
 * yang tumbuh cuma margin luarnya.
 */
export type ContainerSize = 'prose' | 'form' | 'default' | 'wide' | 'full'

const WIDTHS: Record<ContainerSize, string> = {
  prose: 'max-w-[720px]',
  form: 'max-w-[880px]',
  default: 'max-w-[1100px]',
  wide: 'max-w-[1280px]',
  full: 'max-w-none',
}

/**
 * Satu-satunya resep pagar kiri-kanan di seluruh aplikasi.
 * Nilainya `clamp(16px, 4vw, 32px)`, didefinisikan sebagai `--page-gutter`
 * di `src/index.css` supaya CSS mentah (PageHeader, sticky bar) bisa ikut
 * memakai angka yang sama. Dulu ada 6 resep berbeda: `px-4`, `px-6`,
 * `px-4 md:px-6`, `px-4 md:px-8`, `px-3`, dan `p-3`.
 */
export const PAGE_GUTTER = 'px-[var(--page-gutter)]'

type ContainerElement = 'div' | 'section' | 'main' | 'article' | 'header' | 'footer'

interface ContainerProps {
  size?: ContainerSize
  /**
   * Buang pagar kiri-kanan. Dipakai kalau isinya memang harus menyentuh tepi,
   * misal tabel lebar yang digeser mendatar atau strip tab. Jangan dipakai
   * cuma karena padding-nya terasa besar.
   */
  bleed?: boolean
  /** `start` menempel kiri, bukan dipusatkan. Untuk kolom form di halaman lebar. */
  align?: 'center' | 'start'
  as?: ContainerElement
  className?: string
  style?: CSSProperties
  children: ReactNode
}

/**
 * Pembungkus isi halaman: satu lebar maksimum + satu resep padding.
 *
 * Aturannya sederhana: jangan pernah lagi menulis `mx-auto max-w-[...] px-...`
 * langsung di halaman atau seksi. Kalau butuh lebar yang belum ada di sini,
 * tambahkan namanya ke `ContainerSize`, bukan menulis angka di tempat pakai.
 *
 * ```tsx
 * <Container size="wide">
 *   <Section title="Positions">…</Section>
 * </Container>
 * ```
 */
export function Container({
  size = 'default',
  bleed = false,
  align = 'center',
  as: Tag = 'div',
  className,
  style,
  children,
}: ContainerProps) {
  return (
    <Tag
      className={cx(
        'w-full',
        align === 'center' && 'mx-auto',
        WIDTHS[size],
        !bleed && PAGE_GUTTER,
        className,
      )}
      style={style}
    >
      {children}
    </Tag>
  )
}
