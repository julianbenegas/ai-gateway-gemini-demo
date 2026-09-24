'use client'

import { useState } from 'react'
import { Code2, X } from 'lucide-react'
import type { Editor } from 'tldraw'
import { Button, IconButton } from '@/ui/button'
import { Dialog, DialogFooter, DialogHeader, sourceTextarea } from '@/ui/dialog'
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
    <Dialog label="Website source" onClose={onClose}>
      <DialogHeader>
        <Code2 size={16} className="text-faint" />
        <input
          aria-label="Website title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className="min-w-0 flex-1 bg-transparent py-1 outline-none"
        />
        <IconButton label="Close source editor" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </DialogHeader>
      <textarea
        aria-label="Website HTML"
        value={html}
        onChange={(event) => setHtml(event.target.value)}
        spellCheck={false}
        autoFocus
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') save()
        }}
        className={sourceTextarea}
      />
      {error && (
        <div
          role="alert"
          className="bg-danger/10 px-4 py-2 text-xs text-danger"
        >
          {error}
        </div>
      )}
      <DialogFooter>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="accent" onClick={save}>
          Apply changes
          <kbd aria-hidden className="text-xs text-accent/60">
            ⌘↵
          </kbd>
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
