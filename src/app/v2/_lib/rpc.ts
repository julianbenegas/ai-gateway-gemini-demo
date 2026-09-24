import type { z } from 'zod'
import { rpc, unwrap } from '@/lib/rpc'
import type { Api } from '../_server/api'
import type { editSchema } from './tools'
import type { SiteAnnotation } from './types'

const api = rpc<Api>().v2.api

const design = (id: string | null) => {
  if (!id) throw new Error('Create a design to save changes.')
  return api.designs({ id })
}

/** Typed calls to this example's API. */
export const studioApi = {
  designs: () => unwrap(api.designs.get()),
  site: (id: string | null) =>
    unwrap(id ? api.designs({ id }).get() : api.starter.get()),
  createDesign: () => unwrap(api.designs.post()),
  editSite: (
    id: string | null,
    edit: z.infer<typeof editSchema>,
    signal?: AbortSignal,
  ) => unwrap(design(id).patch(edit, { fetch: { signal } })),
  saveAnnotation: (id: string | null, annotation: SiteAnnotation) =>
    unwrap(design(id).annotations.post(annotation)),
  deleteAnnotation: (id: string | null, annotationId: string) =>
    unwrap(design(id).annotations({ annotationId }).delete()),
}
