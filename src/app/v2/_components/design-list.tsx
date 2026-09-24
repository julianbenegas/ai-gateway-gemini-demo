import { SectionLabel } from '@/ui/section-label'
import { SidebarItem } from '@/ui/sidebar-item'
import { SidebarResizer } from '@/ui/sidebar-resizer'
import type { Design } from '../_lib/types'
import { NewDesign } from './new-design'

export function DesignList({
  designs,
  currentId,
  width,
  onResize,
  onRename,
  onDuplicate,
  onDelete,
}: {
  designs: Design[]
  currentId: string | null
  width: number
  onResize: (width: number) => void
  onRename: (design: { id: string; name: string }) => void
  onDuplicate: (design: { id: string }) => void
  onDelete: (design: { id: string; name: string }) => void
}) {
  return (
    <aside
      aria-label="Designs"
      className="relative z-20 col-start-1 row-start-2 flex min-h-0 flex-col bg-background px-4 pb-3 max-sm:absolute max-sm:top-10 max-sm:bottom-0 max-sm:left-0 max-sm:w-56 max-sm:shadow-lg"
    >
      <SectionLabel action={<NewDesign compact />}>Designs</SectionLabel>
      <nav className="mt-1 flex min-h-0 flex-col overflow-auto">
        {designs.map((design) => (
          <SidebarItem
            key={design.id}
            name={design.name}
            current={design.id === currentId}
            href={`/v2/${design.id}`}
            onRename={(name) => onRename({ id: design.id, name })}
            actions={[
              {
                label: 'Duplicate',
                onSelect: () => onDuplicate({ id: design.id }),
              },
              {
                label: 'Delete',
                danger: true,
                onSelect: () => onDelete({ id: design.id, name: design.name }),
              },
            ]}
          />
        ))}
      </nav>
      <SidebarResizer width={width} onResize={onResize} />
    </aside>
  )
}
