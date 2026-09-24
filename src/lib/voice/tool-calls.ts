'use client'

import { useEffect, useRef, useState } from 'react'
import { runTool, type Tools } from '../tools'
import type { VoiceSession } from './session'

export type ToolActivity = {
  id: string
  label: string
  state: 'running' | 'done' | 'error'
}

/**
 * Runs the model's tool calls: validates them, passes `execute` the context,
 * deduplicates repeated call IDs, reports the latest call as activity, and
 * counts the calls still running.
 */
export function useToolCalls<Context>({
  session,
  tools,
  context,
}: {
  session: VoiceSession
  tools: Tools<Context>
  /** Passed to every tool; tool calls fail while it is null. */
  context: Context | null
}) {
  const [activity, setActivity] = useState<ToolActivity | null>(null)
  const [running, setRunning] = useState(0)
  const latestContext = useRef(context)
  latestContext.current = context
  const calls = useRef(new Map<string, Promise<unknown>>())

  useEffect(() => {
    calls.current.clear()
    setActivity(null)
    setRunning(0)
  }, [session.generation])

  useEffect(() => {
    if (activity?.state !== 'done') return
    const timer = setTimeout(() => setActivity(null), 2600)
    return () => clearTimeout(timer)
  }, [activity])

  const { handleToolCalls, epoch, isCurrent, signal } = session
  useEffect(
    () =>
      handleToolCalls(({ toolCall }) => {
        const existing = calls.current.get(toolCall.toolCallId)
        if (existing) return existing
        const at = epoch()
        const task = (async () => {
          if (!isCurrent(at)) return { error: 'The voice session has ended.' }
          const entry: ToolActivity = {
            id: toolCall.toolCallId,
            label: Object.hasOwn(tools, toolCall.toolName)
              ? tools[toolCall.toolName].label
              : 'Working',
            state: 'running',
          }
          setActivity(entry)
          setRunning((count) => count + 1)
          try {
            if (!latestContext.current)
              throw new Error('The workspace is still loading.')
            const result = await runTool({
              tools,
              name: toolCall.toolName,
              args: toolCall.args,
              call: { callId: toolCall.toolCallId, signal: signal() },
              context: latestContext.current,
            })
            if (isCurrent(at))
              setActivity((previous) =>
                previous?.id === entry.id
                  ? { ...entry, state: 'done' }
                  : previous,
              )
            return result
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error)
            if (isCurrent(at))
              setActivity({ ...entry, label: message, state: 'error' })
            return { error: message }
          } finally {
            if (isCurrent(at)) setRunning((count) => Math.max(0, count - 1))
          }
        })()
        calls.current.set(toolCall.toolCallId, task)
        return task
      }),
    [handleToolCalls, epoch, isCurrent, signal, tools],
  )

  return { activity, running, dismissActivity: () => setActivity(null) }
}
