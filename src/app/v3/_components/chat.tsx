'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Asterisk, LoaderCircle, Mic, Square } from 'lucide-react'
import { inputs } from 'experimental-a2/ai'
import { IconButton } from '@/ui/button'
import { cx } from '@/ui/cx'
import { type AppMessage, toolLabels } from '../_lib/agent'
import { useSession } from '../_lib/session'

type Part = AppMessage['parts'][number]

/** The coding agent's conversation, in the transcript's style but wide. */
export function Chat({ toolbar }: { toolbar?: React.ReactNode }) {
  const { state, push } = useSession()
  const [error, setError] = useState<string | null>(null)
  const end = useRef<HTMLLIElement>(null)
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [state.messages])

  const last = state.messages.at(-1)
  const working = state.status === 'generating' || state.active !== null
  const waiting =
    working &&
    (last?.role !== 'assistant' || !last.parts.some((part) => isVisible(part)))
  const queued = state.inbox.items.length

  const send = async (text: string) => {
    setError(null)
    try {
      await push(
        ...inputs.message({
          id: crypto.randomUUID(),
          role: 'user',
          parts: [{ type: 'text', text }],
        }),
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      throw cause
    }
  }
  const stop = () => {
    if (state.active) void push(...inputs.stop({ turnId: state.active.turnId }))
  }

  return (
    <section aria-label="Chat" className="flex min-h-0 flex-col bg-background">
      <div className="relative z-10 flex h-10 shrink-0 items-center justify-between gap-3 pr-3 pl-5">
        <span className="text-xs font-medium text-faint uppercase">Agent</span>
        {toolbar}
      </div>
      <ol className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-5 py-4">
        {!state.messages.length && (
          <li className="m-auto max-w-72 text-center text-faint">
            Ask the agent to build something. It codes in the terminal and
            checks its work on the screen.
          </li>
        )}
        {state.messages.flatMap((message) =>
          message.parts.map((part, index) => (
            <MessagePart
              key={`${message.id}:${index}`}
              message={message}
              part={part}
            />
          )),
        )}
        {waiting && (
          <li className="flex items-center gap-1.5 text-faint">
            <LoaderCircle size={12} className="animate-spin" />
            Thinking
          </li>
        )}
        {state.error && (
          <li role="alert" className="text-danger">
            {state.error}
          </li>
        )}
        <li ref={end} aria-hidden />
      </ol>
      {error && (
        <p role="alert" className="px-5 pb-2 text-danger">
          {error}
        </p>
      )}
      <Composer onSend={send} onStop={working ? stop : null} queued={queued} />
    </section>
  )
}

const isVisible = (part: Part) =>
  (part.type === 'text' && !!part.text.trim()) || part.type.startsWith('tool-')

function MessagePart({ message, part }: { message: AppMessage; part: Part }) {
  if (part.type === 'text' && part.text.trim())
    return (
      <li
        data-role={message.role}
        className={cx(
          'max-w-[85%] leading-relaxed whitespace-pre-wrap',
          message.role === 'user'
            ? 'self-end bg-shade px-3 py-2 text-dim'
            : 'self-start text-muted',
        )}
      >
        {message.metadata?.via === 'voice' && (
          <Mic
            size={12}
            aria-label="From voice"
            className="mr-1.5 inline text-accent"
          />
        )}
        {part.text}
      </li>
    )
  if (!part.type.startsWith('tool-') || !('state' in part)) return null
  const name = part.type.slice('tool-'.length)
  const done = part.state === 'output-available'
  const failed = part.state === 'output-error'
  const input = (part as { input?: Record<string, unknown> }).input
  const detail =
    name === 'bash'
      ? input?.command
      : name === 'type'
        ? input?.text
        : name === 'key'
          ? input?.keys
          : undefined
  return (
    <li
      data-tool={name}
      className={cx(
        'flex max-w-full items-start gap-1.5 self-start text-xs',
        failed ? 'text-danger' : 'text-faint',
      )}
    >
      {done || failed ? (
        <Asterisk size={12} className="mt-0.5 shrink-0 text-accent" />
      ) : (
        <LoaderCircle size={12} className="mt-0.5 shrink-0 animate-spin" />
      )}
      <span className="shrink-0">{toolLabels[name] ?? name}</span>
      {typeof detail === 'string' && (
        <code className="min-w-0 truncate text-faint/70">{detail}</code>
      )}
    </li>
  )
}

function Composer({
  onSend,
  onStop,
  queued,
}: {
  onSend: (text: string) => Promise<void>
  onStop: (() => void) | null
  queued: number
}) {
  const [text, setText] = useState('')
  return (
    <form
      className="flex shrink-0 items-end gap-1 p-3 pt-0"
      onSubmit={async (event) => {
        event.preventDefault()
        const message = text.trim()
        if (!message) return
        setText('')
        await onSend(message).catch(() => setText(message))
      }}
    >
      <textarea
        aria-label="Message"
        value={text}
        rows={2}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            event.currentTarget.form?.requestSubmit()
          }
        }}
        placeholder={
          queued
            ? `${queued} queued; runs after this turn`
            : 'Message the agent'
        }
        className="min-h-9 min-w-0 flex-1 resize-none bg-accent/5 px-2.5 py-2 text-accent outline-1 -outline-offset-1 outline-accent/40 outline-dotted placeholder:text-accent/50 focus:outline-2 focus:outline-accent focus:outline-dashed"
      />
      {onStop && (
        <IconButton label="Stop" variant="danger" onClick={onStop}>
          <Square size={13} />
        </IconButton>
      )}
      <IconButton
        label="Send message"
        type="submit"
        variant="accent"
        disabled={!text.trim()}
      >
        <ArrowUp size={15} />
      </IconButton>
    </form>
  )
}
