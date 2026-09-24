import 'server-only'
import { Redis } from '@upstash/redis'

const url = () =>
  process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
const token = () =>
  process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN

export const isRedisConfigured = () => Boolean(url() && token())

let client: Redis | undefined
export function redis() {
  if (!isRedisConfigured())
    throw new Error('Connect an Upstash Redis database to this project.')
  return (client ??= new Redis({ url: url()!, token: token()! }))
}
