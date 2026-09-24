import 'server-only'
import { Redis } from '@upstash/redis'

const url = () =>
  process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
const token = () =>
  process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN

/**
 * Tests (MARGIN_STORE=memory) and local development without Redis use an
 * in-memory store. Production always requires Redis.
 */
const inMemory = () =>
  process.env.NODE_ENV !== 'production' &&
  (process.env.MARGIN_STORE === 'memory' || !(url() && token()))

let client: Redis | undefined
const globals = globalThis as { marginMemoryRedis?: MemoryRedis }

export function redis(): Redis {
  if (inMemory())
    // Only the calls this app makes; see MemoryRedis.
    return (globals.marginMemoryRedis ??= new MemoryRedis()) as never
  if (!url() || !token())
    throw new Error('Connect an Upstash Redis database to this project.')
  return (client ??= new Redis({ url: url()!, token: token()! }))
}

// Like Upstash: objects are stored as JSON and parsed back when read.
const encode = (value: unknown) =>
  typeof value === 'string' ? value : JSON.stringify(value)
const decode = (value: string | undefined) => {
  if (value === undefined) return null
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

/** A stand-in for the Upstash commands this app uses. */
class MemoryRedis {
  private strings = new Map<string, { value: string; expires?: number }>()
  private hashes = new Map<string, Map<string, string>>()
  private lists = new Map<string, string[]>()

  async get(key: string) {
    const entry = this.strings.get(key)
    if (entry?.expires && entry.expires < Date.now()) this.strings.delete(key)
    return decode(this.strings.get(key)?.value)
  }
  async set(key: string, value: unknown, options?: { ex?: number }) {
    this.strings.set(key, {
      value: encode(value),
      expires: options?.ex ? Date.now() + options.ex * 1000 : undefined,
    })
    return 'OK'
  }
  async del(...keys: string[]) {
    return keys.filter(
      (key) =>
        this.strings.delete(key) ||
        this.hashes.delete(key) ||
        this.lists.delete(key),
    ).length
  }
  async hset(key: string, fields: Record<string, unknown>) {
    const hash = this.hashes.get(key) ?? new Map()
    this.hashes.set(key, hash)
    for (const [field, value] of Object.entries(fields))
      hash.set(field, encode(value))
    return Object.keys(fields).length
  }
  async hmget(key: string, ...fields: string[]) {
    const hash = this.hashes.get(key)
    if (!hash || fields.every((field) => !hash.has(field))) return null
    return Object.fromEntries(
      fields.map((field) => [field, decode(hash.get(field))]),
    )
  }
  async hgetall(key: string) {
    const hash = this.hashes.get(key)
    if (!hash?.size) return null
    return Object.fromEntries(
      [...hash].map(([field, value]) => [field, decode(value)]),
    )
  }
  async hlen(key: string) {
    return this.hashes.get(key)?.size ?? 0
  }
  async lpush(key: string, ...values: unknown[]) {
    const list = this.lists.get(key) ?? []
    list.unshift(...values.map(encode).reverse())
    this.lists.set(key, list)
    return list.length
  }
  async ltrim(key: string, start: number, stop: number) {
    const list = this.lists.get(key) ?? []
    this.lists.set(key, list.slice(start, stop + 1))
    return 'OK'
  }
  async llen(key: string) {
    return this.lists.get(key)?.length ?? 0
  }
  async lpop(key: string) {
    return decode(this.lists.get(key)?.shift())
  }
  multi() {
    const queued: (() => Promise<unknown>)[] = []
    const transaction = {
      hset: (...args: Parameters<MemoryRedis['hset']>) =>
        queue(() => this.hset(...args)),
      lpush: (...args: Parameters<MemoryRedis['lpush']>) =>
        queue(() => this.lpush(...args)),
      ltrim: (...args: Parameters<MemoryRedis['ltrim']>) =>
        queue(() => this.ltrim(...args)),
      llen: (...args: Parameters<MemoryRedis['llen']>) =>
        queue(() => this.llen(...args)),
      exec: async () => {
        const results = []
        for (const run of queued) results.push(await run())
        return results
      },
    }
    const queue = (run: () => Promise<unknown>) => {
      queued.push(run)
      return transaction
    }
    return transaction
  }
}
