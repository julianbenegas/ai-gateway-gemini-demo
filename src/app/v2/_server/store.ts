import 'server-only'
import { randomUUID } from 'node:crypto'
import type { z } from 'zod'
import { HttpError } from '@/lib/api'
import { redis } from '@/lib/redis'
import { applyReplacements } from '@/lib/replacements'
import { annotationSchema, type editSchema } from '../_lib/tools'
import type { Design, SiteAnnotation, SiteDocument } from '../_lib/types'
import { owner } from './auth'
import { prepareHtml, STUDIO_STARTER_HTML } from './html'

/**
 * One Redis hash per design with `html` and `annotations` fields, so saving a
 * note never overwrites a concurrent page edit. Page edits are last-write-wins.
 */
const designKey = (owner: string, id: string) =>
  `margin:v2:design:${owner}:${id}`
const designsKey = (owner: string) => `margin:v2:designs:${owner}`

export const starterSite = (): SiteDocument => ({
  id: null,
  html: STUDIO_STARTER_HTML,
  annotations: [],
  persisted: false,
})

async function openDesign(id: string) {
  const current = await owner.read()
  if (!current) throw new HttpError('Create a design to save changes.', 401)
  const key = designKey(current, id)
  const fields = await redis().hmget<{ html: unknown; annotations: unknown }>(
    key,
    'html',
    'annotations',
  )
  if (typeof fields?.html !== 'string')
    throw new HttpError('This design could not be found.', 404)
  const annotations = annotationSchema.array().safeParse(fields.annotations)
  return {
    key,
    site: {
      id,
      html: fields.html,
      annotations: annotations.success ? annotations.data : [],
      persisted: true,
    } satisfies SiteDocument,
  }
}

export async function listDesigns(): Promise<Design[]> {
  const current = await owner.read()
  if (!current) return []
  const designs = await redis().hgetall<Record<string, Design>>(
    designsKey(current),
  )
  return Object.values(designs ?? {}).sort((a, b) => a.createdAt - b.createdAt)
}

export const readDesign = async (id: string) => (await openDesign(id)).site

export async function createDesign(): Promise<SiteDocument> {
  const current = await owner.ensure()
  const id = randomUUID()
  const count = await redis().hlen(designsKey(current))
  const design: Design = {
    id,
    name: `Design ${count + 1}`,
    createdAt: Date.now(),
  }
  await redis()
    .multi()
    .hset(designKey(current, id), {
      html: STUDIO_STARTER_HTML,
      annotations: [],
    })
    .hset(designsKey(current), { [id]: design })
    .exec()
  return { ...starterSite(), id, persisted: true }
}

export async function editDesign(id: string, edit: z.infer<typeof editSchema>) {
  const { key, site } = await openDesign(id)
  const result =
    'html' in edit
      ? { html: edit.html, matches: undefined }
      : applyReplacements(site.html, edit.replacements)
  const html = prepareHtml(result.html)
  if (html !== site.html) await redis().hset(key, { html })
  return {
    site: { ...site, html },
    matches: result.matches,
    missed: !!result.matches?.includes(0),
  }
}

async function updateAnnotations(
  id: string,
  update: (annotations: SiteAnnotation[]) => SiteAnnotation[],
) {
  const { key, site } = await openDesign(id)
  const annotations = update(site.annotations)
  await redis().hset(key, { annotations })
  return annotations
}

export const saveAnnotation = (id: string, annotation: SiteAnnotation) =>
  updateAnnotations(id, (annotations) => [
    ...annotations.filter((note) => note.id !== annotation.id),
    annotation,
  ])

export const removeAnnotation = (id: string, annotationId: string) =>
  updateAnnotations(id, (annotations) =>
    annotations.filter((note) => note.id !== annotationId),
  )
