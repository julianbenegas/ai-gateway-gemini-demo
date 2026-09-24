import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { z } from 'zod'
import { preferenceCookie, readThinkingLevel } from '@/lib/preferences'
import { clampSidebar } from '@/ui/sidebar'
import { Workspace } from '../_components/workspace'
import { appAgent } from '../_lib/agent'
import { SessionProvider } from '../_lib/session'
import { agentServer } from '../_server/agent'
import { listApps } from '../_server/apps'
import { owner } from '../_server/auth'

export const metadata: Metadata = { title: 'Margin / v3' }

export default async function Page({
  params,
}: {
  params: Promise<{ app?: string[] }>
}) {
  const [{ app: path = [] }, cookieStore, current] = await Promise.all([
    params,
    cookies(),
    owner.read(),
  ])
  const preferences = {
    sidebarWidth: clampSidebar(
      Number(cookieStore.get(preferenceCookie.v3.sidebar)?.value),
    ),
    thinking: readThinkingLevel(
      cookieStore.get(preferenceCookie.v3.thinking)?.value,
    ),
  }
  const apps = await listApps({ owner: current })
  if (!path.length) {
    const latest = apps.at(-1)
    if (latest) redirect(`/v3/${latest.id}`)
    return <Workspace apps={[]} appId={null} {...preferences} />
  }
  const id = z.uuid().safeParse(path[0]).data
  if (!current || !id || path.length > 1 || !apps.some((app) => app.id === id))
    notFound()
  // The conversation renders on the server; the provider resumes from here.
  const { state, index } = await agentServer.session(id).state(appAgent.reducer)
  return (
    <SessionProvider
      key={id}
      sessionId={id}
      initialState={state}
      initialIndex={index}
    >
      <Workspace apps={apps} appId={id} {...preferences} />
    </SessionProvider>
  )
}
