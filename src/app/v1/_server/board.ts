import 'server-only'
import type { TLEditorSnapshot } from 'tldraw'
import { z } from 'zod'
import { redis } from '@/lib/redis'
import { owner } from './auth'

/** One tldraw snapshot (document and session) per browser owner. */
const boardKey = (owner: string) => `margin:v1:board:${owner}`

export const snapshotSchema = z.object({
  document: z.object({
    store: z.record(z.string(), z.unknown()),
    schema: z.unknown(),
  }),
  session: z.unknown().optional(),
})

export async function loadBoard(): Promise<TLEditorSnapshot | null> {
  const id = await owner.read()
  return id ? redis().get<TLEditorSnapshot>(boardKey(id)) : null
}

export async function saveBoard(snapshot: z.infer<typeof snapshotSchema>) {
  await redis().set(boardKey(await owner.ensure()), snapshot)
}
