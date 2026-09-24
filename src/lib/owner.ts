import 'server-only'
import { randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'

/**
 * Anonymous per-browser identity kept in an HttpOnly cookie. The cookie is the
 * only access control; each example picks its own name and path.
 */
export function anonymousOwner(name: string, path: string) {
  const read = async () => {
    const value = (await cookies()).get(name)?.value
    return value && /^[a-f0-9]{36}$/.test(value) ? value : null
  }
  /** Returns the owner, creating it if needed. Only from route handlers. */
  const ensure = async () => {
    const owner = (await read()) ?? randomBytes(18).toString('hex')
    ;(await cookies()).set(name, owner, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path,
      maxAge: 365 * 24 * 60 * 60,
    })
    return owner
  }
  return { read, ensure }
}
