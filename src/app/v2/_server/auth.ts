import { HttpError } from '@/lib/api'
import { anonymousOwner } from '@/lib/owner'

export const owner = anonymousOwner({ cookie: 'margin_v2_owner', path: '/v2' })

/** The browser's owner id, or 401 if it has no designs yet. */
export async function requireOwner() {
  const id = await owner.read()
  if (!id)
    throw new HttpError({
      message: 'Create a design to save changes.',
      status: 401,
    })
  return id
}
