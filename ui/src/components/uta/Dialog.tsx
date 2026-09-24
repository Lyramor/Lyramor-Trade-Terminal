import { useCallback, useEffect } from 'react'

/** Generic modal dialog used by the UTA wizard + edit flows. */
export function Dialog({ onClose, width, children }: {
  onClose: () => void
  width?: string
  children: React.ReactNode
}) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return (
    // z-[60] keeps dialogs above the mobile nav drawers (z-50).
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      {/* Tingginya dipatok pakai `dvh`, bukan `vh`. Di browser telepon, `vh`
          dihitung dari viewport saat bilah alamat tersembunyi, jadi 85vh bisa
          lebih tinggi dari layar yang benar-benar terlihat dan footer dialog
          (tempat tombol Save dan Place Order) terdorong keluar tanpa ada yang
          bisa menggesernya. `dvh` ikut menyusut bersama bilah alamat, jadi
          footernya selalu kejangkau. Satu baris ini kena ke semua dialog UTA. */}
      <div className={`relative ${width || 'w-full sm:w-[560px]'} max-w-[95vw] max-h-[85dvh] bg-bg rounded-xl border border-border shadow-2xl flex flex-col overflow-hidden`}>
        {children}
      </div>
    </div>
  )
}
