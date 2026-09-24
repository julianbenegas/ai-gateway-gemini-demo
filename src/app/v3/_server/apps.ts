import 'server-only'
import { randomUUID } from 'node:crypto'
import { HttpError } from '@/lib/api'
import { redis } from '@/lib/redis'
import type { App } from '../_lib/types'
import { deleteDesktop } from './desktop'

export type AppRef = { owner: string; id: string }

const appsKey = (owner: string) => `margin:v3:apps:${owner}`

export async function listApps({ owner }: { owner: string | null }) {
  if (!owner) return []
  const apps = await redis().hgetall<Record<string, App>>(appsKey(owner))
  return Object.values(apps ?? {}).sort((a, b) => a.createdAt - b.createdAt)
}

export async function ownsApp({ owner, id }: AppRef) {
  return !!(await redis().hmget<Record<string, App>>(appsKey(owner), id))?.[id]
}

async function readApp({ owner, id }: AppRef) {
  const app = (await redis().hmget<Record<string, App>>(appsKey(owner), id))?.[
    id
  ]
  if (!app)
    throw new HttpError({
      message: 'This app could not be found.',
      status: 404,
    })
  return app
}

export async function createApp({ owner }: { owner: string }) {
  const count = await redis().hlen(appsKey(owner))
  const app: App = {
    id: randomUUID(),
    name: `App ${count + 1}`,
    createdAt: Date.now(),
  }
  await redis().hset(appsKey(owner), { [app.id]: app })
  return app
}

export async function renameApp({
  owner,
  id,
  name,
}: AppRef & { name: string }) {
  const app = { ...(await readApp({ owner, id })), name }
  await redis().hset(appsKey(owner), { [id]: app })
  return app
}

/** Deletes the app and its desktop. The conversation log stays in a2. */
export async function deleteApp(ref: AppRef) {
  await readApp(ref)
  await deleteDesktop({ appId: ref.id })
  await redis().hdel(appsKey(ref.owner), ref.id)
  return { ok: true }
}
