import 'server-only'
import { randomUUID } from 'node:crypto'
import { HttpError } from '@/lib/api'
import { redis } from '@/lib/redis'
import { applyReplacements, type Replacement } from '@/lib/replacements'
import { annotationSchema, type ServerTool } from '../_lib/tools'
import type { Design, SiteAnnotation, SiteDocument } from '../_lib/types'
import { prepareHtml, STUDIO_STARTER_HTML } from './html'

/**
 * One Redis hash per design with `html` and `annotations` fields, so saving a
 * note never overwrites a concurrent page edit. Page edits are last-write-wins.
 * Every agent edit pushes the previous HTML onto a history list for undo.
 */
export type DesignRef = { owner: string; id: string }

const designKey = ({ owner, id }: DesignRef) =>
  `margin:v2:design:${owner}:${id}`
const historyKey = ({ owner, id }: DesignRef) =>
  `margin:v2:history:${owner}:${id}`
const designsKey = (owner: string) => `margin:v2:designs:${owner}`
const HISTORY_LIMIT = 50

type HistoryEntry = {
  html: string
  tool: ServerTool
  callId: string
  at: number
}

export const starterSite = (): SiteDocument => ({
  id: null,
  html: STUDIO_STARTER_HTML,
  annotations: [],
  persisted: false,
  agentEdits: 0,
})

export async function readDesign(ref: DesignRef): Promise<SiteDocument> {
  const [fields, agentEdits] = await Promise.all([
    redis().hmget<{ html: unknown; annotations: unknown }>(
      designKey(ref),
      'html',
      'annotations',
    ),
    redis().llen(historyKey(ref)),
  ])
  if (typeof fields?.html !== 'string')
    throw new HttpError({
      message: 'This design could not be found.',
      status: 404,
    })
  const annotations = annotationSchema.array().safeParse(fields.annotations)
  return {
    id: ref.id,
    html: fields.html,
    annotations: annotations.success ? annotations.data : [],
    persisted: true,
    agentEdits,
  }
}

export async function listDesigns({ owner }: { owner: string | null }) {
  if (!owner) return []
  const designs = await redis().hgetall<Record<string, Design>>(
    designsKey(owner),
  )
  return Object.values(designs ?? {}).sort((a, b) => a.createdAt - b.createdAt)
}

export async function createDesign({
  owner,
}: {
  owner: string
}): Promise<SiteDocument> {
  const id = randomUUID()
  const count = await redis().hlen(designsKey(owner))
  const design: Design = {
    id,
    name: `Design ${count + 1}`,
    createdAt: Date.now(),
  }
  await redis()
    .multi()
    .hset(designKey({ owner, id }), {
      html: STUDIO_STARTER_HTML,
      annotations: [],
    })
    .hset(designsKey(owner), { [id]: design })
    .exec()
  return { ...starterSite(), id, persisted: true }
}

/** Applies an agent edit, keeping the previous HTML for undo. */
export async function editDesign({
  ref,
  edit,
  tool,
  callId,
}: {
  ref: DesignRef
  edit: { replacements: Replacement[] } | { html: string }
  tool: ServerTool
  callId: string
}) {
  const site = await readDesign(ref)
  const result =
    'html' in edit
      ? { html: edit.html, matches: undefined }
      : applyReplacements({ html: site.html, replacements: edit.replacements })
  const html = prepareHtml({ html: result.html })
  let { agentEdits } = site
  if (html !== site.html) {
    const entry: HistoryEntry = {
      html: site.html,
      tool,
      callId,
      at: Date.now(),
    }
    const [, , , length] = await redis()
      .multi()
      .hset(designKey(ref), { html })
      .lpush(historyKey(ref), entry)
      .ltrim(historyKey(ref), 0, HISTORY_LIMIT - 1)
      .llen(historyKey(ref))
      .exec<[number, number, 'OK', number]>()
    agentEdits = length
  }
  return {
    site: { ...site, html, agentEdits },
    matches: result.matches,
    missed: !!result.matches?.includes(0),
  }
}

/** Restores the HTML from before the most recent agent edit. */
export async function undoAgentEdit(ref: DesignRef) {
  const entry = await redis().lpop<HistoryEntry>(historyKey(ref))
  if (!entry)
    throw new HttpError({
      message: 'There is no agent edit to undo.',
      status: 404,
    })
  await redis().hset(designKey(ref), { html: entry.html })
  return readDesign(ref)
}

async function updateAnnotations({
  ref,
  update,
}: {
  ref: DesignRef
  update: (annotations: SiteAnnotation[]) => SiteAnnotation[]
}) {
  const site = await readDesign(ref)
  const annotations = update(site.annotations)
  await redis().hset(designKey(ref), { annotations })
  return annotations
}

export const saveAnnotation = ({
  ref,
  annotation,
}: {
  ref: DesignRef
  annotation: SiteAnnotation
}) =>
  updateAnnotations({
    ref,
    update: (annotations) => [
      ...annotations.filter((note) => note.id !== annotation.id),
      annotation,
    ],
  })

export const removeAnnotation = ({
  ref,
  annotationId,
}: {
  ref: DesignRef
  annotationId: string
}) =>
  updateAnnotations({
    ref,
    update: (annotations) =>
      annotations.filter((note) => note.id !== annotationId),
  })
