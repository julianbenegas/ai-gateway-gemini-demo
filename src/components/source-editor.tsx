'use client'

import { useEffect, useRef, useState } from 'react'
import { Code2, X } from 'lucide-react'
import type { Editor } from 'tldraw'
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
  const dialog = useRef<HTMLDialogElement>(null)
  const [html, setHtml] = useState(shape.props.html)
  const [title, setTitle] = useState(shape.props.title)
  const [error, setError] = useState('')
  useEffect(() => {
    dialog.current?.showModal()
  }, [])
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
    <dialog
      ref={dialog}
      className="source-dialog"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === dialog.current) onClose()
      }}
    >
      <div className="source-header">
        <Code2 size={18} />
        <input
          aria-label="Website title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close source editor"
        >
          <X size={18} />
        </button>
      </div>
      <textarea
        aria-label="Website HTML"
        value={html}
        onChange={(event) => setHtml(event.target.value)}
        spellCheck={false}
        autoFocus
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') save()
        }}
      />
      {error && (
        <div className="source-error" role="alert">
          {error}
        </div>
      )}
      <div className="source-footer">
        <span>HTML, CSS & JavaScript · ⌘ Enter to apply</span>
        <div>
          <button className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" onClick={save}>
            Apply changes
          </button>
        </div>
      </div>
    </dialog>
  )
}
