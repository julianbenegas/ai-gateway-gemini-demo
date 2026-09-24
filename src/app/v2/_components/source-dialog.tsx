'use client'

import { Download } from 'lucide-react'
import { Button } from '@/ui/button'
import { Dialog, DialogActions, sourceTextarea } from '@/ui/dialog'

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
    <Dialog title="index.html" size="lg" onClose={onClose}>
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-6 pt-10">
        <textarea
          aria-label="Website HTML source"
          readOnly
          value={html}
          spellCheck={false}
          data-autofocus
          className={sourceTextarea}
        />
        <DialogActions>
          <Button variant="primary" size="lg" onClick={onDownload}>
            <Download size={14} />
            Download
          </Button>
        </DialogActions>
      </div>
    </Dialog>
  )
}
