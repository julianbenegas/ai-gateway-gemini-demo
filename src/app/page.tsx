import { cookies } from 'next/headers'
import { loadBoard } from '@/canvas/server/board'
import { Workspace } from '@/canvas/workspace'
import { clampSidebar, sidebarCookie } from '@/ui/sidebar'

export default async function Page() {
  const [snapshot, cookieStore] = await Promise.all([loadBoard(), cookies()])
  return (
    <Workspace
      snapshot={snapshot}
      sidebarWidth={clampSidebar(
        Number(cookieStore.get(sidebarCookie.canvas)?.value),
      )}
    />
  )
}
