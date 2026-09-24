import 'server-only'
import { randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'

/** Anonymous per-browser owner. The cookie is the only access control. */
const COOKIE = 'margin_owner'

export async function readOwner() {
  const value = (await cookies()).get(COOKIE)?.value
  return value && /^[a-f0-9]{36}$/.test(value) ? value : null
}

/** Returns the owner, creating it if needed. Only callable from route handlers. */
export async function ensureOwner() {
  const owner = (await readOwner()) ?? randomBytes(18).toString('hex')
  ;(await cookies()).set(COOKIE, owner, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 365 * 24 * 60 * 60,
  })
  return owner
}
