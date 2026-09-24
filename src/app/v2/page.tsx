import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { clampSidebar, sidebarCookie } from '@/ui/sidebar'
import { Studio } from './_components/studio'

export const metadata: Metadata = { title: 'Margin / v2' }

export default async function Page() {
  const width = (await cookies()).get(sidebarCookie.v2)?.value
  return <Studio sidebarWidth={clampSidebar(Number(width))} />
}
