import 'server-only'
import { randomUUID } from 'node:crypto'
import { z, ZodError } from 'zod'
import { ensureOwner, readOwner } from '@/lib/owner'
import { redis } from '@/lib/redis'
import { applyReplacements } from '@/lib/replacements'
import { annotationSchema, editSchema } from '../tools'
import type { Design, SiteAnnotation, SiteDocument } from '../types'
import { prepareHtml, STUDIO_STARTER_HTML } from './html'

/**
 * One Redis hash per design with `html` and `annotations` fields, so saving a
 * note never overwrites a concurrent page edit. Page edits are last-write-wins.
 */
const designKey = (owner: string, id: string) =>
  `margin:studio:design:${owner}:${id}`
const designsKey = (owner: string) => `margin:studio:designs:${owner}`

export class StudioError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message)
  }
}

async function openDesign(request: Request) {
  const owner = await readOwner()
  if (!owner) throw new StudioError('Create a design to save changes.', 401)
  const id = z.uuid().parse(new URL(request.url).searchParams.get('designId'))
  const key = designKey(owner, id)
  const fields = await redis().hmget<{ html: unknown; annotations: unknown }>(
    key,
    'html',
    'annotations',
  )
  if (typeof fields?.html !== 'string')
    throw new StudioError('This design could not be found.', 404)
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
  const owner = await readOwner()
  if (!owner) return []
  const designs = await redis().hgetall<Record<string, Design>>(
    designsKey(owner),
  )
  return Object.values(designs ?? {}).sort((a, b) => a.createdAt - b.createdAt)
}

export async function readSite(request: Request): Promise<SiteDocument> {
  if (!new URL(request.url).searchParams.has('designId'))
    return {
      id: null,
      html: STUDIO_STARTER_HTML,
      annotations: [],
      persisted: false,
    }
  return (await openDesign(request)).site
}

export async function createDesign(): Promise<SiteDocument> {
  const owner = await ensureOwner()
  const id = randomUUID()
  const count = await redis().hlen(designsKey(owner))
  const design: Design = {
    id,
    name: `Design ${count + 1}`,
    createdAt: Date.now(),
  }
  await redis()
    .multi()
    .hset(designKey(owner, id), { html: STUDIO_STARTER_HTML, annotations: [] })
    .hset(designsKey(owner), { [id]: design })
    .exec()
  return {
    id,
    html: STUDIO_STARTER_HTML,
    annotations: [],
    persisted: true,
  }
}

export async function editSite(request: Request) {
  const input = editSchema.parse(await request.json())
  const { key, site } = await openDesign(request)
  const edit =
    'html' in input
      ? { html: input.html, matches: undefined }
      : applyReplacements(site.html, input.replacements)
  const html = prepareHtml(edit.html)
  if (html !== site.html) await redis().hset(key, { html })
  return {
    site: { ...site, html },
    matches: edit.matches,
    missed: !!edit.matches?.includes(0),
  }
}

async function updateAnnotations(
  request: Request,
  update: (annotations: SiteAnnotation[]) => SiteAnnotation[],
) {
  const { key, site } = await openDesign(request)
  const annotations = update(site.annotations)
  await redis().hset(key, { annotations })
  return annotations
}

export const saveAnnotation = (request: Request, annotation: SiteAnnotation) =>
  updateAnnotations(request, (annotations) => [
    ...annotations.filter((note) => note.id !== annotation.id),
    annotation,
  ])

export const removeAnnotation = (request: Request, id: string) =>
  updateAnnotations(request, (annotations) =>
    annotations.filter((note) => note.id !== id),
  )

export function studioFailure(error: unknown) {
  if (error instanceof ZodError || error instanceof SyntaxError)
    return Response.json({ error: 'Invalid request data.' }, { status: 400 })
  if (error instanceof StudioError)
    return Response.json({ error: error.message }, { status: error.status })
  console.error(
    'Studio request failed:',
    error instanceof Error ? error.message : 'Unknown error',
  )
  return Response.json(
    { error: 'The studio could not complete this request. Please try again.' },
    { status: 503 },
  )
}
