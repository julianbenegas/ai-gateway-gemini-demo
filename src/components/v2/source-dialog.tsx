'use client'

import { useEffect, useRef } from 'react'
import { Check, Download, X } from 'lucide-react'
import type { SiteDocument } from '@/lib/v2/types'

export function SourceDialog({
  site,
  onClose,
  onDownload,
}: {
  site: SiteDocument
  onClose: () => void
  onDownload: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    dialog.current?.showModal()
  }, [])
  return (
    <dialog
      ref={dialog}
      className="v2-modal"
      aria-label="Website source"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === dialog.current) onClose()
      }}
    >
      <header>
        <span>index.html</span>
        <button aria-label="Close website source" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <textarea
        aria-label="Website HTML source"
        readOnly
        value={site.html}
        spellCheck={false}
        autoFocus
      />
      <footer>
        <span>
          <Check size={12} />
          {site.persisted
            ? 'Source stored in Vercel Sandbox'
            : 'Starting point'}
        </span>
        <button onClick={onDownload}>
          <Download size={14} />
          Download
        </button>
      </footer>
    </dialog>
  )
}
