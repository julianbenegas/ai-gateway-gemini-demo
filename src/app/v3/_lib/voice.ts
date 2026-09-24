'use client'

import type { Experimental_RealtimeSessionConfig } from 'ai'
import { inputs } from 'experimental-a2/ai'
import { z } from 'zod'
import { toolkit } from '@/lib/tools'
import type { CodingThinkingLevel } from '@/lib/models'
import { type AppMessage, toolLabels } from './agent'
import { agentClient } from './session'

/**
 * Voice mode: Gemini Live talks with the user and hands every piece of work
 * to the coding agent, which is Gemini 3.8 Flash with the computer. It
 * delegates tasks into the app's conversation and can read how they're going.
 */
const INSTRUCTIONS = `You are the voice of a coding agent that has its own computer: a Linux desktop with Chrome, and a terminal. The user sees the agent's chat and screen while talking to you. Speak naturally and briefly in the user's language.
You can't see the screen or run anything yourself. For anything that needs building, coding, browsing, or looking at the screen, call delegate with a clear, self-contained task: the agent doesn't hear this conversation, so include every detail it needs. Describe the goal, not the steps; the agent knows its tools. The user can see the task in the chat.
Work takes time. delegate only starts the task: the agent works in the background, usually for a minute or more, and the result arrives when delegate returns. Until then nothing is done yet. Say you've handed it off and that it will take a moment, then wait. Never say the task is done, and never describe results or what's on screen, before delegate returns. When it returns, tell the user what the agent did or found in a sentence or two.
If the user asks how it's going, or whether it's done, call agent_status and tell them what the agent is doing right now. Don't guess.
Call delegate once per request, never again for the same request while you wait. If the user adds a detail, corrects something, or asks for more while the agent works, delegate that right away: it steers the agent's current work instead of waiting behind it, and one result comes back for both.`

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

const tool = toolkit<{ appId: string; agentThinking: CodingThinkingLevel }>()

export const voiceTools = {
  delegate: tool({
    label: 'Handing it to the agent',
    description:
      'Start a task for the coding agent. It works in the background, usually for a minute or more, and this returns its reply when it finishes. It has a Linux desktop with Chrome and a terminal. Write the task so it stands on its own.',
    input: z.object({ task: z.string().min(1) }),
    execute: ({ input, appId, agentThinking, signal }) =>
      delegate({ appId, task: input.task, thinking: agentThinking, signal }),
  }),
  agent_status: tool({
    label: 'Checking on the agent',
    description:
      "See what the coding agent is doing right now: whether it's working, its current task, its latest steps, and its last reply.",
    input: z.object({}),
    execute: ({ appId }) => agentStatus({ appId }),
  }),
}

/** What the agent is doing, from its conversation as the chat shows it. */
function agentStatus({ appId }: { appId: string }) {
  const { state } = agentClient.session(appId).getSnapshot()
  const text = (message: AppMessage | undefined) =>
    message?.parts
      .flatMap((part) => (part.type === 'text' ? [part.text] : []))
      .join('\n')
      .trim()
  const current = state.active?.input.message as AppMessage | undefined
  const since = current
    ? state.messages.findIndex((message) => message.id === current.id)
    : -1
  const steps = state.messages
    .slice(since + 1)
    .filter((message) => message.role === 'assistant')
    .flatMap((message) => message.parts)
    .flatMap((part) =>
      part.type.startsWith('tool-')
        ? [toolLabels[part.type.slice(5)] ?? part.type.slice(5)]
        : [],
    )
  return {
    working: !!state.active || state.starting,
    currentTask: text(current) ?? null,
    stepsSoFar: steps.length,
    latestSteps: steps.slice(-5),
    queuedTasks: state.inbox.items.length,
    lastReply:
      text(
        state.messages.findLast((message) => message.role === 'assistant'),
      ) || null,
  }
}

// Delegations still waiting on the agent, per app. A follow-up steers the
// agent's work, and the earlier call returns at once, so voice gets one result.
const waiting = new Map<string, Set<() => void>>()

const STEERED =
  'You sent a follow-up while the agent worked on this. It carried on with both, and the result comes with the follow-up.'

async function delegate({
  appId,
  task,
  thinking,
  signal,
}: {
  appId: string
  task: string
  thinking: CodingThinkingLevel
  signal: AbortSignal
}) {
  const session = agentClient.session(appId)
  const id = crypto.randomUUID()
  const message: AppMessage = {
    id,
    role: 'user',
    parts: [{ type: 'text', text: task }],
    metadata: { via: 'voice', thinking },
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
