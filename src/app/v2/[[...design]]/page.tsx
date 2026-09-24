import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { z } from 'zod'
import { preferenceCookie, readThinkingLevel } from '@/lib/preferences'
import { clampSidebar } from '@/ui/sidebar'
import { Studio } from '../_components/studio'
import { owner } from '../_server/auth'
import { listDesigns, readDesign } from '../_server/store'

export const metadata: Metadata = { title: 'Margin / v2' }

export default async function Page({
  params,
}: {
  params: Promise<{ design?: string[] }>
}) {
  const [{ design: path = [] }, cookieStore, current] = await Promise.all([
    params,
    cookies(),
    owner.read(),
  ])
  const preferences = {
    sidebarWidth: clampSidebar(
      Number(cookieStore.get(preferenceCookie.v2.sidebar)?.value),
    ),
    thinking: readThinkingLevel(
      cookieStore.get(preferenceCookie.v2.thinking)?.value,
    ),
  }
  const designs = await listDesigns({ owner: current })
  if (!path.length) {
    const latest = designs.at(-1)
    if (latest) redirect(`/v2/${latest.id}`)
    return <Studio designs={[]} site={null} {...preferences} />
  }
  const id = z.uuid().safeParse(path[0]).data
  if (!current || !id || path.length > 1 || !designs.some((d) => d.id === id))
    notFound()
  const site = await readDesign({ owner: current, id })
  return <Studio key={id} designs={designs} site={site} {...preferences} />
}
