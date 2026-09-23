import 'server-only'
import { Redis } from '@upstash/redis'
import type { WorkspaceData } from './filesystem.mjs'

let client: Redis | undefined

export function workspaceRedis() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
  const token =
    process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token)
    throw new Error('Connect an Upstash Redis database to this project.')
  return (client ??= new Redis({ url, token }))
}

export const workspaceKey = (owner: string, id: string) =>
  `margin:v2:site:${owner}:${id}`
export const designsKey = (owner: string) => `margin:v2:designs:${owner}`
export const cancellationKey = (
  owner: string,
  id: string,
  executionId: string,
) => `margin:v2:cancel:${owner}:${id}:${executionId}`

const update = `
if #KEYS > 1 and redis.call('EXISTS', KEYS[2]) == 1 then return nil end
local current = redis.call('GET', KEYS[1])
if not current then return nil end
local state = cjson.decode(current)
local changes = cjson.decode(ARGV[1])
for path, entry in pairs(changes.writes) do state.files[path] = entry end
for _, path in ipairs(changes.deletes) do state.files[path] = nil end
local result = cjson.encode(state)
redis.call('SET', KEYS[1], result)
return result
`

export async function saveChanges(
  owner: string,
  id: string,
  changes: { writes: WorkspaceData['files']; deletes: string[] },
  executionId?: string,
) {
  return workspaceRedis().eval<[string], WorkspaceData | null>(
    update,
    executionId
      ? [workspaceKey(owner, id), cancellationKey(owner, id, executionId)]
      : [workspaceKey(owner, id)],
    [JSON.stringify(changes)],
  )
}
