'use client'

import { Download, X } from 'lucide-react'
import { Button, IconButton } from '@/ui/button'
import { Dialog, DialogFooter, DialogHeader, sourceTextarea } from '@/ui/dialog'

export function SourceDialog({
  html,
  onClose,
  onDownload,
}: {
  html: string
  onClose: () => void
  onDownload: () => void
}) {
  return (
    <Dialog label="Website source" onClose={onClose}>
      <DialogHeader>
        <span className="flex-1">index.html</span>
        <IconButton label="Close website source" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </DialogHeader>
      <textarea
        aria-label="Website HTML source"
        readOnly
        value={html}
        spellCheck={false}
        autoFocus
        className={sourceTextarea}
      />
      <DialogFooter>
        <Button variant="accent" onClick={onDownload}>
          <Download size={14} />
          Download
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
