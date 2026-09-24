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
delegate runs in the background while you keep talking, and a result can take a minute or more. Call it once per request: never again for the same request while you wait, even to add detail. Say in a few words that the agent is on it, then wait. When the result arrives, tell the user what the agent did or found in a sentence or two. Never say something is done before its result arrives. Only when the user asks for something new while the agent works, delegate that too; tasks run in order.`

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
  await session.push(...inputs.message(message))
  const reply = await new Promise<string>((resolve, reject) => {
    const check = () => {
      const { state } = session.getSnapshot()
      const at = state.messages.findIndex((message) => message.id === id)
      const pending =
        state.active?.input.message.id === id ||
        state.inbox.items.some((item) => item.message.id === id)
      if (at < 0 || pending) return
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
    const unsubscribe = session.subscribe(check)
    const abort = () => {
      stop()
      reject(signal.reason)
    }
    const stop = () => {
      unsubscribe()
      signal.removeEventListener('abort', abort)
    }
    signal.addEventListener('abort', abort)
    check()
  })
  return { reply }
}
