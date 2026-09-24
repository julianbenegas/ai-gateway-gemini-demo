'use client'

import { useState } from 'react'
import { ArrowLeft, ArrowRight, RotateCw } from 'lucide-react'
import { IconButton } from '@/ui/button'

/** A browser's controls for the preview: its history, and an address bar. */
export function PreviewToolbar({
  port,
  path,
  canGoBack,
  canGoForward,
  disabled,
  onBack,
  onForward,
  onReload,
  onNavigate,
}: {
  /** The preview server's port, in its sandbox. */
  port: number | null
  path: string
  canGoBack: boolean
  canGoForward: boolean
  disabled: boolean
  onBack: () => void
  onForward: () => void
  onReload: () => void
  onNavigate: (path: string) => void
}) {
  // What's typed in the address bar, until it's submitted or abandoned.
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <div
      role="group"
      aria-label="Preview"
      className="flex h-10 shrink-0 items-center gap-0.5 px-2"
    >
      <IconButton
        label="Back"
        onClick={onBack}
        disabled={disabled || !canGoBack}
      >
        <ArrowLeft size={16} />
      </IconButton>
      <IconButton
        label="Forward"
        onClick={onForward}
        disabled={disabled || !canGoForward}
      >
        <ArrowRight size={16} />
      </IconButton>
      <IconButton label="Reload" onClick={onReload} disabled={disabled}>
        <RotateCw size={15} />
      </IconButton>
      <form
        className="ml-1.5 flex h-7 min-w-0 flex-1 items-center bg-shade px-2.5 text-xs focus-within:outline-2 focus-within:-outline-offset-1 focus-within:outline-accent focus-within:outline-dashed"
        onSubmit={(event) => {
          event.preventDefault()
          const address = (draft ?? path).trim()
          setDraft(null)
          event.currentTarget.querySelector('input')?.blur()
          onNavigate(address.startsWith('/') ? address : `/${address}`)
        }}
      >
        {port && (
          <span aria-label={`Port ${port}`} className="shrink-0 text-faint">
            localhost:{port}
          </span>
        )}
        <input
          aria-label="Address"
          value={draft ?? path}
          disabled={disabled}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setDraft(event.currentTarget.value)}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={() => setDraft(null)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') event.currentTarget.blur()
          }}
          className="h-full min-w-0 flex-1 bg-transparent text-dim outline-none focus-visible:outline-none"
        />
      </form>
    </div>
  )
}
