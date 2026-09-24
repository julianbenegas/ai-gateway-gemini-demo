import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { clampSidebar, sidebarCookie } from '@/ui/sidebar'
import { Workspace } from './_components/workspace'
import { loadBoard } from './_server/board'

export const metadata: Metadata = { title: 'Margin / v1' }

export default async function Page() {
  const [snapshot, cookieStore] = await Promise.all([loadBoard(), cookies()])
  return (
    <Workspace
      snapshot={snapshot}
      sidebarWidth={clampSidebar(
        Number(cookieStore.get(sidebarCookie.v1)?.value),
      )}
    />
  )
}
