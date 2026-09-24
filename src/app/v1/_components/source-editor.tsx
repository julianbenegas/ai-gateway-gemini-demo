'use client'

import { useState } from 'react'
import type { Editor } from 'tldraw'
import { Button } from '@/ui/button'
import { Dialog, DialogActions, sourceTextarea } from '@/ui/dialog'
import type { WebsiteShape } from './website-shape'

export function SourceEditor({
  editor,
  shape,
  onClose,
}: {
  editor: Editor
  shape: WebsiteShape
  onClose: () => void
}) {
  const [html, setHtml] = useState(shape.props.html)
  const [title, setTitle] = useState(shape.props.title)
  const [error, setError] = useState('')
  const save = () => {
    const current = editor.getShape<WebsiteShape>(shape.id)
    if (!current) {
      setError('This website was deleted. Copy your HTML before closing.')
      return
    }
    if (current.props.html !== shape.props.html) {
      setError(
        'The website changed while you were editing. Copy your changes and reopen its source to merge them.',
      )
      return
    }
    editor.markHistoryStoppingPoint('edit HTML')
    editor.updateShape({
      id: shape.id,
      type: 'website',
      props: { html, title: title.trim() || 'Untitled website' },
    })
    editor.markHistoryStoppingPoint('after edit HTML')
    onClose()
  }
  return (
    <Dialog title="Source" size="lg" onClose={onClose}>
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-6 pt-10">
        <input
          aria-label="Website title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className="h-9 shrink-0 bg-shade px-3 text-dim -outline-offset-1 outline-accent focus:outline-2 focus:outline-dashed"
        />
        <textarea
          aria-label="Website HTML"
          value={html}
          onChange={(event) => setHtml(event.target.value)}
          spellCheck={false}
          data-autofocus
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter')
              save()
          }}
          className={sourceTextarea}
        />
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
        <DialogActions>
          <Button variant="accent" size="lg" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="lg" onClick={save}>
            Apply changes
            <kbd aria-hidden className="text-xs text-white/70">
              ⌘↵
            </kbd>
          </Button>
        </DialogActions>
      </div>
    </Dialog>
  )
}
