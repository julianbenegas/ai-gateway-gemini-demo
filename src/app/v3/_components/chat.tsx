'use client'

import { useEffect, useRef, useState } from 'react'
import { Asterisk, LoaderCircle, Mic } from 'lucide-react'
import { inputs } from 'experimental-a2/ai'
import { CODING_MODEL_NAME, type CodingThinkingLevel } from '@/lib/models'
import { Button } from '@/ui/button'
import { cx } from '@/ui/cx'
import { GeminiIcon } from '@/ui/gemini-icon'
import { ScrollArea } from '@/ui/scroll-area'
import { type AppMessage, toolLabels } from '../_lib/agent'
import { useSession } from '../_lib/session'

type Part = AppMessage['parts'][number]

/** The coding agent's conversation, in the transcript's style but wide. */
export function Chat({
  toolbar,
  thinking,
}: {
  toolbar?: React.ReactNode
  /** The agent's thinking level for new requests. */
  thinking: { level: CodingThinkingLevel; cycle: () => void }
}) {
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
          metadata: { thinking: thinking.level },
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
      <ScrollArea label="Conversation" className="flex-1">
        <ol className="flex min-h-full flex-col gap-3 px-5 py-4">
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
      </ScrollArea>
      {error && (
        <p role="alert" className="px-5 pb-2 text-danger">
          {error}
        </p>
      )}
      <Composer
        onSend={send}
        onStop={working ? stop : null}
        queued={queued}
        thinking={thinking}
      />
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

/** A composer after forums.basehub.com: a dotted frame, then the model. */
function Composer({
  onSend,
  onStop,
  queued,
  thinking,
}: {
  onSend: (text: string) => Promise<void>
  onStop: (() => void) | null
  queued: number
  thinking: { level: CodingThinkingLevel; cycle: () => void }
}) {
  const [text, setText] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  // Grows with its text, up to a point, then scrolls.
  useEffect(() => {
    const textarea = input.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 208)}px`
  }, [text])
  return (
    <form
      className="group m-3 mt-1 flex shrink-0 flex-col bg-shade/10 outline-2 -outline-offset-1 outline-muted/50 outline-dotted focus-within:bg-shade/30 focus-within:outline-dashed"
      onSubmit={async (event) => {
        event.preventDefault()
        const message = text.trim()
        if (!message) return
        setText('')
        await onSend(message).catch(() => setText(message))
      }}
    >
      <textarea
        ref={input}
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
        placeholder="Ask the agent to build something"
        className="min-h-16 w-full resize-none bg-transparent p-3 pb-1 text-dim outline-none placeholder:text-faint"
      />
      <div
        className="flex cursor-text items-center justify-between gap-3 p-3 pt-1"
        onClick={(event) => {
          if (!(event.target as Element).closest('button'))
            input.current?.focus()
        }}
      >
        <div className="flex min-w-0 items-center gap-3 text-faint">
          <span
            title="The coding agent's model"
            className="flex min-w-0 items-center gap-1.5"
          >
            <GeminiIcon className="size-3.5 shrink-0" />
            <span className="truncate">{CODING_MODEL_NAME}</span>
          </span>
          <button
            type="button"
            aria-label={`Agent thinking: ${thinking.level}`}
            title="The agent's thinking level for new requests"
            onClick={thinking.cycle}
            className="shrink-0 hover:text-accent"
          >
            {thinking.level}
          </button>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!!queued && (
            <span className="text-xs text-faint">{queued} queued</span>
          )}
          {onStop && (
            <Button variant="ghost" onClick={onStop}>
              Stop
            </Button>
          )}
          <Button variant="primary" type="submit" disabled={!text.trim()}>
            Send
          </Button>
        </div>
      </div>
    </form>
  )
}
