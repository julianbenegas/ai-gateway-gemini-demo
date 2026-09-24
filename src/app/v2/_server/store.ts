import 'server-only'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { HttpError } from '@/lib/api'
import { redis } from '@/lib/redis'
import { applyReplacements, type Replacement } from '@/lib/replacements'
import { HOME, type SiteFiles } from '../_lib/files'
import { annotationSchema, type ServerTool } from '../_lib/tools'
import type { Design, SiteAnnotation, SiteDocument } from '../_lib/types'
import { BLANK_DESIGN_HTML, prepareFile } from './html'

/**
 * One Redis hash per design with `files` and `annotations` fields, so saving a
 * note never overwrites a concurrent page edit. File edits are last-write-wins.
 * Every agent edit pushes the file's previous content onto a history list for
 * undo. The preview's sandbox gets a copy of the files; see preview.ts.
 */
export type DesignRef = { owner: string; id: string }

const designKey = ({ owner, id }: DesignRef) =>
  `margin:v2:design:${owner}:${id}`
const historyKey = ({ owner, id }: DesignRef) =>
  `margin:v2:history:${owner}:${id}`
const designsKey = (owner: string) => `margin:v2:designs:${owner}`
const HISTORY_LIMIT = 50
const MAX_FILES = 40
const MAX_FILE_BYTES = 200_000

type HistoryEntry = {
  path: string
  /** What the file held before the edit; null if the edit created it. */
  content: string | null
  tool: ServerTool
  callId: string
  at: number
}
// Designs used to be a single page, stored as `html`.
type LegacyEntry = { html: string }

const siteFiles = z.record(z.string(), z.string())

export async function readDesign(ref: DesignRef): Promise<SiteDocument> {
  const [fields, agentEdits] = await Promise.all([
    redis().hmget<{ files: unknown; html: unknown; annotations: unknown }>(
      designKey(ref),
      'files',
      'html',
      'annotations',
    ),
    redis().llen(historyKey(ref)),
  ])
  const files =
    siteFiles.safeParse(fields?.files).data ??
    (typeof fields?.html === 'string' ? { [HOME]: fields.html } : null)
  if (!files)
    throw new HttpError({
      message: 'This design could not be found.',
      status: 404,
    })
  const annotations = annotationSchema.array().safeParse(fields?.annotations)
  return {
    id: ref.id,
    files,
    annotations: annotations.success ? annotations.data : [],
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

export async function createDesign({ owner }: { owner: string }) {
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
      files: { [HOME]: BLANK_DESIGN_HTML },
      annotations: [],
    })
    .hset(designsKey(owner), { [id]: design })
    .exec()
  return design
}

export async function renameDesign({
  owner,
  id,
  name,
}: DesignRef & { name: string }) {
  const designs = await redis().hmget<Record<string, Design>>(
    designsKey(owner),
    id,
  )
  const design = designs?.[id]
  if (!design)
    throw new HttpError({
      message: 'This design could not be found.',
      status: 404,
    })
  const renamed = { ...design, name }
  await redis().hset(designsKey(owner), { [id]: renamed })
  return renamed
}

/** Copies a design's files and notes into a new design; history stays behind. */
export async function duplicateDesign(ref: DesignRef) {
  const [site, designs] = await Promise.all([
    readDesign(ref),
    redis().hmget<Record<string, Design>>(designsKey(ref.owner), ref.id),
  ])
  const copy: Design = {
    id: randomUUID(),
    name: `${designs?.[ref.id]?.name ?? 'Design'} copy`,
    createdAt: Date.now(),
  }
  await redis()
    .multi()
    .hset(designKey({ owner: ref.owner, id: copy.id }), {
      files: site.files,
      annotations: site.annotations,
    })
    .hset(designsKey(ref.owner), { [copy.id]: copy })
    .exec()
  return copy
}

/** Deletes a design with its notes and edit history. Not undoable. */
export async function deleteDesign(ref: DesignRef) {
  await readDesign(ref)
  await redis()
    .multi()
    .del(designKey(ref), historyKey(ref))
    .hdel(designsKey(ref.owner), ref.id)
    .exec()
  return { ok: true }
}

export type FileEdit =
  | { path: string; replacements: Replacement[] }
  | { path: string; content: string }
  | { path: string; delete: true }

/** The file's content after an edit, or null when the edit deletes it. */
function applyEdit({ edit, current }: { edit: FileEdit; current?: string }) {
  if ('delete' in edit) {
    if (edit.path === HOME)
      throw new HttpError({
        message: `${HOME} is the home page, so it stays; rewrite it instead.`,
        status: 400,
      })
    if (current === undefined)
      throw new HttpError({
        message: `There is no ${edit.path}.`,
        status: 404,
      })
    return { content: null }
  }
  if ('content' in edit)
    return { content: prepareFile({ path: edit.path, content: edit.content }) }
  if (current === undefined)
    throw new HttpError({
      message: `There is no ${edit.path}. Create it with write_file.`,
      status: 404,
    })
  const result = applyReplacements({
    html: current,
    replacements: edit.replacements,
  })
  return {
    content: prepareFile({ path: edit.path, content: result.html }),
    matches: result.matches,
  }
}

/** Applies an agent edit to one file, keeping its previous content for undo. */
export async function editDesign({
  ref,
  edit,
  tool,
  callId,
}: {
  ref: DesignRef
  edit: FileEdit
  tool: ServerTool
  callId: string
}) {
  const site = await readDesign(ref)
  const previous = Object.hasOwn(site.files, edit.path)
    ? site.files[edit.path]
    : undefined
  const { content, matches } = applyEdit({ edit, current: previous })
  const files: SiteFiles = { ...site.files }
  if (content === null) delete files[edit.path]
  else files[edit.path] = content
  if (content !== null && Buffer.byteLength(content) > MAX_FILE_BYTES)
    throw new HttpError({
      message: `${edit.path} is too large. Keep each file under 200 KB.`,
      status: 413,
    })
  if (Object.keys(files).length > MAX_FILES)
    throw new HttpError({
      message: `A design holds up to ${MAX_FILES} files.`,
      status: 413,
    })
  let { agentEdits } = site
  if (content !== (previous ?? null)) {
    const entry: HistoryEntry = {
      path: edit.path,
      content: previous ?? null,
      tool,
      callId,
      at: Date.now(),
    }
    const [, , , length] = await redis()
      .multi()
      .hset(designKey(ref), { files })
      .lpush(historyKey(ref), entry)
      .ltrim(historyKey(ref), 0, HISTORY_LIMIT - 1)
      .llen(historyKey(ref))
      .exec<[number, number, 'OK', number]>()
    agentEdits = length
  }
  return {
    site: { ...site, files, agentEdits },
    matches,
    missed: !!matches?.includes(0),
  }
}

/** Restores the file the most recent agent edit changed. */
export async function undoAgentEdit(ref: DesignRef) {
  const entry = await redis().lpop<HistoryEntry | LegacyEntry>(historyKey(ref))
  if (!entry)
    throw new HttpError({
      message: 'There is no agent edit to undo.',
      status: 404,
    })
  const { path, content } =
    'html' in entry ? { path: HOME, content: entry.html } : entry
  const files: SiteFiles = { ...(await readDesign(ref)).files }
  if (content === null) delete files[path]
  else files[path] = content
  await redis().hset(designKey(ref), { files })
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
