import 'server-only'
import { Elysia } from 'elysia'

type ErrorStatus = 400 | 401 | 403 | 404 | 413 | 503

/** An error with an HTTP status whose message is safe to show the client. */
export class HttpError extends Error {
  // Literal statuses keep Eden from typing errors as successful responses.
  status: ErrorStatus
  constructor({ message, status }: { message: string; status: ErrorStatus }) {
    super(message)
    this.status = status
  }
}

/** Same-origin check for state-changing requests from the browser. */
export function checkOrigin(request: Request) {
  const origin = request.headers.get('origin')
  const host = request.headers.get('host')
  if (!origin || !host) return false
  try {
    const url = new URL(origin)
    return ['http:', 'https:'].includes(url.protocol) && url.host === host
  } catch {
    return false
  }
}

/**
 * Shared behavior for each example's Elysia API: rejects cross-origin writes,
 * never caches, and turns errors into `{ error }` responses.
 *
 * Declare route handlers `async`: Elysia only routes a rejected promise to
 * `onError` when the handler itself is an async function.
 */
export const apiDefaults = new Elysia({ name: 'margin/api-defaults' })
  .onRequest(({ request, status }) => {
    if (request.method !== 'GET' && !checkOrigin(request))
      return status(403, { error: 'Invalid request origin' })
  })
  .onAfterHandle({ as: 'global' }, ({ set }) => {
    set.headers['cache-control'] = 'no-store'
  })
  .onError({ as: 'global' }, ({ code, error, status }) => {
    if (code === 'VALIDATION' || code === 'PARSE')
      return status(400, { error: 'Invalid request data.' })
    if (code === 'NOT_FOUND') return status(404, { error: 'Not found.' })
    if (error instanceof HttpError)
      return status(error.status, { error: error.message })
    console.error(
      'API request failed:',
      error instanceof Error ? error.message : 'Unknown error',
    )
    return status(503, {
      error: 'The request could not be completed. Please try again.',
    })
  })
