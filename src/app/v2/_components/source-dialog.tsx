'use client'

import { useState } from 'react'
import { Download } from 'lucide-react'
import type { SiteFiles } from '../_lib/files'
import { Button } from '@/ui/button'
import { Dialog, DialogActions, sourceTextarea } from '@/ui/dialog'

export function SourceDialog({
  files,
  initialPath,
  onClose,
  onDownload,
}: {
  files: SiteFiles
  /** The file to show first, like the page the preview shows. */
  initialPath: string
  onClose: () => void
  onDownload: () => void
}) {
  const paths = Object.keys(files).sort()
  const [path, setPath] = useState(
    Object.hasOwn(files, initialPath) ? initialPath : paths[0],
  )
  return (
    <Dialog title="Source" size="lg" onClose={onClose}>
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-6 pt-10">
        <nav aria-label="Files" className="flex flex-wrap gap-1">
          {paths.map((file) => (
            <Button
              key={file}
              size="sm"
              aria-pressed={file === path}
              onClick={() => setPath(file)}
            >
              {file}
            </Button>
          ))}
        </nav>
        <textarea
          aria-label={`Source of ${path}`}
          readOnly
          value={files[path] ?? ''}
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
