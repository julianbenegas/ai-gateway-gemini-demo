'use server'

import { redirect } from 'next/navigation'
import { owner } from './auth'
import { createDesign } from './store'

/**
 * Creates a design and opens it. A server action, so the button works before
 * the page hydrates; Next.js checks the request's origin.
 */
export async function createDesignAction() {
  const design = await createDesign({ owner: await owner.ensure() })
  redirect(`/v2/${design.id}`)
}
