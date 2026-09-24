'use client'

import { useEffect, useRef } from 'react'
import { Asterisk, LoaderCircle, X } from 'lucide-react'
import type { UIMessage } from 'ai'
import { IconButton } from './button'
import { cx } from './cx'

/** A voice session's messages as a small chat: speech and tool calls. */
export function Transcript({
  messages,
  labels,
  onClose,
  className,
}: {
  messages: UIMessage[]
  /** Tool names to the labels shown for them. */
  labels: Record<string, string>
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
        {messages.flatMap((message) =>
          message.parts.map((part, index) => {
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
        )}
        <li ref={end} aria-hidden />
      </ol>
    </section>
  )
}

export const toolLabels = (tools: Record<string, { label: string }>) =>
  Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => [name, tool.label]),
  )
