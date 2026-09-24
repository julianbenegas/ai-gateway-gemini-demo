'use client'

import type { Experimental_RealtimeSessionConfig } from 'ai'
import { inputs } from 'experimental-a2/ai'
import { z } from 'zod'
import { toolkit } from '@/lib/tools'
import type { AppMessage } from './agent'
import { agentClient } from './session'

/**
 * Voice mode: Gemini Live talks with the user and hands every piece of work
 * to the coding agent, which is Gemini 3.8 Flash with the computer. Its one
 * tool adds a task to the app's conversation and waits for the agent's reply.
 */
const INSTRUCTIONS = `You are the voice of a coding agent that has its own computer: a Linux desktop with Chrome, and a terminal. The user sees the agent's chat and screen while talking to you. Speak naturally and briefly in the user's language.
You can't see the screen or run anything yourself. For anything that needs building, coding, browsing, or looking at the screen, call delegate with a clear, self-contained task: the agent doesn't hear this conversation, so include every detail it needs. Describe the goal, not the steps; the agent knows its tools. The user can see the task in the chat.
delegate runs in the background while you keep talking, and a result can take a minute or more. Call it once per request: never again for the same request while you wait, even to add detail. Say in a few words that the agent is on it, then wait. When the result arrives, tell the user what the agent did or found in a sentence or two. Never say something is done before its result arrives. If the user adds a detail, corrects something, or asks for more while the agent works, delegate that right away: it steers the agent's current work instead of waiting behind it, and one result comes back for both.`

export const voiceConfiguration = {
  instructions: INSTRUCTIONS,
  voice: 'Aoede',
  outputModalities: ['audio'],
  inputAudioFormat: { type: 'audio/pcm', rate: 16000 },
  outputAudioFormat: { type: 'audio/pcm', rate: 24000 },
  inputAudioTranscription: {},
  outputAudioTranscription: {},
  turnDetection: { type: 'server-vad' },
} satisfies Experimental_RealtimeSessionConfig

const tool = toolkit<{ appId: string }>()

export const voiceTools = {
  delegate: tool({
    label: 'Handing it to the agent',
    description:
      'Give the coding agent a task and wait for its reply. It has a Linux desktop with Chrome and a terminal. Write the task so it stands on its own.',
    input: z.object({ task: z.string().min(1) }),
    execute: ({ input, appId, signal }) =>
      delegate({ appId, task: input.task, signal }),
  }),
}

// Delegations still waiting on the agent, per app. A follow-up steers the
// agent's work, and the earlier call returns at once, so voice gets one result.
const waiting = new Map<string, Set<() => void>>()

const STEERED =
  'You sent a follow-up while the agent worked on this. It carried on with both, and the result comes with the follow-up.'

async function delegate({
  appId,
  task,
  signal,
}: {
  appId: string
  task: string
  signal: AbortSignal
}) {
  const session = agentClient.session(appId)
  const id = crypto.randomUUID()
  const message: AppMessage = {
    id,
    role: 'user',
    parts: [{ type: 'text', text: task }],
    metadata: { via: 'voice' },
  }
  // Busy: steer, so the agent picks the task up after its current step, with
  // everything it did so far. Idle: a new turn.
  const { active } = session.getSnapshot().state
  if (active) for (const supersede of waiting.get(appId) ?? []) supersede()
  await session.push(
    ...(active
      ? inputs.steer({ turnId: active.turnId, message })
      : inputs.message(message)),
  )
  const reply = await new Promise<string>((resolve, reject) => {
    const check = () => {
      const { state } = session.getSnapshot()
      const position = (messageId: string) =>
        state.messages.findIndex((message) => message.id === messageId)
      const at = position(id)
      // Still working on it while the task is queued, or the active turn
      // started at or before it. A steered task shows in messages right away
      // but waits for the earlier turn to hand off.
      const pending =
        at < 0 ||
        state.starting ||
        state.inbox.items.some((item) => item.message.id === id) ||
        (!!state.active && position(state.active.input.message.id) <= at)
      if (pending) return
      stop()
      const answer = state.messages
        .slice(at + 1)
        .filter((message) => message.role === 'assistant')
        .flatMap((message) => message.parts)
        .flatMap((part) => (part.type === 'text' ? [part.text] : []))
        .join('\n')
        .trim()
      resolve(answer || state.error || 'The agent finished without a reply.')
    }
    const supersede = () => {
      stop()
      resolve(STEERED)
    }
    const unsubscribe = session.subscribe(check)
    const abort = () => {
      stop()
      reject(signal.reason)
    }
    const stop = () => {
      unsubscribe()
      signal.removeEventListener('abort', abort)
      waiting.get(appId)?.delete(supersede)
    }
    if (!waiting.has(appId)) waiting.set(appId, new Set())
    waiting.get(appId)!.add(supersede)
    signal.addEventListener('abort', abort)
    check()
  })
  return { reply }
}
