'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Tabs } from '@base-ui/react/tabs'
import {
  AppWindow,
  ExternalLink,
  LoaderCircle,
  Monitor,
  RotateCw,
} from 'lucide-react'
import { IconButton } from '@/ui/button'
import type { AppMessage } from '../_lib/agent'
import { appsApi } from '../_lib/rpc'
import { useSession } from '../_lib/session'
import { DesktopView } from './desktop-view'

type Tab = 'app' | 'computer'
type Preview = { port: number; url: string }

/**
 * What the agent last showed the user, from its show_preview and
 * show_computer calls in the conversation, so a reload shows it again.
 */
function agentViews(messages: AppMessage[]) {
  let preview: Preview | null = null
  let latest: { callId: string; tab: Tab } | null = null
  for (const message of messages)
    for (const part of message.parts) {
      if (!('toolCallId' in part) || part.state !== 'output-available') continue
      if (part.type === 'tool-show_preview') {
        const output = part.output as Partial<Preview>
        if (!output.url || !output.port) continue
        preview = { port: output.port, url: output.url }
        latest = { callId: part.toolCallId, tab: 'app' }
      }
      if (part.type === 'tool-show_computer')
        latest = { callId: part.toolCallId, tab: 'computer' }
    }
  return { preview, latest }
}

const POLL_MS = 5000

/** Whether the app's server answers, checked while its tab is open. */
function useAppStatus({
  appId,
  port,
  watching,
}: {
  appId: string
  port: number | null
  watching: boolean
}) {
  const [up, setUp] = useState<boolean | null>(null)
  useEffect(() => {
    setUp(null)
  }, [port])
  useEffect(() => {
    if (!port || !watching) return
    let current = true
    const check = () =>
      appsApi
        .portStatus({ id: appId, port })
        .then((status) => current && setUp(status.up))
        .catch(() => current && setUp(false))
    void check()
    const timer = setInterval(check, POLL_MS)
    return () => {
      current = false
      clearInterval(timer)
    }
  }, [appId, port, watching])
  return up
}

/**
 * The agent's app and its computer, as two tabs after just-say's pane. The
 * agent switches them with its tools; the user can too. Panels stack and stay
 * mounted, so the desktop stays connected and sized behind the app.
 */
export function ScreenPane({ appId }: { appId: string }) {
  const { state } = useSession()
  const { preview, latest } = useMemo(
    () => agentViews(state.messages),
    [state.messages],
  )
  const [tab, setTab] = useState<Tab>(latest?.tab ?? 'app')
  const [reloads, setReloads] = useState(0)
  // A new call from the agent moves the user to what it shows.
  const applied = useRef(latest?.callId)
  useEffect(() => {
    if (!latest || latest.callId === applied.current) return
    applied.current = latest.callId
    setTab(latest.tab)
    if (latest.tab === 'app') setReloads((count) => count + 1)
  }, [latest])

  const up = useAppStatus({
    appId,
    port: preview?.port ?? null,
    watching: tab === 'app',
  })
  // A server that comes back loads again.
  const wasUp = useRef(up)
  useEffect(() => {
    if (up && wasUp.current === false) setReloads((count) => count + 1)
    wasUp.current = up
  }, [up])

  return (
    <Tabs.Root
      value={tab}
      onValueChange={(value) => setTab(value as Tab)}
      className="flex min-h-0 min-w-0 flex-col pr-3 pb-3"
    >
      <div className="flex h-10 shrink-0 items-center gap-2">
        <Tabs.List aria-label="Screen" className="flex items-center gap-1">
          <PaneTab value="app" icon={<AppWindow size={13} />}>
            App
            {preview && <span className="text-faint">:{preview.port}</span>}
          </PaneTab>
          <PaneTab value="computer" icon={<Monitor size={13} />}>
            Computer
          </PaneTab>
        </Tabs.List>
        {tab === 'app' && preview && up && (
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            <IconButton
              label="Reload app"
              onClick={() => setReloads(reloads + 1)}
            >
              <RotateCw size={14} />
            </IconButton>
            <IconButton
              label="Open app in a new tab"
              onClick={() =>
                window.open(preview.url, '_blank', 'noopener,noreferrer')
              }
            >
              <ExternalLink size={14} />
            </IconButton>
          </div>
        )}
      </div>
      <div className="relative min-h-0 flex-1">
        <Tabs.Panel value="app" keepMounted className={panel} render={stacked}>
          <div inert={tab !== 'app'} className="size-full">
            {preview && up ? (
              <iframe
                key={`${preview.url}:${reloads}`}
                title="App"
                src={preview.url}
                allow="clipboard-write"
                className="size-full bg-white"
              />
            ) : (
              <AppPlaceholder
                port={preview?.port ?? null}
                checking={up === null}
              />
            )}
          </div>
        </Tabs.Panel>
        <Tabs.Panel
          value="computer"
          keepMounted
          className={panel}
          render={stacked}
        >
          <div inert={tab !== 'computer'} className="size-full">
            <DesktopView appId={appId} />
          </div>
        </Tabs.Panel>
      </div>
    </Tabs.Root>
  )
}

function AppPlaceholder({
  port,
  checking,
}: {
  port: number | null
  checking: boolean
}) {
  return (
    <div
      data-app-placeholder
      className="grid size-full place-items-center bg-shade"
    >
      <div className="flex max-w-72 flex-col items-center gap-2 text-center">
        {port && checking ? (
          <p className="flex items-center gap-2 text-faint">
            <LoaderCircle size={14} className="animate-spin" />
            Connecting to port {port}
          </p>
        ) : (
          <>
            <AppWindow size={24} strokeWidth={1.5} className="text-faint" />
            <p className="text-dim">
              {port ? `Nothing is running on port ${port}` : 'No app yet'}
            </p>
            <p className="text-faint">
              {port
                ? 'Ask the agent to start it again.'
                : 'When the agent runs one, it shows up here.'}
            </p>
          </>
        )}
      </div>
    </div>
  )
}

// Panels stack, the selected one on top. Hidden ones keep their size, so the
// desktop doesn't shrink to nothing, and stay visible to the browser, which
// stops painting cross-origin frames it considers hidden. So they drop the
// `hidden` attribute, which Tailwind's preflight turns into display: none;
// their content is inert instead.
const panel =
  'absolute inset-0 z-10 outline-none data-hidden:pointer-events-none data-hidden:z-0'
const stacked = (props: React.ComponentProps<'div'>) => (
  <div {...props} hidden={false} />
)

function PaneTab({
  value,
  icon,
  children,
}: {
  value: Tab
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Tabs.Tab
      value={value}
      className="flex h-7 items-center gap-1.5 px-2 text-xs text-muted outline-none hover:text-bright focus-visible:text-bright data-active:bg-shade data-active:text-bright"
    >
      {icon}
      <span className="flex gap-0.5">{children}</span>
    </Tabs.Tab>
  )
}
