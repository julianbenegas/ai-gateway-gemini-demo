'use client'

import { useEffect, useRef } from 'react'

export function Dialog({
  label,
  onClose,
  children,
}: {
  label: string
  onClose: () => void
  children: React.ReactNode
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    dialog.current?.showModal()
  }, [])
  return (
    <dialog
      ref={dialog}
      aria-label={label}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === dialog.current) onClose()
      }}
      className="m-auto h-[min(780px,90dvh)] w-[min(1000px,calc(100vw-32px))] max-w-none flex-col bg-background p-0 text-muted shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm open:flex"
    >
      {children}
    </dialog>
  )
}

export function DialogHeader({ children }: { children: React.ReactNode }) {
  return (
    <header className="flex h-10 shrink-0 items-center gap-3 bg-shade pr-1 pl-4 font-semibold text-dim">
      {children}
    </header>
  )
}

export function DialogFooter({ children }: { children: React.ReactNode }) {
  return (
    <footer className="flex shrink-0 items-center justify-end gap-2 p-2">
      {children}
    </footer>
  )
}

export const sourceTextarea =
  'min-h-0 flex-1 resize-none bg-background p-4 font-mono text-xs/relaxed text-dim outline-none'
