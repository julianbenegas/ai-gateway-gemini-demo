// Builds the Vercel Sandbox snapshot that v3's desktops boot from: a VNC
// desktop (TigerVNC, openbox, noVNC) with Chrome, xdotool, and ImageMagick,
// plus npm and pnpm for the Node that the image ships,
// after github.com/vercel-labs/ai-sdk-computer-use, on the Ubuntu image.
//
//   node --env-file=.env.local scripts/v3-desktop-snapshot.mjs
//
// Then set MARGIN_V3_SNAPSHOT_ID to the printed id.
import { Sandbox } from '@vercel/sandbox'

const STARTUP_SCRIPT = `#!/bin/bash
set -e
RESOLUTION=\${RESOLUTION:-1280x800}
# TigerVNC is both the X server and the VNC server.
Xtigervnc :99 -geometry $RESOLUTION -depth 24 -SecurityTypes None -AlwaysShared -rfbport 5900 &
sleep 1
export DISPLAY=:99
openbox &
websockify --web /usr/share/novnc 6080 localhost:5900 &
echo "Desktop started"
`

const steps = [
  [
    'Desktop packages',
    'apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq tigervnc-standalone-server openbox novnc websockify xdotool imagemagick fonts-dejavu fonts-liberation curl git npm',
  ],
  ['pnpm', 'npm install -g --silent pnpm'],
  // The agent's workspace, owned by the user commands run as.
  [
    'Workspace',
    'mkdir -p /vercel/sandbox && chown ubuntu:ubuntu /vercel/sandbox',
  ],
  [
    'Google Chrome',
    'curl -sLo /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq /tmp/chrome.deb && rm /tmp/chrome.deb',
  ],
]

const sandbox = await Sandbox.create({
  image: 'vercel/sandbox/ubuntu',
  timeout: 20 * 60 * 1000,
})
console.log(`Sandbox ${sandbox.name}`)
try {
  for (const [label, command] of steps) {
    const started = Date.now()
    const result = await sandbox.runCommand({
      cmd: 'bash',
      args: ['-c', command],
      sudo: true,
    })
    const seconds = ((Date.now() - started) / 1000).toFixed(0)
    if (result.exitCode !== 0)
      throw new Error(
        `${label} failed:\n${(await result.stderr()).slice(-2000)}`,
      )
    console.log(`${label}: ok (${seconds}s)`)
  }
  await sandbox.writeFiles([
    { path: 'start-desktop.sh', content: Buffer.from(STARTUP_SCRIPT) },
  ])
  await sandbox.runCommand({
    cmd: 'bash',
    args: [
      '-c',
      'mv start-desktop.sh /usr/local/bin/ && chmod +x /usr/local/bin/start-desktop.sh',
    ],
    sudo: true,
  })
  // Stops the sandbox. No expiration: every desktop boots from it.
  const snapshot = await sandbox.snapshot({ expiration: 0 })
  console.log(`MARGIN_V3_SNAPSHOT_ID=${snapshot.snapshotId}`)
} catch (error) {
  await sandbox.stop().catch(() => {})
  throw error
}
