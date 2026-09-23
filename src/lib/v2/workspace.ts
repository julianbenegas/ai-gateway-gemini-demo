import 'server-only'
import { randomBytes, randomUUID } from 'node:crypto'
import { cookies } from 'next/headers'
import { executeBash } from './execute-bash'
import { z, ZodError } from 'zod'
import { V2_STARTER_HTML, prepareHtml } from './html'
import { annotationSchema, bashSchema } from './tools'
import {
  changedFiles,
  HTML,
  NOTES,
  restoreFiles,
  ROOT,
  snapshotFiles,
  type WorkspaceData,
} from './filesystem.mjs'
import {
  cancellationKey,
  designsKey,
  saveChanges,
  workspaceKey,
  workspaceRedis,
} from './redis'
import type { Design, SiteAnnotation, SiteDocument } from './types'

const COOKIE = 'margin_v2_owner'
const executionSchema = z.object({ executionId: z.uuid() })
type Workspace = { owner: string; id: string; data: WorkspaceData }

export class WorkspaceError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message)
  }
}

async function ownerId() {
  const value = (await cookies()).get(COOKIE)?.value
  return value && /^[a-f0-9]{36}$/.test(value) ? value : null
}

export async function getWorkspace(request: Request): Promise<Workspace> {
  const owner = await ownerId()
  if (!owner) throw new WorkspaceError('Create a design to save changes.', 401)
  const id = z.uuid().parse(new URL(request.url).searchParams.get('designId'))
  const data = await workspaceRedis().get<WorkspaceData>(
    workspaceKey(owner, id),
  )
  if (!data) throw new WorkspaceError('This design could not be found.', 404)
  return { owner, id, data }
}

export async function listDesigns(): Promise<Design[]> {
  const owner = await ownerId()
  if (!owner) return []
  const designs = await workspaceRedis().hgetall<Record<string, Design>>(
    designsKey(owner),
  )
  return Object.values(designs ?? {}).sort((a, b) => a.createdAt - b.createdAt)
}

export async function startWorkspace() {
  const owner = (await ownerId()) ?? randomBytes(18).toString('hex')
  const id = randomUUID()
  const count = await workspaceRedis().hlen(designsKey(owner))
  const design: Design = {
    id,
    name: `Design ${count + 1}`,
    createdAt: Date.now(),
  }
  const data: WorkspaceData = {
    files: {
      [HTML]: { type: 'file', content: V2_STARTER_HTML, mode: 0o644 },
      [NOTES]: { type: 'file', content: '[]', mode: 0o644 },
      [ROOT]: { type: 'directory', mode: 0o755 },
    },
  }
  await workspaceRedis()
    .multi()
    .set(workspaceKey(owner, id), data)
    .hset(designsKey(owner), { [id]: design })
    .exec()
  ;(await cookies()).set(COOKIE, owner, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/api/v2',
    maxAge: 365 * 24 * 60 * 60,
  })
  return { owner, id, data }
}

export async function readSite(workspace?: Workspace): Promise<SiteDocument> {
  if (!workspace)
    return {
      id: null,
      html: V2_STARTER_HTML,
      annotations: [],
      persisted: false,
    }
  const fs = await restoreFiles(workspace.data)
  const html = (await fs.exists(HTML)) ? await fs.readFile(HTML) : ''
  let annotations: SiteAnnotation[] = []
  try {
    annotations = annotationSchema
      .array()
      .parse(JSON.parse(await fs.readFile(NOTES)))
  } catch {}
  return { id: workspace.id, html, annotations, persisted: true }
}

export async function runBash(request: Request) {
  const input = await request.json()
  const { command } = bashSchema.parse(input)
  const { executionId } = executionSchema.parse(input)
  const workspace = await getWorkspace(request)
  const cancelled = new AbortController()
  const signal = AbortSignal.any([request.signal, cancelled.signal])
  const key = cancellationKey(workspace.owner, workspace.id, executionId)
  let checking = false
  const poll = setInterval(async () => {
    if (checking) return
    checking = true
    try {
      if (await workspaceRedis().exists(key)) cancelled.abort()
    } catch {
      cancelled.abort()
    } finally {
      checking = false
    }
  }, 1000)
  try {
    const output = await executeBash(workspace.data, command, signal)
    if (signal.aborted)
      return {
        stdout: output.stdout,
        stderr: output.stderr,
        exitCode: 130,
        cancelled: true,
        site: null,
      }
    const fs = await restoreFiles(output.data)
    if (await fs.exists(HTML)) {
      const html = await fs.readFile(HTML)
      const prepared = prepareHtml(html)
      if (prepared !== html) await fs.writeFile(HTML, prepared)
    }
    const after = await snapshotFiles(fs)
    const changes = changedFiles(workspace.data, after)
    const data =
      Object.keys(changes.writes).length || changes.deletes.length
        ? await saveChanges(workspace.owner, workspace.id, changes, executionId)
        : workspace.data
    return {
      stdout: output.stdout,
      stderr: output.stderr,
      exitCode: data ? output.exitCode : 130,
      cancelled: !data,
      site: data ? await readSite({ ...workspace, data }) : null,
      previewError: null,
    }
  } catch (error) {
    if (signal.aborted)
      return {
        stdout: '',
        stderr: 'Command cancelled.',
        exitCode: 130,
        cancelled: true,
        site: null,
      }
    throw error
  } finally {
    clearInterval(poll)
  }
}

export async function cancelBash(request: Request) {
  const { executionId } = executionSchema.parse(await request.json())
  const owner = await ownerId()
  if (!owner) throw new WorkspaceError('Create a design to save changes.', 401)
  const id = z.uuid().parse(new URL(request.url).searchParams.get('designId'))
  await workspaceRedis().set(cancellationKey(owner, id, executionId), true, {
    ex: 180,
  })
  return { cancelled: true }
}

async function updateAnnotations(
  workspace: Workspace,
  annotations: SiteAnnotation[],
) {
  const data = await saveChanges(workspace.owner, workspace.id, {
    writes: {
      [NOTES]: {
        type: 'file',
        content: JSON.stringify(annotations),
        mode: 0o644,
      },
    },
    deletes: [],
  })
  if (!data) throw new WorkspaceError('This design could not be found.', 404)
  return annotations
}

export async function saveAnnotation(
  request: Request,
  annotation: SiteAnnotation,
) {
  const workspace = await getWorkspace(request)
  const site = await readSite(workspace)
  return updateAnnotations(workspace, [
    ...site.annotations.filter((note) => note.id !== annotation.id),
    annotation,
  ])
}

export async function removeAnnotation(request: Request, id: string) {
  const workspace = await getWorkspace(request)
  const site = await readSite(workspace)
  return updateAnnotations(
    workspace,
    site.annotations.filter((note) => note.id !== id),
  )
}

export function workspaceFailure(error: unknown) {
  if (error instanceof ZodError || error instanceof SyntaxError)
    return Response.json({ error: 'Invalid request data.' }, { status: 400 })
  if (error instanceof WorkspaceError)
    return Response.json({ error: error.message }, { status: error.status })
  console.error(
    'Workspace failed:',
    error instanceof Error ? error.message : 'Unknown error',
  )
  return Response.json(
    {
      error: 'The workspace could not complete this request. Please try again.',
    },
    { status: 503 },
  )
}
