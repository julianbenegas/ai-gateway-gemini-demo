'use client'

import { ScrollArea as Base } from '@base-ui/react/scroll-area'
import { cx } from './cx'

/** Native scrolling with a thin thumb that shows while hovering or scrolling. */
export function ScrollArea({
  children,
  className,
  label,
}: {
  children: React.ReactNode
  className?: string
  label?: string
}) {
  return (
    <Base.Root className={cx('relative min-h-0', className)}>
      <Base.Viewport
        aria-label={label}
        className="size-full overscroll-contain outline-none"
      >
        {children}
      </Base.Viewport>
      <Base.Scrollbar className="m-1 flex w-1 justify-center opacity-0 transition-opacity duration-300 data-hovering:opacity-100 data-scrolling:opacity-100 data-scrolling:duration-0">
        <Base.Thumb className="w-full bg-faint/50 hover:bg-muted" />
      </Base.Scrollbar>
    </Base.Root>
  )
}
