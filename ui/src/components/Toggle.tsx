interface ToggleProps {
  checked: boolean
  onChange: (v: boolean) => void
  size?: 'sm' | 'md'
  /**
   * Nama aksesibel. Saklar ini tidak punya teks di dalamnya, jadi tanpa ini
   * pembaca layar cuma mengumumkan "switch, on" tanpa menyebut saklar apa.
   * Boleh dilewati kalau pemanggil sudah membungkusnya dalam `<label>` atau
   * memberi `aria-labelledby` di sekitarnya.
   */
  ariaLabel?: string
  disabled?: boolean
}

/**
 * Saklar hidup/mati.
 *
 * Dua hal yang diperbaiki di sini dan kelihatannya sepele tapi tidak:
 *
 * `type="button"` — tanpa itu, tombol di dalam `<form>` bawaannya submit,
 * jadi menyalakan saklar di halaman setelan ikut mengirim formulirnya.
 *
 * Sasaran sentuh — saklar `md` cuma setinggi 22px, jauh di bawah lebar jari.
 * Ditambal pakai pseudo-element yang melebar ke luar, jadi daerah yang bisa
 * ditekan membesar tanpa mengubah tata letak sedikit pun.
 */
export function Toggle({ checked, onChange, size = 'md', ariaLabel, disabled = false }: ToggleProps) {
  const track = size === 'sm' ? 'w-8 h-[18px]' : 'w-10 h-[22px]'
  const thumb = size === 'sm' ? 'w-3 h-3 bottom-[2.5px] left-[3px]' : 'w-4 h-4 bottom-[3px] left-[3px]'
  const translate = size === 'sm' ? 'translate-x-[14px]' : 'translate-x-[18px]'

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative shrink-0 rounded-full cursor-pointer transition-colors ${track} ${
        checked ? 'bg-accent' : 'bg-bg-tertiary'
      } before:absolute before:-inset-2 before:content-['']
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg
        disabled:cursor-default disabled:opacity-40`}
    >
      <span
        className={`absolute rounded-full transition-all ${thumb} ${
          checked ? `${translate} bg-white` : 'bg-text-muted'
        }`}
      />
    </button>
  )
}
