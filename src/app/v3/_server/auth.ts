import { HttpError } from '@/lib/api'
import { anonymousOwner } from '@/lib/owner'

export const owner = anonymousOwner({ cookie: 'margin_v3_owner', path: '/v3' })

/** The browser's owner id, or 401 if it has no apps yet. */
export async function requireOwner() {
  const id = await owner.read()
  if (!id) throw new HttpError({ message: 'Create an app first.', status: 401 })
  return id
}
