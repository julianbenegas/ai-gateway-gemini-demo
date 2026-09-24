import 'server-only'
import { type ChildProcess, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Sandbox } from '@vercel/sandbox'
import { HttpError } from '@/lib/api'
import type { SiteFiles } from '../_lib/files'

/**
 * Each design's preview is a static site server, _preview/server.mjs, in its
 * own Vercel Sandbox on port 3000. Redis keeps the files; the sandbox gets a
 * copy whenever the preview opens or the design changes, so there is nothing
 * to persist, and a sandbox that timed out is created again, with a new URL.
 * The plain Node image boots it in a couple of seconds, without a snapshot.
 *
 * With MARGIN_V2_PREVIEW=local, as in the browser tests, the same server runs
 * on this machine instead, one process per design.
 */
const PORT = 3000
// Traced into the API route's function; see next.config.ts.
const ASSETS = join(process.cwd(), 'src/app/v2/_preview')

const local = () =>
  process.env.NODE_ENV !== 'production' &&
  process.env.MARGIN_V2_PREVIEW === 'local'

const sandboxName = (designId: string) => `margin-v2-${designId}`

async function startSandboxServer(sandbox: Sandbox) {
  await sandbox.writeFiles(
    await Promise.all(
      ['server.mjs', 'bridge.js'].map(async (name) => ({
        path: `.margin/${name}`,
        content: await readFile(join(ASSETS, name)),
      })),
    ),
  )
  const server = await sandbox.runCommand({
    cmd: 'node',
    args: ['.margin/server.mjs'],
    env: { PORT: String(PORT) },
    detached: true,
  })
  for await (const log of server.logs({ signal: AbortSignal.timeout(15000) }))
    if (log.stream === 'stdout' && log.data.startsWith('ready')) return
  throw new Error('The preview server exited before it was ready.')
}

// Swaps the new copy in whole, so a page never loads half an update.
const SWAP =
  'rm -rf site.old; if [ -e site ]; then mv site site.old; fi; mv "$0" site; rm -rf site.old'

async function sandboxPreview({
  designId,
  files,
}: {
  designId: string
  files: SiteFiles
}) {
  const sandbox = await Sandbox.getOrCreate({
    name: sandboxName(designId),
    image: 'vercel/sandbox/node:24',
    ports: [PORT],
    timeout: 30 * 60 * 1000,
    persistent: false,
    resume: true,
    onCreate: startSandboxServer,
  })
  const staging = `.margin/site-${randomUUID()}`
  await sandbox.writeFiles(
    Object.entries(files).map(([path, content]) => ({
      path: `${staging}/${path}`,
      content,
    })),
  )
  const swap = await sandbox.runCommand({
    cmd: 'sh',
    args: ['-c', SWAP, staging],
  })
  if (swap.exitCode !== 0)
    throw new Error(`Updating the preview failed: ${await swap.stderr()}`)
  return sandbox.domain(PORT)
}

type LocalServer = { url: string; root: string; process: ChildProcess }

// Next.js may load this module more than once in development.
const shared = globalThis as typeof globalThis & {
  marginV2LocalPreviews?: Map<string, Promise<LocalServer>>
}
const localServers = (shared.marginV2LocalPreviews ??= new Map())

function startLocalServer(designId: string) {
  const root = join(tmpdir(), 'margin-v2', designId)
  // In the dev server's process group, so it stops along with it.
  const server = spawn(process.execPath, [join(ASSETS, 'server.mjs')], {
    env: {
      NODE_ENV: process.env.NODE_ENV,
      PORT: '0',
      SITE: join(root, 'site'),
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  server.once('exit', () => localServers.delete(designId))
  return new Promise<LocalServer>((resolve, reject) => {
    server.once('error', reject)
    server.once('exit', () => reject(new Error('The preview server exited.')))
    server.stdout.on('data', (data: Buffer) => {
      const port = data.toString().match(/^ready (\d+)/)?.[1]
      if (port)
        resolve({ url: `http://localhost:${port}`, root, process: server })
    })
  })
}

async function localPreview({
  designId,
  files,
}: {
  designId: string
  files: SiteFiles
}) {
  let server = localServers.get(designId)
  if (!server) {
    server = startLocalServer(designId)
    localServers.set(designId, server)
  }
  const { url, root } = await server
  const staging = join(root, `site-${randomUUID()}`)
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(staging, path)), { recursive: true })
    await writeFile(join(staging, path), content)
  }
  await rm(join(root, 'site'), { recursive: true, force: true })
  await rename(staging, join(root, 'site'))
  return url
}

// One update per design at a time, so the newest files land last.
const updates = new Map<string, Promise<unknown>>()

/**
 * Brings the design's preview up to date with its files, starting a server
 * if there is none, and returns the preview's URL.
 */
export function showPreview(options: { designId: string; files: SiteFiles }) {
  const update = (updates.get(options.designId) ?? Promise.resolve())
    .catch(() => {})
    .then(() => (local() ? localPreview(options) : sandboxPreview(options)))
    .catch((error) => {
      console.error(
        'v2 preview failed:',
        error instanceof Error ? error.message : error,
      )
      throw new HttpError({
        message:
          'The preview could not start. Try again; locally, Vercel Sandbox needs a linked Vercel project.',
        status: 503,
      })
    })
  updates.set(options.designId, update)
  void update
    .finally(() => {
      if (updates.get(options.designId) === update)
        updates.delete(options.designId)
    })
    .catch(() => {})
  return update
}

export async function deletePreview({ designId }: { designId: string }) {
  if (local()) {
    const server = await localServers.get(designId)?.catch(() => null)
    server?.process.kill()
    if (server) await rm(server.root, { recursive: true, force: true })
    return
  }
  // One that can't be deleted now still stops when it times out.
  const sandbox = await Sandbox.get({ name: sandboxName(designId) }).catch(
    () => null,
  )
  await sandbox?.delete().catch(() => {})
}
