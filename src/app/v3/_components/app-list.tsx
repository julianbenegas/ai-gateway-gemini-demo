import { SectionLabel } from '@/ui/section-label'
import { SidebarItem } from '@/ui/sidebar-item'
import { SidebarResizer } from '@/ui/sidebar-resizer'
import type { App } from '../_lib/types'
import { NewApp } from './new-app'

export function AppList({
  apps,
  currentId,
  width,
  onResize,
  onRename,
  onDelete,
}: {
  apps: App[]
  currentId: string | null
  width: number
  onResize: (width: number) => void
  onRename: (app: { id: string; name: string }) => void
  onDelete: (app: App) => void
}) {
  return (
    <aside
      aria-label="Apps"
      className="relative z-20 col-start-1 row-start-2 flex min-h-0 flex-col bg-background px-4 pb-3 max-sm:absolute max-sm:top-10 max-sm:bottom-0 max-sm:left-0 max-sm:w-56 max-sm:shadow-lg"
    >
      <SectionLabel action={<NewApp compact />}>Apps</SectionLabel>
      <nav className="mt-1 flex min-h-0 flex-col overflow-auto">
        {apps.map((app) => (
          <SidebarItem
            key={app.id}
            name={app.name}
            current={app.id === currentId}
            href={`/v3/${app.id}`}
            onRename={(name) => onRename({ id: app.id, name })}
            actions={[
              { label: 'Delete', danger: true, onSelect: () => onDelete(app) },
            ]}
          />
        ))}
      </nav>
      <SidebarResizer width={width} onResize={onResize} />
    </aside>
  )
}
