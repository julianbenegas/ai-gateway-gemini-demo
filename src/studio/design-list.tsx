import { Asterisk, Plus } from 'lucide-react'
import { IconButton } from '@/ui/button'
import { cx } from '@/ui/cx'
import { SectionLabel } from '@/ui/section-label'
import { SidebarResizer } from '@/ui/sidebar-resizer'
import type { Design } from './types'

export function DesignList({
  designs,
  currentId,
  disabled,
  width,
  onResize,
  onOpen,
}: {
  designs: Design[]
  currentId: string | null
  disabled: boolean
  width: number
  onResize: (width: number) => void
  onOpen: (id: string | null) => void
}) {
  return (
    <aside
      aria-label="Designs"
      className="relative z-20 col-start-1 row-start-2 flex min-h-0 flex-col bg-background px-4 pb-3 max-sm:absolute max-sm:top-10 max-sm:bottom-0 max-sm:left-0 max-sm:w-56 max-sm:shadow-lg"
    >
      <SectionLabel
        action={
          <IconButton
            label="New design"
            size="icon-sm"
            disabled={disabled}
            onClick={() => onOpen(null)}
          >
            <Plus size={14} />
          </IconButton>
        }
      >
        Designs
      </SectionLabel>
      <nav className="mt-1 flex min-h-0 flex-col overflow-auto">
        {designs.map((design) => (
          <button
            key={design.id}
            aria-current={design.id === currentId ? 'page' : undefined}
            disabled={disabled}
            onClick={() => onOpen(design.id)}
            className={cx(
              'group flex h-7 items-center gap-1 text-left',
              design.id === currentId ? 'text-bright' : 'text-dim',
            )}
          >
            <Asterisk
              size={14}
              className={cx(
                'shrink-0',
                design.id === currentId ? 'text-accent' : 'text-faint',
              )}
            />
            <span className="truncate group-hover:underline">
              {design.name}
            </span>
          </button>
        ))}
      </nav>
      <SidebarResizer width={width} onResize={onResize} />
    </aside>
  )
}
