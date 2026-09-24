import 'server-only'
import { Sandbox } from '@vercel/sandbox'
import { HttpError } from '@/lib/api'

/**
 * Each app has one persistent Vercel Sandbox with a VNC desktop, booted from
 * the snapshot scripts/v3-desktop-snapshot.mjs builds. A stopped sandbox keeps
 * its files and resumes on the next call; the desktop starts again then.
 */
const NOVNC_PORT = 6080
// The screen starts at this size; the viewer then resizes it to its panel.
const INITIAL_SCREEN = '1280x800'
// Each viewer call pushes the sandbox's shutdown back this far, so it stays
// up while someone watches; the page calls again every few minutes.
const KEEP_ALIVE_MS = 10 * 60 * 1000
const DISPLAY = { DISPLAY: ':99' }
const OUTPUT_LIMIT = 32 * 1024

// Local runs and deployments share the project's sandboxes, so each name
// says where it came from.
const scope =
  process.env.MARGIN_STORE === 'memory'
    ? 'test'
    : (process.env.VERCEL_ENV ?? 'local')
const sandboxName = (appId: string) => `margin-v3-${scope}-${appId}`

async function boot(sandbox: Sandbox) {
  await sandbox.runCommand({
    cmd: 'bash',
    args: ['/usr/local/bin/start-desktop.sh'],
    env: { RESOLUTION: INITIAL_SCREEN },
    detached: true,
  })
  for (let attempt = 0; attempt < 40; attempt++) {
    const probe = await sandbox.runCommand({
      cmd: 'curl',
      args: [
        '-so',
        '/dev/null',
        '-w',
        '%{http_code}',
        `localhost:${NOVNC_PORT}`,
      ],
    })
    if ((await probe.stdout()) === '200') break
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  await sandbox.runCommand({
    cmd: 'bash',
    args: [
      '-c',
      'google-chrome --disable-gpu --no-first-run --no-default-browser-check --disable-dev-shm-usage --start-maximized about:blank >/tmp/chrome.log 2>&1 &',
    ],
    env: DISPLAY,
    detached: true,
  })
}

// One boot per app at a time, across page loads and tool calls.
const opening = new Map<string, Promise<Sandbox>>()

export function desktop({ appId }: { appId: string }) {
  const snapshotId = process.env.MARGIN_V3_SNAPSHOT_ID
  if (!snapshotId)
    throw new HttpError({
      message:
        'Set MARGIN_V3_SNAPSHOT_ID; see scripts/v3-desktop-snapshot.mjs.',
      status: 503,
    })
  const pending =
    opening.get(appId) ??
    Sandbox.getOrCreate({
      name: sandboxName(appId),
      source: { type: 'snapshot', snapshotId },
      ports: [NOVNC_PORT],
      timeout: 30 * 60 * 1000,
      persistent: true,
      resume: true,
      onCreate: boot,
      onResume: boot,
    }).finally(() => opening.delete(appId))
  opening.set(appId, pending)
  return pending
}

/**
 * The app's VNC socket, through websockify. Resumes a stopped desktop and
 * keeps a running one alive.
 */
export async function desktopSocket({ appId }: { appId: string }) {
  const sandbox = await desktop({ appId })
  // Throws past the plan's session limit; the desktop still works until then.
  await sandbox.extendTimeout(KEEP_ALIVE_MS).catch(() => {})
  const url = new URL(sandbox.domain(NOVNC_PORT))
  url.protocol = 'wss:'
  url.pathname = '/websockify'
  return url.href
}

export async function deleteDesktop({ appId }: { appId: string }) {
  const sandbox = await Sandbox.get({ name: sandboxName(appId) }).catch(
    () => null,
  )
  await sandbox?.delete()
}

/** The screen as a base64 JPEG. */
export async function screenshot({ sandbox }: { sandbox: Sandbox }) {
  const result = await sandbox.runCommand({
    cmd: 'bash',
    args: ['-c', 'import -window root -quality 70 jpg:- | base64 -w0'],
    env: DISPLAY,
  })
  if (result.exitCode !== 0)
    throw new Error(`Screenshot failed: ${await result.stderr()}`)
  return result.stdout()
}

/**
 * Moves the pointer to a point on the 1000×1000 grid, scaled to the screen's
 * current size, which follows the viewer, then runs the xdotool `after` args.
 */
export async function pointAt({
  sandbox,
  x,
  y,
  after = [],
}: {
  sandbox: Sandbox
  x: number
  y: number
  after?: string[]
}) {
  const script = `read W H < <(xdotool getdisplaygeometry); xdotool mousemove $(( (${2 * x + 1}) * W / 2000 )) $(( (${2 * y + 1}) * H / 2000 )) ${after.join(' ')}`
  const result = await sandbox.runCommand({
    cmd: 'bash',
    args: ['-c', script],
    env: DISPLAY,
  })
  if (result.exitCode !== 0)
    throw new Error(`Pointer action failed: ${await result.stderr()}`)
}

export async function xdotool({
  sandbox,
  args,
}: {
  sandbox: Sandbox
  args: string[]
}) {
  const result = await sandbox.runCommand({
    cmd: 'xdotool',
    args,
    env: DISPLAY,
  })
  if (result.exitCode !== 0)
    throw new Error(`xdotool ${args[0]} failed: ${await result.stderr()}`)
}

/** Runs a shell command in the app's workspace, with output capped. */
export async function bash({
  sandbox,
  command,
  timeoutMs,
  signal,
}: {
  sandbox: Sandbox
  command: string
  timeoutMs: number
  signal?: AbortSignal
}) {
  const result = await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', command],
    cwd: '/vercel/sandbox',
    env: DISPLAY,
    timeoutMs,
    signal,
  })
  const cap = (text: string) =>
    text.length > OUTPUT_LIMIT
      ? `${text.slice(0, OUTPUT_LIMIT)}\n… ${text.length - OUTPUT_LIMIT} more characters`
      : text
  return {
    exitCode: result.exitCode,
    stdout: cap(await result.stdout()),
    stderr: cap(await result.stderr()),
  }
}
