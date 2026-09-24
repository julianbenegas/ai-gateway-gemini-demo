import { treaty } from '@elysiajs/eden'
import type { AnyElysia } from 'elysia'

/** A typed browser client for an example's Elysia API. */
export const rpc = <App extends AnyElysia>() =>
  treaty<App>(
    // Only ever called in the browser; the fallback keeps SSR imports safe.
    typeof window === 'undefined' ? 'http://localhost' : window.location.origin,
  )

/** Resolves an Eden call to its data, throwing the API's error message. */
export async function unwrap<T>(
  call: Promise<
    { data: T; error: null } | { data: null; error: { value: unknown } }
  >,
): Promise<T> {
  const { data, error } = await call
  if (!error) return data
  const value = error.value as { error?: unknown } | undefined
  throw new Error(
    typeof value?.error === 'string' ? value.error : 'Request failed',
  )
}
