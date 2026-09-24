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

/** The HTTP status a local server answers with, or 0 if none does. */
export async function answers({
  sandbox,
  port,
  path = '/',
}: {
  sandbox: Sandbox
  port: number
  path?: string
}) {
  const probe = await sandbox.runCommand({
    cmd: 'curl',
    args: [
      '-s',
      '-o',
      '/dev/null',
      '-w',
      '%{http_code}',
      '--max-time',
      '5',
      `http://localhost:${port}${path}`,
    ],
  })
  return Number(await probe.stdout()) || 0
}

/**
 * Makes a port of the app's computer public, so the user's Preview tab can
 * show it. It never starts a server: something must already answer there.
 */
export async function exposePort({
  sandbox,
  port,
  path,
}: {
  sandbox: Sandbox
  port: number
  path: string
}) {
  if (port === NOVNC_PORT)
    return { error: `Port ${port} is the desktop itself; pick another.` }
  const status = await answers({ sandbox, port, path })
  if (!status)
    return {
      error: `Nothing is serving port ${port}. Start the server with bash, in the background, then try again.`,
    }
  // `ports` replaces the whole list, so keep the ones already exposed.
  const ports = sandbox.routes.map((route) => route.port)
  if (!ports.includes(port)) {
    if (ports.length >= 15)
      return { error: 'A sandbox exposes at most 15 ports.' }
    await sandbox.update({ ports: [...ports, port] })
  }
  const url = new URL((await Sandbox.get({ name: sandbox.name })).domain(port))
  url.pathname = path
  return { port, status, url: url.href, host: url.host }
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

// Runs the command with its output in a file rather than the sandbox's pipe:
// a job it backgrounds, like `a && b && server &`, keeps whatever output it
// started with, and on the pipe the call would wait for it forever.
// coreutils' timeout ends it; background jobs live on.
const RUN = `out=$(mktemp); timeout "$1" bash -lc "$0" > "$out" 2>&1 < /dev/null; code=$?; cat "$out"; rm -f "$out"; exit $code`

/** Runs a shell command in the app's workspace, with output capped. */
export async function bash({
  sandbox,
  command,
  timeoutSeconds,
  signal,
}: {
  sandbox: Sandbox
  command: string
  timeoutSeconds: number
  signal?: AbortSignal
}) {
  const result = await sandbox.runCommand({
    cmd: 'bash',
    args: ['-c', RUN, command, `${timeoutSeconds}s`],
    cwd: '/vercel/sandbox',
    env: DISPLAY,
    signal,
  })
  const output = await result.stdout()
  return {
    exitCode: result.exitCode,
    ...(result.exitCode === 124 && {
      timedOut: `Stopped after ${timeoutSeconds}s. Background long-running servers.`,
    }),
    output:
      output.length > OUTPUT_LIMIT
        ? `${output.slice(0, OUTPUT_LIMIT)}\n… ${output.length - OUTPUT_LIMIT} more characters`
        : output,
  }
}
