import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { preferenceCookie, readThinking } from '@/lib/preferences'
import { clampSidebar } from '@/ui/sidebar'
import { Workspace } from '../_components/workspace'
import { loadBoard } from '../_server/board'

export const metadata: Metadata = { title: 'Margin / v1' }

export default async function Page({
  params,
}: {
  params: Promise<{ board?: string[] }>
}) {
  const [{ board = [] }, snapshot, cookieStore] = await Promise.all([
    params,
    loadBoard(),
    cookies(),
  ])
  return (
    <Workspace
      snapshot={snapshot}
      boardId={board.length === 1 ? `page:${board[0]}` : null}
      sidebarWidth={clampSidebar(
        Number(cookieStore.get(preferenceCookie.v1.sidebar)?.value),
      )}
      thinking={readThinking(
        cookieStore.get(preferenceCookie.v1.thinking)?.value,
      )}
    />
  )
}
