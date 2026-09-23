'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AudioLines,
  Cloud,
  Code2,
  Download,
  LoaderCircle,
  MessageSquarePlus,
  Mic,
  MicOff,
  MousePointer2,
  Pencil,
  PanelLeft,
  Plus,
  Square,
  Trash2,
  Undo2,
  X,
} from 'lucide-react'
import { sessionConfig } from '@/lib/realtime-config'
import { bashSchema, V2_INSTRUCTIONS } from '@/lib/v2/tools'
import { sitePreview } from '@/lib/v2/preview'
import type {
  AnnotationPosition,
  ElementTarget,
  SiteAnnotation,
  SiteDocument,
  Design,
} from '@/lib/v2/types'
import { useVoiceAgent } from '../use-voice-agent'
import { SourceDialog } from './source-dialog'

const configuration = { ...sessionConfig, instructions: V2_INSTRUCTIONS }
const labels = {
  read_selection: 'Looking at your selection',
  bash: 'Working on the website',
}

const designPath = (path: string, id: string | null) =>
  id ? `${path}?designId=${encodeURIComponent(id)}` : path

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error || 'Request failed')
  return body
}

export function SiteStudio() {
  const [site, setSite] = useState<SiteDocument | null>(null)
  const [designs, setDesigns] = useState<Design[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [opening, setOpening] = useState(false)
  const navigation = useRef(0)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'browse' | 'select' | 'draw'>('browse')
  const [selection, setSelection] = useState<ElementTarget | null>(null)
  const [positions, setPositions] = useState<AnnotationPosition[]>([])
  const [note, setNote] = useState('')
  const [noteOpen, setNoteOpen] = useState(false)
  const [sourceOpen, setSourceOpen] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [draftDrawings, setDraftDrawings] = useState<SiteAnnotation[]>([])
  const [failedDrawings, setFailedDrawings] = useState<string[]>([])
  const annotations = useMemo(
    () => [
      ...(site?.annotations ?? []).filter(
        (note) => !draftDrawings.some((draft) => draft.id === note.id),
      ),
      ...draftDrawings,
    ],
    [site?.annotations, draftDrawings],
  )
  const frame = useRef<HTMLIFrameElement>(null)
  const port = useRef<MessagePort | null>(null)
  const snapshot = useRef({ site, mode, selection, annotations })
  snapshot.current = { site, mode, selection, annotations }
  const initializing = useRef<Promise<SiteDocument> | null>(null)
  const mutations = useRef<Promise<unknown>>(Promise.resolve())
  const queries = useRef(
    new Map<
      string,
      {
        resolve: (value: unknown) => void
        reject: (error: Error) => void
        timer: ReturnType<typeof setTimeout>
      }
    >(),
  )

  const load = useCallback(async () => {
    const version = navigation.current
    try {
      const designs = await request<Design[]>('/api/v2/designs')
      if (version !== navigation.current) return
      setDesigns(designs)
      const saved = localStorage.getItem('margin-v2-design')
      const id =
        designs.find((design) => design.id === saved)?.id ??
        designs[0]?.id ??
        null
      const site = await request<SiteDocument>(designPath('/api/v2/site', id))
      if (version !== navigation.current) return
      setSite(site)
      setError(null)
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const ensureSite = useCallback(async () => {
    if (snapshot.current.site?.persisted) return snapshot.current.site
    if (!initializing.current)
      initializing.current = request<SiteDocument>('/api/v2/site', {
        method: 'POST',
      })
        .then(async (site) => {
          snapshot.current.site = site
          setSite(site)
          if (site.id) localStorage.setItem('margin-v2-design', site.id)
          setDesigns(await request<Design[]>('/api/v2/designs'))
          return site
        })
        .finally(() => {
          initializing.current = null
        })
    return initializing.current
  }, [])

  const mutate = useCallback(<T,>(task: () => Promise<T>) => {
    const next = mutations.current.catch(() => {}).then(task)
    mutations.current = next
    return next
  }, [])

  const saveDrawing = useCallback(
    async (annotation: SiteAnnotation) => {
      const version = navigation.current
      setFailedDrawings((previous) =>
        previous.filter((id) => id !== annotation.id),
      )
      try {
        await mutate(async () => {
          const site = await ensureSite()
          const annotations = await request<SiteAnnotation[]>(
            designPath('/api/v2/annotations', site.id),
            {
              method: 'POST',
              body: JSON.stringify(annotation),
            },
          )
          if (version === navigation.current)
            setSite((previous) =>
              previous ? { ...previous, annotations } : previous,
            )
          setDraftDrawings((previous) =>
            previous.filter((draft) => draft.id !== annotation.id),
          )
        })
      } catch (error) {
        setFailedDrawings((previous) => [...previous, annotation.id])
        setError(error instanceof Error ? error.message : String(error))
      }
    },
    [ensureSite, mutate],
  )

  const readSelection = useCallback(
    () =>
      new Promise<unknown>((resolve, reject) => {
        if (!port.current) {
          reject(
            new Error(
              'The preview is loading. Try reading the selection again.',
            ),
          )
          return
        }
        const requestId = crypto.randomUUID()
        const timer = setTimeout(() => {
          queries.current.delete(requestId)
          reject(
            new Error(
              'The preview did not respond. You can still read and edit index.html.',
            ),
          )
        }, 5000)
        queries.current.set(requestId, { resolve, reject, timer })
        port.current.postMessage({ type: 'read_selection', requestId })
      }),
    [],
  )

  const executeTool = useCallback(
    async (name: string, args: unknown, signal: AbortSignal) => {
      if (name === 'read_selection') return readSelection()
      if (name === 'bash')
        return mutate(async () => {
          if (signal.aborted) return { error: 'The voice session has ended.' }
          const id = snapshot.current.site?.id ?? null
          const version = navigation.current
          const input = {
            ...bashSchema.parse(args),
            executionId: crypto.randomUUID(),
          }
          let cancellation: Promise<unknown> | undefined
          const cancel = () => {
            cancellation = request(designPath('/api/v2/bash', id), {
              method: 'DELETE',
              body: JSON.stringify({ executionId: input.executionId }),
              keepalive: true,
            }).catch((error) => {
              setError(
                `Could not stop the command: ${error instanceof Error ? error.message : String(error)}`,
              )
            })
          }
          signal.addEventListener('abort', cancel, { once: true })
          setSaving(true)
          try {
            const result = await request<{
              site: SiteDocument | null
              exitCode: number
              stdout: string
              stderr: string
              previewError: string | null
            }>(designPath('/api/v2/bash', id), {
              method: 'POST',
              body: JSON.stringify(input),
              signal,
            })
            const { site, ...output } = result
            if (site && version === navigation.current) setSite(site)
            return output
          } finally {
            signal.removeEventListener('abort', cancel)
            if (cancellation) {
              await cancellation
              try {
                const site = await request<SiteDocument>(
                  designPath('/api/v2/site', id),
                )
                if (version === navigation.current) setSite(site)
              } catch {}
            }
            setSaving(false)
          }
        })
      return { error: `Unknown tool: ${name}` }
    },
    [mutate, readSelection],
  )

  const voice = useVoiceAgent({
    tokenEndpoint: '/api/v2/realtime',
    configuration,
    labels,
    beforeConnect: ensureSite,
    executeTool,
  })
  const openDesign = async (id: string | null) => {
    const version = ++navigation.current
    voice.end()
    setOpening(true)
    setSelection(null)
    setNote('')
    setNoteOpen(false)
    setNotesOpen(false)
    try {
      await initializing.current?.catch(() => {})
      await mutations.current.catch(() => {})
      const site = await request<SiteDocument>(
        designPath('/api/v2/site', id),
        id ? {} : { method: 'POST' },
      )
      if (version !== navigation.current) return
      snapshot.current.site = site
      setSite(site)
      setDraftDrawings([])
      setFailedDrawings([])
      setDesigns(await request<Design[]>('/api/v2/designs'))
      if (site.id) localStorage.setItem('margin-v2-design', site.id)
      setError(null)
    } catch (error) {
      if (version === navigation.current)
        setError(error instanceof Error ? error.message : String(error))
    } finally {
      if (version === navigation.current) setOpening(false)
    }
  }
  const preview = useMemo(
    () => (site ? sitePreview(site.html, window.location.origin) : ''),
    [site?.html],
  )

  const sendState = useCallback(() => {
    const current = snapshot.current
    port.current?.postMessage({
      type: 'state',
      mode: current.mode,
      selectedId: current.selection?.id ?? null,
      annotations: current.annotations,
    })
  }, [])
  useEffect(sendState, [mode, selection?.id, annotations, sendState])

  const connectPreview = () => {
    port.current?.close()
    for (const query of queries.current.values()) {
      clearTimeout(query.timer)
      query.reject(
        new Error('The preview updated. Read the selection again if needed.'),
      )
    }
    queries.current.clear()
    const channel = new MessageChannel()
    port.current = channel.port1
    channel.port1.onmessage = ({ data }) => {
      if (data.type === 'ready') sendState()
      if (data.type === 'selection') {
        setSelection(data.selection)
        setNoteOpen(false)
      }
      if (data.type === 'refresh-selection') setSelection(data.selection)
      if (data.type === 'drawing') {
        setDraftDrawings((previous) => [...previous, data.annotation])
        void saveDrawing(data.annotation)
      }
      if (data.type === 'browse') setMode('browse')
      if (data.type === 'positions') setPositions(data.positions)
      if (data.type === 'open-note') {
        setNotesOpen(true)
      }
      if (data.type === 'context') {
        const query = queries.current.get(data.requestId)
        if (query) {
          clearTimeout(query.timer)
          queries.current.delete(data.requestId)
          query.resolve({
            selection: data.selection,
            annotations: data.annotations,
            viewport: data.viewport,
          })
        }
        setSelection(data.selection)
      }
    }
    frame.current?.contentWindow?.postMessage({ type: 'margin:v2:init' }, '*', [
      channel.port2,
    ])
  }
  useEffect(
    () => () => {
      port.current?.close()
      for (const query of queries.current.values()) {
        clearTimeout(query.timer)
        query.reject(new Error('The preview was closed.'))
      }
      queries.current.clear()
    },
    [],
  )

  const addNote = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!selection || !note.trim()) return
    const annotation: SiteAnnotation = {
      id: crypto.randomUUID(),
      target: selection,
      comment: note.trim(),
    }
    setSaving(true)
    try {
      const site = await ensureSite()
      const annotations = await mutate(() =>
        request<SiteAnnotation[]>(designPath('/api/v2/annotations', site.id), {
          method: 'POST',
          body: JSON.stringify(annotation),
        }),
      )
      setSite((previous) =>
        previous ? { ...previous, annotations } : previous,
      )
      setNote('')
      setNoteOpen(false)
      setError(null)
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  const deleteNote = async (id: string) => {
    try {
      const annotations = await mutate(() =>
        request<SiteAnnotation[]>(
          designPath('/api/v2/annotations', snapshot.current.site?.id ?? null),
          {
            method: 'DELETE',
            body: JSON.stringify({ id }),
          },
        ),
      )
      setSite((previous) =>
        previous ? { ...previous, annotations } : previous,
      )
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    }
  }

  const download = () => {
    if (!site) return
    const url = URL.createObjectURL(
      new Blob([site.html], { type: 'text/html' }),
    )
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'index.html'
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const notice =
    error ||
    voice.error ||
    (voice.activity?.state === 'error' ? voice.activity.label : null)
  const savingDrawings = draftDrawings.length > failedDrawings.length
  const lastDrawing = site?.annotations.findLast(
    (annotation) => annotation.drawing,
  )
  return (
    <main className="v2-studio" data-sidebar-open={sidebarOpen}>
      <header className="v2-header">
        <button
          aria-label="Toggle designs"
          title="Designs"
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          <PanelLeft size={17} />
        </button>
        <a href="/v2" className="v2-brand">
          <span className="v2-mark">Ⅱ</span> margin{' '}
          <span className="v2-version">/ v2</span>
        </a>
        <span className="v2-file">
          {designs.find((design) => design.id === site?.id)?.name ??
            'New design'}
        </span>
        <div className="v2-header-actions">
          <span className="v2-save-state">
            {saving || savingDrawings ? (
              <LoaderCircle size={13} className="spin" />
            ) : site?.persisted ? (
              <Cloud size={13} />
            ) : null}
            {saving || savingDrawings
              ? 'Saving…'
              : failedDrawings.length
                ? 'Drawing not saved'
                : site?.persisted
                  ? 'Saved remotely'
                  : ''}
          </span>
          <button
            aria-label="View website source"
            title="View source"
            onClick={() => setSourceOpen(true)}
            disabled={!site}
          >
            <Code2 size={16} />
          </button>
          <button
            aria-label="Download HTML"
            title="Download HTML"
            onClick={download}
            disabled={!site}
          >
            <Download size={16} />
          </button>
        </div>
      </header>
      {sidebarOpen && (
        <aside className="v2-designs" aria-label="Designs">
          <header>
            <span>Designs</span>
            <button
              aria-label="New design"
              title="New design"
              disabled={opening}
              onClick={() => void openDesign(null)}
            >
              <Plus size={16} />
            </button>
          </header>
          {designs.map((design) => (
            <button
              key={design.id}
              className="v2-design"
              aria-current={site?.id === design.id ? 'page' : undefined}
              disabled={opening}
              onClick={() => void openDesign(design.id)}
            >
              {design.name}
            </button>
          ))}
          {!designs.length && <p>Your designs will appear here.</p>}
        </aside>
      )}
      {site ? (
        <iframe
          key={navigation.current}
          ref={frame}
          className="v2-preview"
          title="Website preview"
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          srcDoc={preview}
          onLoad={connectPreview}
        />
      ) : (
        <div className="v2-loading">
          <LoaderCircle className="spin" size={20} />
          <span>Opening your site…</span>
          {error && <button onClick={() => void load()}>Try again</button>}
        </div>
      )}
      {opening && (
        <div className="v2-opening">
          <LoaderCircle size={20} className="spin" />
        </div>
      )}
      {notice && (
        <div className="v2-notice" role="alert">
          <span>{notice}</span>
          {!!failedDrawings.length && (
            <button
              className="v2-retry"
              onClick={() => {
                setError(null)
                for (const drawing of draftDrawings.filter((draft) =>
                  failedDrawings.includes(draft.id),
                ))
                  void saveDrawing(drawing)
              }}
            >
              Retry save
            </button>
          )}
          <button
            aria-label="Dismiss notification"
            onClick={() => {
              setError(null)
              voice.setError(null)
              voice.setActivity(null)
            }}
          >
            <X size={14} />
          </button>
        </div>
      )}
      <div className="v2-dock">
        {selection && mode === 'select' && (
          <div className="v2-selection">
            <span>&lt;{selection.tag}&gt;</span>
            <span>{selection.text.trim() || selection.tag}</span>
            <button
              aria-label="Clear selection"
              onClick={() => setSelection(null)}
            >
              <X size={12} />
            </button>
          </div>
        )}
        {noteOpen && selection && (
          <form className="v2-note-editor" onSubmit={addNote}>
            <label htmlFor="v2-note">Note on this {selection.tag}</label>
            <textarea
              id="v2-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="What should change here?"
              autoFocus
            />
            <div>
              <button type="button" onClick={() => setNoteOpen(false)}>
                Cancel
              </button>
              <button type="submit" disabled={saving || !note.trim()}>
                Add note
              </button>
            </div>
          </form>
        )}
        <div className="v2-toolbar">
          {voice.connected ? (
            <>
              <span className="v2-voice-state" role="status">
                <i className={voice.isCapturing ? 'live' : ''} />
                {voice.state}
              </span>
              <button
                aria-label={
                  voice.isCapturing ? 'Mute microphone' : 'Unmute microphone'
                }
                onClick={voice.mute}
              >
                {voice.isCapturing ? <Mic size={17} /> : <MicOff size={17} />}
              </button>
              <button aria-label="End voice session" onClick={voice.end}>
                <Square size={13} fill="currentColor" />
              </button>
            </>
          ) : voice.busy ? (
            <>
              <span className="v2-voice-state" role="status">
                <LoaderCircle size={15} className="spin" />
                {voice.requestingMic ? 'Microphone…' : 'Connecting…'}
              </span>
              <button aria-label="Cancel voice connection" onClick={voice.end}>
                <X size={16} />
              </button>
            </>
          ) : (
            <button
              className="v2-talk"
              aria-label="Talk and annotate"
              onClick={() => {
                setMode((current) => (current === 'draw' ? 'draw' : 'select'))
                void voice.start()
              }}
              disabled={!site || opening}
            >
              <AudioLines size={18} />
              <span>Talk & annotate</span>
            </button>
          )}
          <span className="v2-divider" />
          <button
            aria-label="Select an element"
            title="Select an element"
            aria-pressed={mode === 'select'}
            onClick={() => setMode(mode === 'select' ? 'browse' : 'select')}
          >
            <MousePointer2 size={17} />
          </button>
          <button
            aria-label="Draw on the website"
            title="Draw on the website"
            aria-pressed={mode === 'draw'}
            onClick={() => {
              setMode(mode === 'draw' ? 'browse' : 'draw')
              setNoteOpen(false)
            }}
          >
            <Pencil size={17} />
          </button>
          {mode === 'draw' && (
            <button
              aria-label="Undo drawing"
              title="Undo last drawing"
              disabled={!lastDrawing || savingDrawings}
              onClick={() => {
                if (lastDrawing) void deleteNote(lastDrawing.id)
              }}
            >
              <Undo2 size={17} />
            </button>
          )}
          <button
            aria-label="Add annotation"
            title="Add a note to the selected element"
            disabled={!selection}
            onClick={() => {
              setMode('select')
              setNoteOpen(!noteOpen)
            }}
          >
            <MessageSquarePlus size={17} />
          </button>
          {!!annotations.length && (
            <button
              className="v2-note-count"
              aria-label="Show annotations"
              onClick={() => setNotesOpen(!notesOpen)}
            >
              {annotations.length}
            </button>
          )}
        </div>
        <p className="v2-hint">
          {mode === 'draw'
            ? 'Draw what you mean. Scroll to keep exploring. Esc to browse.'
            : mode === 'select'
              ? 'Point to something. Say what you have in mind.'
              : 'A website you can talk to.'}
        </p>
      </div>
      {notesOpen && (
        <aside className="v2-notes">
          <header>
            <span>Annotations</span>
            <button
              aria-label="Close annotations"
              onClick={() => setNotesOpen(false)}
            >
              <X size={16} />
            </button>
          </header>
          {annotations.map((annotation, index) => (
            <article key={annotation.id}>
              <div>
                <span className="v2-note-number">{index + 1}</span>
                <span>{annotation.target.tag}</span>
                <button
                  aria-label={`Delete annotation ${index + 1}`}
                  disabled={draftDrawings.some(
                    (draft) => draft.id === annotation.id,
                  )}
                  onClick={() => void deleteNote(annotation.id)}
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <p>
                {annotation.comment ||
                  (annotation.drawing ? 'Freehand drawing' : '')}
              </p>
              <small>
                {annotation.target.text.trim() || annotation.target.selector}
                {positions.find((position) => position.id === annotation.id)
                  ?.attached === false && ' · Element changed'}
              </small>
            </article>
          ))}
        </aside>
      )}
      {sourceOpen && site && (
        <SourceDialog
          site={site}
          onClose={() => setSourceOpen(false)}
          onDownload={download}
        />
      )}
    </main>
  )
}
