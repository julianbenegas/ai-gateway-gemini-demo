'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PanelLeft } from 'lucide-react'
import type { ThinkingLevel } from '@/lib/models'
import { preferenceCookie } from '@/lib/preferences'
import { Brand } from '@/ui/brand'
import { IconButton } from '@/ui/button'
import { ConfirmDialog } from '@/ui/dialog'
import { EmptyState } from '@/ui/empty-state'
import { useSidebarWidth } from '@/ui/sidebar-resizer'
import { appsApi } from '../_lib/rpc'
import type { App } from '../_lib/types'
import { AppList } from './app-list'
import { Chat } from './chat'
import { DesktopView } from './desktop-view'
import { NewApp } from './new-app'
import { VoiceBar } from './voice-bar'

/** Apps on the left, then the agent's chat and its desktop side by side. */
export function Workspace({
  apps: initialApps,
  appId,
  sidebarWidth: initialWidth,
  thinking,
}: {
  apps: App[]
  appId: string | null
  sidebarWidth: number
  thinking: ThinkingLevel
}) {
  const router = useRouter()
  const [apps, setApps] = useState(initialApps)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useSidebarWidth({
    cookie: preferenceCookie.v3.sidebar,
    initial: initialWidth,
  })
  const [deleting, setDeleting] = useState<App | null>(null)
  const current = apps.find((app) => app.id === appId)

  const renameApp = async ({ id, name }: { id: string; name: string }) => {
    setApps((apps) =>
      apps.map((app) => (app.id === id ? { ...app, name } : app)),
    )
    await appsApi.renameApp({ id, name })
  }
  const deleteApp = async ({ id }: { id: string }) => {
    await appsApi.deleteApp({ id })
    setDeleting(null)
    if (id === appId) router.push('/v3')
    else setApps((apps) => apps.filter((app) => app.id !== id))
  }

  return (
    <main
      style={
        {
          '--sidebar': sidebarOpen ? `${sidebarWidth}px` : '0px',
        } as React.CSSProperties
      }
      className="grid h-dvh grid-cols-[var(--sidebar)_1fr] grid-rows-[40px_1fr] max-sm:grid-cols-[0px_1fr]"
    >
      <header className="col-span-2 flex items-center gap-3 px-2">
        <IconButton
          label="Toggle apps"
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          <PanelLeft size={16} />
        </IconButton>
        <Brand href="/v3" suffix="v3" />
        <span className="truncate text-faint max-sm:hidden">
          {current?.name}
        </span>
      </header>
      {sidebarOpen && (
        <AppList
          apps={apps}
          currentId={appId}
          width={sidebarWidth}
          onResize={setSidebarWidth}
          onRename={renameApp}
          onDelete={setDeleting}
        />
      )}
      <div className="col-start-2 row-start-2 grid min-h-0 grid-cols-[minmax(320px,9fr)_11fr] max-lg:grid-cols-1 max-lg:grid-rows-[1fr_1fr]">
        {appId ? (
          <>
            <Chat toolbar={<VoiceBar appId={appId} thinking={thinking} />} />
            <DesktopView appId={appId} />
          </>
        ) : (
          <div className="col-span-2 grid place-items-center">
            <EmptyState title="No apps" action={<NewApp />}>
              Each app gets a coding agent and its own computer.
            </EmptyState>
          </div>
        )}
      </div>
      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}`}
          confirmLabel="Delete"
          onConfirm={() => deleteApp(deleting)}
          onClose={() => setDeleting(null)}
        >
          This deletes the app and its computer, with everything the agent built
          on it.
        </ConfirmDialog>
      )}
    </main>
  )
}
