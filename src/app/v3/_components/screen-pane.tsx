'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Tabs } from '@base-ui/react/tabs'
import { ExternalLink, Globe, Monitor, RotateCw, X } from 'lucide-react'
import { IconButton } from '@/ui/button'
import { cx } from '@/ui/cx'
import type { AppMessage } from '../_lib/agent'
import { useSession } from '../_lib/session'
import { DesktopView } from './desktop-view'

type Preview = { port: number; url: string }

/**
 * What the agent last showed the user, from its show_preview and
 * show_computer calls in the conversation, so a reload shows it again.
 */
function agentViews(messages: AppMessage[]) {
  const previews = new Map<number, Preview>()
  let latest: { callId: string; tab: string } | null = null
  for (const message of messages)
    for (const part of message.parts) {
      if (!('toolCallId' in part) || part.state !== 'output-available') continue
      if (part.type === 'tool-show_preview') {
        const output = part.output as Partial<Preview>
        if (!output.url || !output.port) continue
        previews.set(output.port, { port: output.port, url: output.url })
        latest = { callId: part.toolCallId, tab: `preview:${output.port}` }
      }
      if (part.type === 'tool-show_computer')
        latest = { callId: part.toolCallId, tab: 'computer' }
    }
  return { previews: [...previews.values()], latest }
}

/**
 * The agent's computer and the servers it shows, as tabs after just-say's
 * pane. The agent switches tabs with its tools; the user can too. Panels stay
 * mounted and sized, so the desktop stays connected behind a preview.
 */
export function ScreenPane({ appId }: { appId: string }) {
  const { state } = useSession()
  const { previews, latest } = useMemo(
    () => agentViews(state.messages),
    [state.messages],
  )
  const [tab, setTab] = useState(latest?.tab ?? 'computer')
  const [closed, setClosed] = useState<number[]>([])
  const [reloads, setReloads] = useState(0)
  // A new call from the agent moves the user to what it shows.
  const applied = useRef(latest?.callId)
  useEffect(() => {
    if (!latest || latest.callId === applied.current) return
    applied.current = latest.callId
    setTab(latest.tab)
    setClosed((ports) =>
      ports.filter((port) => `preview:${port}` !== latest.tab),
    )
  }, [latest])

  const open = previews.filter((preview) => !closed.includes(preview.port))
  const current = open.find((preview) => `preview:${preview.port}` === tab)
  const selected = current || tab === 'computer' ? tab : 'computer'

  return (
    <Tabs.Root
      value={selected}
      onValueChange={(value) => setTab(String(value))}
      className="flex min-h-0 min-w-0 flex-col pr-3 pb-3"
    >
      <div className="flex h-10 shrink-0 items-center gap-2">
        <Tabs.List
          aria-label="Screen"
          className="flex min-w-0 [scrollbar-width:none] items-center gap-1 overflow-x-auto"
        >
          <PaneTab
            value="computer"
            icon={<Monitor size={13} />}
            name="Computer"
          />
          {open.map((preview) => (
            <PaneTab
              key={preview.port}
              value={`preview:${preview.port}`}
              icon={<Globe size={13} />}
              title={preview.url}
              name={`localhost:${preview.port}`}
              onClose={() => setClosed((ports) => [...ports, preview.port])}
            />
          ))}
        </Tabs.List>
        {current && (
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            <IconButton
              label="Reload preview"
              onClick={() => setReloads(reloads + 1)}
            >
              <RotateCw size={14} />
            </IconButton>
            <IconButton
              label="Open preview in a new tab"
              onClick={() =>
                window.open(current.url, '_blank', 'noopener,noreferrer')
              }
            >
              <ExternalLink size={14} />
            </IconButton>
          </div>
        )}
      </div>
      <div className="relative min-h-0 flex-1">
        <Tabs.Panel value="computer" keepMounted className={panel}>
          <DesktopView appId={appId} />
        </Tabs.Panel>
        {open.map((preview) => (
          <Tabs.Panel
            key={preview.port}
            value={`preview:${preview.port}`}
            keepMounted
            className={panel}
          >
            <iframe
              key={reloads}
              title={`Preview of port ${preview.port}`}
              src={preview.url}
              allow="clipboard-write"
              className="size-full bg-white"
            />
          </Tabs.Panel>
        ))}
      </div>
    </Tabs.Root>
  )
}

// Panels stack, the selected one on top. Hidden ones keep their size, so the
// desktop doesn't shrink to nothing, and stay visible to the browser, which
// stops painting cross-origin frames it considers hidden.
const panel =
  'absolute inset-0 z-10 outline-none [&[hidden]]:block data-hidden:pointer-events-none data-hidden:z-0'

function PaneTab({
  value,
  icon,
  name,
  title,
  onClose,
}: {
  value: string
  icon: React.ReactNode
  name: string
  title?: string
  onClose?: () => void
}) {
  return (
    <div className="group flex shrink-0 items-center has-[[data-active]]:bg-shade">
      <Tabs.Tab
        value={value}
        title={title}
        className={cx(
          'flex h-7 max-w-44 items-center gap-1.5 text-xs text-muted outline-none hover:text-bright focus-visible:text-bright data-active:text-bright',
          onClose ? 'pr-0.5 pl-2' : 'px-2',
        )}
      >
        {icon}
        <span className="truncate">{name}</span>
      </Tabs.Tab>
      {onClose && (
        <IconButton
          label={`Close ${name}`}
          size="icon-sm"
          onClick={onClose}
          className="mr-0.5 size-5"
        >
          <X size={11} />
        </IconButton>
      )}
    </div>
  )
}
