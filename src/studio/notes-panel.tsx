import { Trash2, X } from 'lucide-react'
import { IconButton } from '@/ui/button'
import type { AnnotationPosition, SiteAnnotation } from './types'

export function NotesPanel({
  annotations,
  positions,
  pendingIds,
  onDelete,
  onClose,
}: {
  annotations: SiteAnnotation[]
  positions: AnnotationPosition[]
  pendingIds: string[]
  onDelete: (id: string) => void
  onClose: () => void
}) {
  return (
    <aside
      data-notes
      aria-label="Annotations"
      className="absolute top-3 right-3 z-10 max-h-[calc(100%-120px)] w-72 overflow-auto bg-background shadow-lg shadow-black/15"
    >
      <header className="sticky top-0 flex h-9 items-center justify-between bg-shade pr-0.5 pl-3 text-xs font-medium text-dim uppercase">
        Annotations
        <IconButton label="Close annotations" size="icon-sm" onClick={onClose}>
          <X size={14} />
        </IconButton>
      </header>
      {annotations.map((annotation, index) => (
        <article key={annotation.id} className="px-3 py-2.5">
          <div className="flex items-center gap-2 text-xs text-faint">
            <span className="grid size-5 place-items-center bg-bright font-medium text-background">
              {index + 1}
            </span>
            <span>&lt;{annotation.target.tag}&gt;</span>
            <IconButton
              label={`Delete annotation ${index + 1}`}
              size="icon-sm"
              variant="danger"
              className="ml-auto"
              disabled={pendingIds.includes(annotation.id)}
              onClick={() => onDelete(annotation.id)}
            >
              <Trash2 size={13} />
            </IconButton>
          </div>
          <p className="my-1.5 text-dim">
            {annotation.comment ||
              (annotation.drawing ? 'Freehand drawing' : '')}
          </p>
          <small className="block truncate text-xs text-faint">
            {annotation.target.text.trim() || annotation.target.selector}
            {positions.find((position) => position.id === annotation.id)
              ?.attached === false && ' · Element changed'}
          </small>
        </article>
      ))}
    </aside>
  )
}
