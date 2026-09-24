'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Asterisk, LoaderCircle, X } from 'lucide-react'
import type { UIMessage } from 'ai'
import { IconButton } from './button'
import { cx } from './cx'

/**
 * Voice messages as a small chat: speech, typed messages, and tool calls. The
 * model forgets everything when a session ends, so a divider marks where each
 * one starts.
 */
export function Transcript({
  messages,
  sessionStarts = [],
  labels,
  onSend,
  onClose,
  className,
}: {
  messages: UIMessage[]
  /** Indexes of the messages that opened a new session. */
  sessionStarts?: number[]
  /** Tool names to the labels shown for them. */
  labels: Record<string, string>
  /** Sends a typed message to the model; null while no session is live. */
  onSend: ((text: string) => void) | null
  onClose: () => void
  className?: string
}) {
  const end = useRef<HTMLLIElement>(null)
  // Braces matter: scrollIntoView returns a promise in newer browsers, and
  // React would call a returned value as the effect's cleanup.
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [messages])
  return (
    <section
      data-transcript
      aria-label="Transcript"
      className={cx(
        'flex max-h-[min(420px,60dvh)] w-[min(340px,calc(100vw-24px))] flex-col bg-background shadow-lg shadow-black/15',
        className,
      )}
    >
      <header className="flex h-9 shrink-0 items-center justify-between bg-shade pr-0.5 pl-3 text-xs font-medium text-dim uppercase">
        Transcript
        <IconButton label="Close transcript" size="icon-sm" onClick={onClose}>
          <X size={14} />
        </IconButton>
      </header>
      <ol className="flex min-h-0 flex-col gap-2 overflow-auto p-3">
        {!messages.length && <li className="text-faint">Nothing said yet.</li>}
        {messages.flatMap((message, position) => [
          sessionStarts.includes(position) && (
            <li
              key={`session:${position}`}
              data-session-divider
              aria-label="New session"
              className="my-1 dashed-line shrink-0"
            />
          ),
          ...message.parts.map((part, index) => {
            const key = `${message.id}:${index}`
            if (part.type === 'text' && part.text.trim())
              return (
                <li
                  key={key}
                  data-role={message.role}
                  className={cx(
                    'max-w-[85%] leading-relaxed',
                    message.role === 'user'
                      ? 'self-end bg-shade px-2.5 py-1.5 text-dim'
                      : 'self-start text-muted',
                  )}
                >
                  {part.text}
                </li>
              )
            if (part.type === 'dynamic-tool')
              return (
                <li
                  key={key}
                  className={cx(
                    'flex items-center gap-1.5 self-start text-xs',
                    part.state === 'output-error'
                      ? 'text-danger'
                      : 'text-faint',
                  )}
                >
                  {part.state === 'output-available' ||
                  part.state === 'output-error' ? (
                    <Asterisk size={12} className="shrink-0 text-accent" />
                  ) : (
                    <LoaderCircle size={12} className="shrink-0 animate-spin" />
                  )}
                  <span>{labels[part.toolName] ?? part.toolName}</span>
                  <code className="text-faint/70">{part.toolName}</code>
                </li>
              )
            return null
          }),
        ])}
        {/* A session that started after the last message, with nothing new yet. */}
        {sessionStarts.includes(messages.length) && (
          <li
            data-session-divider
            aria-label="New session"
            className="my-1 dashed-line shrink-0"
          />
        )}
        <li ref={end} aria-hidden />
      </ol>
      <Composer onSend={onSend} />
    </section>
  )
}

function Composer({ onSend }: { onSend: ((text: string) => void) | null }) {
  const [text, setText] = useState('')
  const input = useRef<HTMLInputElement>(null)
  // Ready to type as soon as a session is live.
  useEffect(() => {
    if (onSend) input.current?.focus()
  }, [!!onSend])
  return (
    <form
      className="flex shrink-0 items-center gap-1 p-2 pt-0"
      onSubmit={(event) => {
        event.preventDefault()
        if (!onSend || !text.trim()) return
        onSend(text.trim())
        setText('')
      }}
    >
      <input
        ref={input}
        aria-label="Message"
        value={text}
        onChange={(event) => setText(event.target.value)}
        disabled={!onSend}
        placeholder={onSend ? 'Type a message' : 'Start voice to type'}
        className="h-8 min-w-0 flex-1 bg-accent/5 px-2 text-accent outline-1 -outline-offset-1 outline-accent/40 outline-dotted placeholder:text-accent/50 focus:outline-2 focus:outline-accent focus:outline-dashed disabled:bg-shade disabled:outline-none disabled:placeholder:text-faint"
      />
      <IconButton
        label="Send message"
        type="submit"
        variant="accent"
        disabled={!onSend || !text.trim()}
      >
        <ArrowUp size={15} />
      </IconButton>
    </form>
  )
}

export const toolLabels = (tools: Record<string, { label: string }>) =>
  Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => [name, tool.label]),
  )
