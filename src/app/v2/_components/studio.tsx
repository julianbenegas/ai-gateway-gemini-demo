'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { download } from '@/lib/download'
import { Button } from '@/ui/button'
import { Notice } from '@/ui/notice'
import { sidebarCookie } from '@/ui/sidebar'
import { useSidebarWidth } from '@/ui/sidebar-resizer'
import type { Experimental_RealtimeSessionConfig } from 'ai'
import { sitePreview } from '../_lib/preview'
import { studioApi } from '../_lib/rpc'
import { editSchema, STUDIO_INSTRUCTIONS } from '../_lib/tools'
import { useVoiceAgent } from '../_lib/use-voice-agent'
import { DesignList } from './design-list'
import { NotesPanel } from './notes-panel'
import { SourceDialog } from './source-dialog'
import { StudioDock, type StudioMode } from './studio-dock'
import { StudioHeader } from './studio-header'
import type {
  AnnotationPosition,
  Design,
  ElementTarget,
  SiteAnnotation,
  SiteDocument,
} from '../_lib/types'

const LAST_DESIGN = 'margin-v2-design'
const configuration = {
  instructions: STUDIO_INSTRUCTIONS,
  voice: 'Aoede',
  outputModalities: ['audio'],
  inputAudioFormat: { type: 'audio/pcm', rate: 16000 },
  outputAudioFormat: { type: 'audio/pcm', rate: 24000 },
  turnDetection: { type: 'server-vad' },
} satisfies Experimental_RealtimeSessionConfig
const labels = {
  read_selection: 'Looking at your selection',
  read_html: 'Reading the website',
  edit_html: 'Updating the website',
  write_html: 'Rewriting the website',
}

type PendingQuery = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export function Studio({
  sidebarWidth: initialWidth,
}: {
  sidebarWidth: number
}) {
  const [site, setSite] = useState<SiteDocument | null>(null)
  const [designs, setDesigns] = useState<Design[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useSidebarWidth(
    sidebarCookie.v2,
    initialWidth,
  )
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<StudioMode>('browse')
  const [selection, setSelection] = useState<ElementTarget | null>(null)
  const [positions, setPositions] = useState<AnnotationPosition[]>([])
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

  // Refs let async work check what is current without stale closures.
  const navigation = useRef(0)
  const frame = useRef<HTMLIFrameElement>(null)
  const port = useRef<MessagePort | null>(null)
  const snapshot = useRef({ site, mode, selection, annotations })
  snapshot.current = { site, mode, selection, annotations }
  const initializing = useRef<Promise<SiteDocument> | null>(null)
  const mutations = useRef<Promise<unknown>>(Promise.resolve())
  const queries = useRef(new Map<string, PendingQuery>())

  const showSite = (next: SiteDocument) => {
    snapshot.current.site = next
    setSite(next)
    if (next.id) localStorage.setItem(LAST_DESIGN, next.id)
  }
  const fail = (error: unknown) =>
    setError(error instanceof Error ? error.message : String(error))

  const load = useCallback(async () => {
    const version = navigation.current
    try {
      const designs = await studioApi.designs()
      if (version !== navigation.current) return
      setDesigns(designs)
      const saved = localStorage.getItem(LAST_DESIGN)
      const id =
        designs.find((design) => design.id === saved)?.id ??
        designs[0]?.id ??
        null
      const site = await studioApi.site(id)
      if (version !== navigation.current) return
      setSite(site)
      setError(null)
    } catch (error) {
      fail(error)
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const ensureSite = useCallback(async () => {
    if (snapshot.current.site?.persisted) return snapshot.current.site
    initializing.current ??= studioApi
      .createDesign()
      .then(async (site) => {
        showSite(site)
        setDesigns(await studioApi.designs())
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
          const annotations = await studioApi.saveAnnotation(
            site.id,
            annotation,
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
        fail(error)
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
              'The preview did not respond. You can still read and edit the source.',
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
      if (name === 'read_html') {
        await mutations.current.catch(() => {})
        return { html: snapshot.current.site?.html ?? '' }
      }
      if (name === 'edit_html' || name === 'write_html')
        return mutate(async () => {
          if (signal.aborted) return { error: 'The voice session has ended.' }
          const version = navigation.current
          setSaving(true)
          try {
            const { site, matches, missed } = await studioApi.editSite(
              snapshot.current.site?.id ?? null,
              editSchema.parse(args),
              signal,
            )
            if (version === navigation.current) showSite(site)
            return { ok: true, matches, ...(missed && { html: site.html }) }
          } finally {
            setSaving(false)
          }
        })
      return { error: `Unknown tool: ${name}` }
    },
    [mutate, readSelection],
  )

  const voice = useVoiceAgent({
    tokenEndpoint: '/v2/api/realtime',
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
    setNoteOpen(false)
    setNotesOpen(false)
    try {
      await initializing.current?.catch(() => {})
      await mutations.current.catch(() => {})
      const site = await (id ? studioApi.site(id) : studioApi.createDesign())
      if (version !== navigation.current) return
      showSite(site)
      setDraftDrawings([])
      setFailedDrawings([])
      setDesigns(await studioApi.designs())
      setError(null)
    } catch (error) {
      if (version === navigation.current) fail(error)
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

  const rejectQueries = (message: string) => {
    for (const query of queries.current.values()) {
      clearTimeout(query.timer)
      query.reject(new Error(message))
    }
    queries.current.clear()
  }

  const connectPreview = () => {
    port.current?.close()
    rejectQueries('The preview updated. Read the selection again if needed.')
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
      if (data.type === 'open-note') setNotesOpen(true)
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
      rejectQueries('The preview was closed.')
    },
    [],
  )

  const addNote = async (comment: string) => {
    if (!selection) return false
    const annotation: SiteAnnotation = {
      id: crypto.randomUUID(),
      target: selection,
      comment,
    }
    setSaving(true)
    try {
      const site = await ensureSite()
      const annotations = await mutate(() =>
        studioApi.saveAnnotation(site.id, annotation),
      )
      setSite((previous) =>
        previous ? { ...previous, annotations } : previous,
      )
      setNoteOpen(false)
      setError(null)
      return true
    } catch (error) {
      fail(error)
      return false
    } finally {
      setSaving(false)
    }
  }

  const deleteNote = async (id: string) => {
    try {
      const annotations = await mutate(() =>
        studioApi.deleteAnnotation(snapshot.current.site?.id ?? null, id),
      )
      setSite((previous) =>
        previous ? { ...previous, annotations } : previous,
      )
    } catch (error) {
      fail(error)
    }
  }

  const downloadHtml = () => {
    if (site) download('index.html', site.html, 'text/html')
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
    <main
      style={
        {
          '--sidebar': sidebarOpen ? `${sidebarWidth}px` : '0px',
        } as React.CSSProperties
      }
      className="grid h-dvh grid-cols-[var(--sidebar)_1fr] grid-rows-[40px_1fr] max-sm:grid-cols-[0px_1fr]"
    >
      <StudioHeader
        designName={
          designs.find((design) => design.id === site?.id)?.name ?? 'New design'
        }
        status={
          saving || savingDrawings
            ? 'saving'
            : failedDrawings.length
              ? 'failed'
              : site?.persisted
                ? 'saved'
                : null
        }
        disabled={!site}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        onViewSource={() => setSourceOpen(true)}
        onDownload={downloadHtml}
      />
      {sidebarOpen && (
        <DesignList
          designs={designs}
          currentId={site?.id ?? null}
          disabled={opening}
          width={sidebarWidth}
          onResize={setSidebarWidth}
          onOpen={(id) => void openDesign(id)}
        />
      )}
      <div className="relative isolate col-start-2 row-start-2 min-h-0 overflow-hidden">
        {site ? (
          <iframe
            key={navigation.current}
            ref={frame}
            title="Website preview"
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            srcDoc={preview}
            onLoad={connectPreview}
            className="absolute inset-0 size-full bg-white scheme-light"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center gap-3 text-faint">
            <LoaderCircle size={20} className="animate-spin" />
            {error && (
              <Button variant="accent" onClick={() => void load()}>
                Try again
              </Button>
            )}
          </div>
        )}
        {opening && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-background/60 text-faint">
            <LoaderCircle size={20} className="animate-spin" />
          </div>
        )}
        {notice && (
          <Notice
            tone="error"
            className="absolute top-3 left-1/2 -translate-x-1/2"
            action={
              !!failedDrawings.length && (
                <Button
                  size="sm"
                  className="underline"
                  onClick={() => {
                    setError(null)
                    for (const drawing of draftDrawings.filter((draft) =>
                      failedDrawings.includes(draft.id),
                    ))
                      void saveDrawing(drawing)
                  }}
                >
                  Retry save
                </Button>
              )
            }
            onDismiss={() => {
              setError(null)
              voice.setError(null)
              voice.setActivity(null)
            }}
          >
            {notice}
          </Notice>
        )}
        <StudioDock
          voice={voice}
          mode={mode}
          selection={selection}
          noteOpen={noteOpen}
          saving={saving}
          annotationCount={annotations.length}
          canUndoDrawing={!!lastDrawing && !savingDrawings}
          disabled={!site || opening}
          onMode={(next) => {
            setMode(next)
            if (next === 'draw') setNoteOpen(false)
          }}
          onStartVoice={() => {
            setMode((current) => (current === 'draw' ? 'draw' : 'select'))
            void voice.start()
          }}
          onClearSelection={() => setSelection(null)}
          onToggleNote={() => {
            setMode('select')
            setNoteOpen(!noteOpen)
          }}
          onCloseNote={() => setNoteOpen(false)}
          onAddNote={addNote}
          onUndoDrawing={() => {
            if (lastDrawing) void deleteNote(lastDrawing.id)
          }}
          onToggleNotes={() => setNotesOpen(!notesOpen)}
        />
        {notesOpen && (
          <NotesPanel
            annotations={annotations}
            positions={positions}
            pendingIds={draftDrawings.map((draft) => draft.id)}
            onDelete={(id) => void deleteNote(id)}
            onClose={() => setNotesOpen(false)}
          />
        )}
      </div>
      {sourceOpen && site && (
        <SourceDialog
          html={site.html}
          onClose={() => setSourceOpen(false)}
          onDownload={downloadHtml}
        />
      )}
    </main>
  )
}
