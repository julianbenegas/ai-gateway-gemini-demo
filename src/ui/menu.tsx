'use client'

import { useEffect, useRef } from 'react'

export type MenuItem = { label: string; onSelect: () => void }

/** A small menu at a point, such as a right-click. */
export function Menu({
  at,
  items,
  onClose,
}: {
  at: { x: number; y: number }
  items: MenuItem[]
  onClose: () => void
}) {
  const menu = useRef<HTMLDivElement>(null)
  useEffect(() => {
    menu.current?.querySelector('button')?.focus()
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) onClose()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', outside)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('pointerdown', outside)
      window.removeEventListener('keydown', escape)
    }
  }, [onClose])
  return (
    <div
      ref={menu}
      role="menu"
      style={{ left: at.x, top: at.y }}
      className="fixed z-50 min-w-36 bg-shade py-1 shadow-lg shadow-black/40"
    >
      {items.map((item) => (
        <button
          key={item.label}
          role="menuitem"
          onClick={() => {
            onClose()
            item.onSelect()
          }}
          className="flex h-7 w-full items-center px-3 text-left text-dim outline-none hover:bg-shade-hover hover:text-bright focus-visible:bg-shade-hover focus-visible:text-bright"
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
