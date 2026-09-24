import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { Studio } from '@/studio/studio'
import { clampSidebar, sidebarCookie } from '@/ui/sidebar'

export const metadata: Metadata = { title: 'Margin / v2' }

export default async function Page() {
  const width = (await cookies()).get(sidebarCookie.studio)?.value
  return <Studio sidebarWidth={clampSidebar(Number(width))} />
}
