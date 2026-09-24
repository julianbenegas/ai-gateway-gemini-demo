'use client'

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Button, IconButton } from './button'
import { cx } from './cx'

const sizes = {
  sm: 'w-[min(32rem,calc(100vw-32px))]',
  lg: 'h-[min(780px,90dvh)] w-[min(1000px,calc(100vw-32px))]',
}

/**
 * A modal after forums.basehub.com: a bordered frame with its title set into
 * the top border and a dotted shadow. Escape and the backdrop close it.
 */
export function Dialog({
  title,
  size = 'sm',
  onClose,
  children,
}: {
  title: string
  size?: keyof typeof sizes
  onClose: () => void
  children: React.ReactNode
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    dialog.current?.showModal()
    // showModal focuses the first control, the close button; prefer the one
    // marked autoFocus, which React tracks without an attribute.
    dialog.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus()
  }, [])
  return (
    <dialog
      ref={dialog}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === dialog.current) onClose()
      }}
      className={cx(
        'm-auto max-h-none max-w-none overflow-visible bg-transparent p-0 text-muted backdrop:bg-background/60',
        sizes[size],
      )}
    >
      <div className="relative size-full">
        <div
          aria-hidden
          className="absolute top-2.5 left-2.5 size-full dot-grid"
        />
        <div className="relative flex size-full flex-col border border-dim bg-background">
          <span className="absolute -top-3.5 left-4 bg-background px-2 text-lg/7 font-bold tracking-normal text-bright">
            {title}
          </span>
          <IconButton
            label="Close"
            size="icon-sm"
            onClick={onClose}
            className="absolute top-2 right-2"
          >
            <X size={14} />
          </IconButton>
          {children}
        </div>
      </div>
    </dialog>
  )
}

export function DialogActions({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex shrink-0 items-center justify-end gap-2">
      {children}
    </div>
  )
}

/** Asks before something permanent. An error from `onConfirm` shows inside. */
export function ConfirmDialog({
  title,
  confirmLabel,
  onConfirm,
  onClose,
  children,
}: {
  title: string
  confirmLabel: string
  onConfirm: () => Promise<void>
  onClose: () => void
  children: React.ReactNode
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const close = () => {
    if (!pending) onClose()
  }
  return (
    <Dialog title={title} onClose={close}>
      <div className="flex flex-col gap-4 p-6 pt-8">
        <p>{children}</p>
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
        <DialogActions>
          <Button variant="accent" size="lg" disabled={pending} onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="lg"
            data-autofocus
            disabled={pending}
            onClick={async () => {
              setPending(true)
              setError(null)
              try {
                await onConfirm()
              } catch (error) {
                setError(error instanceof Error ? error.message : String(error))
                setPending(false)
              }
            }}
          >
            {pending ? `${confirmLabel}…` : confirmLabel}
          </Button>
        </DialogActions>
      </div>
    </Dialog>
  )
}

export const sourceTextarea =
  'min-h-0 flex-1 resize-none bg-shade p-4 font-mono text-xs/relaxed text-dim outline-none'
