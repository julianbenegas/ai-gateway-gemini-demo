'use client'

import { useState } from 'react'
import {
  MessageSquarePlus,
  MousePointer2,
  Pencil,
  Undo2,
  X,
} from 'lucide-react'
import { Button, IconButton } from '@/ui/button'
import type { VoiceAgent } from '@/voice/use-voice-agent'
import { VoiceControls } from '@/voice/voice-controls'
import type { ElementTarget } from './types'

export type StudioMode = 'browse' | 'select' | 'draw'

const panel = 'bg-background shadow-lg shadow-black/15'

export function StudioDock({
  voice,
  mode,
  selection,
  noteOpen,
  saving,
  annotationCount,
  canUndoDrawing,
  disabled,
  onMode,
  onStartVoice,
  onClearSelection,
  onToggleNote,
  onCloseNote,
  onAddNote,
  onUndoDrawing,
  onToggleNotes,
}: {
  voice: VoiceAgent
  mode: StudioMode
  selection: ElementTarget | null
  noteOpen: boolean
  saving: boolean
  annotationCount: number
  canUndoDrawing: boolean
  disabled: boolean
  onMode: (mode: StudioMode) => void
  onStartVoice: () => void
  onClearSelection: () => void
  onToggleNote: () => void
  onCloseNote: () => void
  onAddNote: (comment: string) => Promise<boolean>
  onUndoDrawing: () => void
  onToggleNotes: () => void
}) {
  return (
    <div className="absolute bottom-4 left-1/2 z-10 flex max-w-[calc(100%-24px)] -translate-x-1/2 flex-col items-center gap-2">
      {selection && mode === 'select' && (
        <div
          data-selection
          className={`flex max-w-sm items-center gap-2 py-0.5 pr-0.5 pl-2.5 text-xs ${panel}`}
        >
          <span className="shrink-0 text-accent">&lt;{selection.tag}&gt;</span>
          <span className="truncate text-dim">
            {selection.text.trim() || selection.tag}
          </span>
          <IconButton
            label="Clear selection"
            size="icon-sm"
            onClick={onClearSelection}
          >
            <X size={12} />
          </IconButton>
        </div>
      )}
      {noteOpen && selection && (
        <NoteEditor
          tag={selection.tag}
          saving={saving}
          onCancel={onCloseNote}
          onAdd={onAddNote}
        />
      )}
      <div
        className={`flex items-center gap-0.5 p-1 whitespace-nowrap ${panel}`}
      >
        <VoiceControls
          voice={voice}
          label="Talk"
          ariaLabel="Talk and annotate"
          onStart={onStartVoice}
          disabled={disabled}
        />
        <span className="w-1" />
        <IconButton
          label="Select an element"
          aria-pressed={mode === 'select'}
          onClick={() => onMode(mode === 'select' ? 'browse' : 'select')}
        >
          <MousePointer2 size={16} />
        </IconButton>
        <IconButton
          label="Draw on the website"
          aria-pressed={mode === 'draw'}
          onClick={() => onMode(mode === 'draw' ? 'browse' : 'draw')}
        >
          <Pencil size={16} />
        </IconButton>
        {mode === 'draw' && (
          <IconButton
            label="Undo drawing"
            disabled={!canUndoDrawing}
            onClick={onUndoDrawing}
          >
            <Undo2 size={16} />
          </IconButton>
        )}
        <IconButton
          label="Add annotation"
          disabled={!selection}
          onClick={onToggleNote}
        >
          <MessageSquarePlus size={16} />
        </IconButton>
        {!!annotationCount && (
          <Button
            aria-label="Show annotations"
            className="min-w-8 tabular-nums"
            onClick={onToggleNotes}
          >
            {annotationCount}
          </Button>
        )}
      </div>
    </div>
  )
}

function NoteEditor({
  tag,
  saving,
  onCancel,
  onAdd,
}: {
  tag: string
  saving: boolean
  onCancel: () => void
  onAdd: (comment: string) => Promise<boolean>
}) {
  const [note, setNote] = useState('')
  return (
    <form
      className={`w-[min(340px,calc(100vw-32px))] p-2 ${panel}`}
      onSubmit={async (event) => {
        event.preventDefault()
        if (note.trim() && (await onAdd(note.trim()))) setNote('')
      }}
    >
      <label htmlFor="note" className="sr-only">
        Note on this {tag}
      </label>
      <textarea
        id="note"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        autoFocus
        className="block min-h-20 w-full resize-y bg-accent/5 p-2 text-sm text-accent outline-2 -outline-offset-1 outline-accent outline-dotted focus:outline-dashed"
      />
      <div className="mt-2 flex justify-end gap-1">
        <Button onClick={onCancel}>Cancel</Button>
        <Button
          type="submit"
          variant="accent"
          disabled={saving || !note.trim()}
        >
          Add note
        </Button>
      </div>
    </form>
  )
}
