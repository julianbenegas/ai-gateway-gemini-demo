'use server'

import { redirect } from 'next/navigation'
import { createApp } from './apps'
import { owner } from './auth'

/** Creates an app and opens it; works before the page hydrates. */
export async function createAppAction() {
  const app = await createApp({ owner: await owner.ensure() })
  redirect(`/v3/${app.id}`)
}
