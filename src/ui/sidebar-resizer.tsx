'use client'

import { useState } from 'react'
import { cx } from './cx'
import {
  clampSidebar,
  SIDEBAR_DEFAULT,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
} from './sidebar'

/**
 * A draggable sidebar width. It is kept in a cookie so the server renders the
 * saved width and the layout doesn't shift on load.
 */
export function useSidebarWidth(cookie: string, initial: number) {
  const [width, setWidth] = useState(initial)
  const resize = (next: number) => {
    const width = clampSidebar(next)
    setWidth(width)
    document.cookie = `${cookie}=${width}; path=/; max-age=31536000; samesite=lax`
  }
  return [width, resize] as const
}

/** Drag handle on a sidebar's right edge; the sidebar must be `relative`. */
export function SidebarResizer({
  width,
  onResize,
}: {
  width: number
  onResize: (width: number) => void
}) {
  const [drag, setDrag] = useState<{ x: number; width: number } | null>(null)
  return (
    <>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuenow={width}
        aria-valuemin={SIDEBAR_MIN}
        aria-valuemax={SIDEBAR_MAX}
        tabIndex={0}
        onPointerDown={(event) => {
          event.preventDefault()
          setDrag({ x: event.clientX, width })
        }}
        onDoubleClick={() => onResize(SIDEBAR_DEFAULT)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') onResize(width - 16)
          if (event.key === 'ArrowRight') onResize(width + 16)
        }}
        className="group absolute inset-y-0 -right-1.5 z-10 w-3 cursor-col-resize outline-none max-sm:hidden"
      >
        <span
          className={cx(
            'absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-accent opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100',
            drag && 'opacity-100',
          )}
        />
      </div>
      {drag && (
        // Covers iframes and the canvas so they don't swallow the drag.
        <div
          className="fixed inset-0 z-50 cursor-col-resize"
          onPointerMove={(event) =>
            onResize(drag.width + event.clientX - drag.x)
          }
          onPointerUp={() => setDrag(null)}
          onPointerCancel={() => setDrag(null)}
        />
      )}
    </>
  )
}
