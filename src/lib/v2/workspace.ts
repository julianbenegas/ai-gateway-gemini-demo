import 'server-only'
import { randomBytes, randomUUID } from 'node:crypto'
import { cookies } from 'next/headers'
import { Sandbox } from '@vercel/sandbox'
import { z, ZodError } from 'zod'
import { V2_STARTER_HTML, prepareHtml } from './html'
import { annotationSchema, bashSchema } from './tools'
import type { SiteAnnotation, SiteDocument } from './types'

const COOKIE = 'margin_v2_session'
const ROOT = '/vercel/margin'
const HTML = `${ROOT}/index.html`
const NOTES = `${ROOT}/annotations.json`
const COMMANDS = `${ROOT}/.commands`
const executionSchema = z.object({ executionId: z.uuid() })

export class WorkspaceError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message)
  }
}

async function sessionId() {
  const value = (await cookies()).get(COOKIE)?.value
  return value && /^[a-f0-9]{36}$/.test(value) ? value : null
}

export async function getWorkspace() {
  const id = await sessionId()
  if (!id) throw new WorkspaceError('Start your site to save changes.', 401)
  return Sandbox.get({ name: `margin-v2-${id}` })
}

export async function startWorkspace() {
  if (await sessionId()) return getWorkspace()
  const id = randomBytes(18).toString('hex')
  const sandbox = await Sandbox.create({
    name: `margin-v2-${id}`,
    persistent: true,
    timeout: 5 * 60 * 1000,
    keepLastSnapshots: { count: 1 },
  })
  await sandbox.fs.mkdir(ROOT, { recursive: true })
  await sandbox.fs.writeFile(HTML, V2_STARTER_HTML)
  await sandbox.fs.writeFile(NOTES, '[]')
  ;(await cookies()).set(COOKIE, id, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/api/v2',
    maxAge: 30 * 24 * 60 * 60,
  })
  return sandbox
}

async function atomicWrite(sandbox: Sandbox, path: string, content: string) {
  const temporary = `${path}.${randomUUID()}.tmp`
  await sandbox.fs.writeFile(temporary, content)
  await sandbox.fs.rename(temporary, path)
}

export async function readSite(sandbox?: Sandbox): Promise<SiteDocument> {
  if (!sandbox && !(await sessionId()))
    return { html: V2_STARTER_HTML, annotations: [], persisted: false }
  const workspace = sandbox ?? (await getWorkspace())
  const [html, notes] = await Promise.all([
    workspace.readFileToBuffer({ path: HTML }),
    workspace.readFileToBuffer({ path: NOTES }),
  ])
  const source = html?.toString('utf8') ?? ''
  const prepared = source ? prepareHtml(source) : ''
  if (prepared !== source) await atomicWrite(workspace, HTML, prepared)
  let annotations: SiteAnnotation[] = []
  try {
    annotations = annotationSchema
      .array()
      .parse(JSON.parse(notes?.toString('utf8') ?? '[]'))
  } catch (error) {
    if (!(error instanceof SyntaxError || error instanceof ZodError))
      throw error
  }
  return { html: prepared, annotations, persisted: true }
}

export async function runBash(input: unknown, signal: AbortSignal) {
  const { command } = bashSchema.parse(input)
  const { executionId } = executionSchema.parse(input)
  const sandbox = await getWorkspace()
  await sandbox.fs.mkdir(COMMANDS, { recursive: true })
  const cancellation = `${COMMANDS}/${executionId}.cancel`
  if (await sandbox.readFileToBuffer({ path: cancellation }))
    throw new WorkspaceError('Command cancelled.', 409)
  const process = await sandbox.runCommand({
    cmd: 'bash',
    args: ['-c', command],
    cwd: ROOT,
    detached: true,
    timeoutMs: 120_000,
    signal,
  })
  const cancel = () => {
    void process.kill('SIGKILL').catch(() => {})
  }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    await atomicWrite(sandbox, `${COMMANDS}/${executionId}`, process.cmdId)
    if (await sandbox.readFileToBuffer({ path: cancellation }))
      await process.kill('SIGKILL')
    signal.throwIfAborted()
    const finished = await process.wait({ signal })
    const [stdout, stderr] = await Promise.all([
      finished.stdout({ signal }),
      finished.stderr({ signal }),
    ])
    let site: SiteDocument | null = null
    let previewError: string | null = null
    try {
      site = await readSite(sandbox)
    } catch {
      previewError =
        'The command finished, but index.html could not be loaded. Inspect the file with bash and repair it.'
    }
    return { exitCode: finished.exitCode, stdout, stderr, site, previewError }
  } catch (error) {
    await process.kill('SIGKILL').catch(() => {})
    throw error
  } finally {
    signal.removeEventListener('abort', cancel)
  }
}

export async function cancelBash(input: unknown) {
  const { executionId } = executionSchema.parse(input)
  const sandbox = await getWorkspace()
  await sandbox.fs.mkdir(COMMANDS, { recursive: true })
  await sandbox.fs.writeFile(`${COMMANDS}/${executionId}.cancel`, '1')
  const commandId = await sandbox.readFileToBuffer({
    path: `${COMMANDS}/${executionId}`,
  })
  if (commandId) {
    const process = await sandbox.getCommand(commandId.toString('utf8'))
    if (process.exitCode === null) await process.kill('SIGKILL')
  }
  return { cancelled: true }
}

export async function saveAnnotation(annotation: SiteAnnotation) {
  const sandbox = await getWorkspace()
  const site = await readSite(sandbox)
  const annotations = [
    ...site.annotations.filter((note) => note.id !== annotation.id),
    annotation,
  ]
  await atomicWrite(sandbox, NOTES, JSON.stringify(annotations))
  return annotations
}

export async function removeAnnotation(id: string) {
  const sandbox = await getWorkspace()
  const site = await readSite(sandbox)
  const annotations = site.annotations.filter((note) => note.id !== id)
  await atomicWrite(sandbox, NOTES, JSON.stringify(annotations))
  return annotations
}

export function workspaceFailure(error: unknown) {
  if (error instanceof ZodError || error instanceof SyntaxError)
    return Response.json({ error: 'Invalid request data.' }, { status: 400 })
  if (error instanceof WorkspaceError)
    return Response.json({ error: error.message }, { status: error.status })
  console.error(
    'Remote workspace failed:',
    error instanceof Error ? error.message : 'Unknown error',
  )
  return Response.json(
    {
      error:
        'The remote workspace could not complete this request. Please try again.',
    },
    { status: 503 },
  )
}
