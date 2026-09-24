import 'server-only'
import type { TLEditorSnapshot } from 'tldraw'
import { z } from 'zod'
import { ensureOwner, readOwner } from '@/lib/owner'
import { isRedisConfigured, redis } from '@/lib/redis'

/** One tldraw snapshot (document and session) per browser owner. */
const boardKey = (owner: string) => `margin:canvas:board:${owner}`

// Boards stay in server memory for tests (MARGIN_STORE=memory) and for local
// development without Redis. Production always requires Redis.
const globals = globalThis as { marginBoards?: Map<string, string> }
const memory = (globals.marginBoards ??= new Map())
const inMemory = () =>
  process.env.NODE_ENV !== 'production' &&
  (process.env.MARGIN_STORE === 'memory' || !isRedisConfigured())

const snapshotSchema = z.object({
  document: z.object({
    store: z.record(z.string(), z.unknown()),
    schema: z.unknown(),
  }),
  session: z.unknown().optional(),
})

export async function loadBoard(): Promise<TLEditorSnapshot | null> {
  const owner = await readOwner()
  if (!owner) return null
  const key = boardKey(owner)
  if (inMemory()) {
    const saved = memory.get(key)
    return saved ? JSON.parse(saved) : null
  }
  return redis().get<TLEditorSnapshot>(key)
}

export async function saveBoard(request: Request) {
  const snapshot = snapshotSchema.parse(await request.json())
  const key = boardKey(await ensureOwner())
  if (inMemory()) memory.set(key, JSON.stringify(snapshot))
  else await redis().set(key, snapshot)
}
