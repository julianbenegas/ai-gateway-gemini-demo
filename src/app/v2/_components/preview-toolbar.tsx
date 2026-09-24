'use client'

import { useRef, useState } from 'react'
import { Popover } from '@base-ui/react/popover'
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  LoaderCircle,
  RotateCw,
} from 'lucide-react'
import { Button, IconButton } from '@/ui/button'

// Password managers otherwise offer to fill these in.
const notCredentials = {
  autoComplete: 'off',
  'data-1p-ignore': true,
  'data-lpignore': 'true',
  'data-bwignore': true,
  'data-form-type': 'other',
} as const

/** A browser's controls for the preview: its history, port, and address. */
export function PreviewToolbar({
  port,
  designPort,
  path,
  canGoBack,
  canGoForward,
  disabled,
  onBack,
  onForward,
  onReload,
  onNavigate,
  onOpenPort,
}: {
  /** The port the preview shows, in the design's sandbox. */
  port: number | null
  /** The port of the design's own server. */
  designPort: number | null
  path: string
  canGoBack: boolean
  canGoForward: boolean
  disabled: boolean
  onBack: () => void
  onForward: () => void
  onReload: () => void
  onNavigate: (path: string) => void
  onOpenPort: (port: number) => Promise<void>
}) {
  // What's typed in the address bar, until it's submitted or abandoned.
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <div
      role="group"
      aria-label="Preview"
      className="flex h-11 shrink-0 items-center gap-0.5 px-2"
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
      <div className="ml-2 flex h-8 min-w-0 flex-1 items-center gap-1 bg-shade pr-3 pl-1 has-[input:focus]:outline-2 has-[input:focus]:-outline-offset-1 has-[input:focus]:outline-accent has-[input:focus]:outline-dashed">
        <PortPicker
          port={port}
          designPort={designPort}
          disabled={disabled}
          onOpen={onOpenPort}
        />
        <input
          aria-label="Address"
          value={draft ?? path}
          disabled={disabled}
          spellCheck={false}
          {...notCredentials}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={() => setDraft(null)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') event.currentTarget.blur()
            if (event.key !== 'Enter') return
            const address = event.currentTarget.value.trim()
            event.currentTarget.blur()
            onNavigate(address.startsWith('/') ? address : `/${address}`)
          }}
          className="h-full min-w-0 flex-1 bg-transparent text-dim outline-none focus-visible:outline-none"
        />
      </div>
    </div>
  )
}

/** The port the preview shows, and a form to show another one. */
function PortPicker({
  port,
  designPort,
  disabled,
  onOpen,
}: {
  port: number | null
  designPort: number | null
  disabled: boolean
  onOpen: (port: number) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const show = async (next: number) => {
    setPending(true)
    setError(null)
    try {
      await onOpen(next)
      setOpen(false)
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setPending(false)
    }
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setError(null)
      }}
    >
      <Popover.Trigger
        disabled={disabled || !port}
        aria-label={port ? `Port ${port}` : 'Port'}
        className="flex h-6 shrink-0 items-center gap-1 px-1.5 text-faint transition-colors hover:bg-shade-hover hover:text-dim disabled:opacity-40 data-popup-open:bg-shade-hover data-popup-open:text-dim"
      >
        localhost:{port ?? '…'}
        <ChevronDown size={12} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="bottom"
          align="start"
          sideOffset={8}
          className="z-30"
        >
          <Popover.Popup
            initialFocus={input}
            className="w-64 bg-background p-3 text-xs shadow-lg shadow-black/30 outline-1 -outline-offset-1 outline-shade-hover"
          >
            <form
              className="flex flex-col gap-2.5"
              onSubmit={(event) => {
                event.preventDefault()
                const next = Number(input.current?.value)
                if (Number.isInteger(next) && next > 0 && next < 65536)
                  void show(next)
                else setError('Enter a port from 1 to 65535.')
              }}
            >
              <Popover.Title className="font-medium text-dim uppercase">
                Port
              </Popover.Title>
              <div className="flex gap-1.5">
                <input
                  ref={input}
                  aria-label="Port number"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={65535}
                  defaultValue={port ?? ''}
                  disabled={pending}
                  {...notCredentials}
                  onFocus={(event) => event.currentTarget.select()}
                  className="h-7 min-w-0 flex-1 [appearance:textfield] bg-shade px-2 text-sm text-dim outline-none focus:outline-2 focus:-outline-offset-1 focus:outline-accent focus:outline-dashed [&::-webkit-inner-spin-button]:appearance-none"
                />
                <Button type="submit" variant="accent" disabled={pending}>
                  {pending && (
                    <LoaderCircle size={13} className="animate-spin" />
                  )}
                  Open
                </Button>
              </div>
              {error && (
                <p role="alert" className="text-danger">
                  {error}
                </p>
              )}
              <p className="text-faint">
                {designPort && port !== designPort ? (
                  <>
                    The design is on{' '}
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => void show(designPort)}
                      className="text-dim underline hover:text-bright"
                    >
                      port {designPort}
                    </button>
                    .
                  </>
                ) : (
                  'The design is on this port. Opening another one exposes it on the sandbox.'
                )}
              </p>
            </form>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
