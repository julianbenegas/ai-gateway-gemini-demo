'use client'

import type { ThinkingLevel } from '@/lib/models'
import { LoaderCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { download } from '@/lib/download'
import { Button } from '@/ui/button'
import { ConfirmDialog } from '@/ui/dialog'
import { EmptyState } from '@/ui/empty-state'
import { Notice } from '@/ui/notice'
import { preferenceCookie } from '@/lib/preferences'
import { useSidebarWidth } from '@/ui/sidebar-resizer'
import type { Experimental_RealtimeSessionConfig } from 'ai'
import { HOME, pageUrl, type SiteFiles } from '../_lib/files'
import { agentApi, studioApi } from '../_lib/rpc'
import {
  siteTools,
  STUDIO_INSTRUCTIONS,
  type StudioContext,
} from '../_lib/tools'
import { useVoiceAgent } from '../_lib/use-voice-agent'
import { zip } from '../_lib/zip'
import { DesignList } from './design-list'
import { NewDesign } from './new-design'
import { NotesPanel } from './notes-panel'
import { PreviewToolbar } from './preview-toolbar'
import { SourceDialog } from './source-dialog'
import { StudioDock, type StudioMode } from './studio-dock'
import { StudioHeader } from './studio-header'
import type {
  AnnotationPosition,
  Design,
  ElementTarget,
  PreviewPage,
  SiteAnnotation,
  SiteDocument,
} from '../_lib/types'

const configuration = {
  instructions: STUDIO_INSTRUCTIONS,
  voice: 'Aoede',
  outputModalities: ['audio'],
  inputAudioFormat: { type: 'audio/pcm', rate: 16000 },
  outputAudioFormat: { type: 'audio/pcm', rate: 24000 },
  // Gemini transcribes both sides itself, for the transcript panel.
  inputAudioTranscription: {},
  outputAudioTranscription: {},
  turnDetection: { type: 'server-vad' },
} satisfies Experimental_RealtimeSessionConfig

/** A new design, before the agent writes anything. */
const isEmptyDesign = (files: SiteFiles) =>
  Object.keys(files).length === 1 &&
  /<body[^>]*>\s*<\/body>/i.test(files[HOME] ?? '')

// A page that loads without the bridge answering in time has left the site,
// or its sandbox has stopped.
const CONNECT_TIMEOUT = 4000

type History = { paths: string[]; index: number }

/** A history with a page after its current entry, unless it is that page. */
const visit = ({ paths, index }: History, path: string): History =>
  paths[index] === path
    ? { paths, index }
    : { paths: [...paths.slice(0, index + 1), path], index: index + 1 }

type PendingQuery = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * One design, loaded by the page from its URL. Opening another design is a
 * navigation, which mounts a fresh studio for it.
 */
export function Studio({
  designs: initialDesigns,
  site: initialSite,
  sidebarWidth: initialWidth,
  thinking,
}: {
  designs: Design[]
  /** Null when there are no designs yet. */
  site: SiteDocument | null
  sidebarWidth: number
  /** The thinking level voice starts with. */
  thinking: ThinkingLevel
}) {
  const router = useRouter()
  const [site, setSite] = useState(initialSite)
  const [designs, setDesigns] = useState(initialDesigns)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useSidebarWidth({
    cookie: preferenceCookie.v2.sidebar,
    initial: initialWidth,
  })
  const [error, setError] = useState<string | null>(null)
  // A passing note about the preview, like a page that left the site.
  const [hint, setHint] = useState<string | null>(null)
  useEffect(() => {
    if (!hint) return
    const timer = setTimeout(() => setHint(null), 4000)
    return () => clearTimeout(timer)
  }, [hint])
  // The design's preview server, from its sandbox; see _server/preview.ts.
  const [preview, setPreview] = useState<
    { url: string; port: number } | { error: string } | null
  >(null)
  // A new iframe per load: changing an iframe's src navigates it, and every
  // navigation adds browser history.
  const [frame, setFrame] = useState({ key: 0, path: '/' })
  // The preview's own history, for its back and forward buttons. Pages never
  // add to the browser's; see the bridge's link handling.
  const [history, setHistory] = useState<History>({ paths: ['/'], index: 0 })
  // Another port of the sandbox, which the preview can show instead of the
  // design's server. There's no bridge there, so nothing to select or note.
  const [otherPort, setOtherPort] = useState<{
    url: string
    port: number
    listening: boolean
  } | null>(null)
  const [page, setPage] = useState<PreviewPage | null>(null)
  const [mode, setMode] = useState<StudioMode>('browse')
  const [selection, setSelection] = useState<ElementTarget | null>(null)
  const [positions, setPositions] = useState<AnnotationPosition[]>([])
  const [noteOpen, setNoteOpen] = useState(false)
  const [sourceOpen, setSourceOpen] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)
  const [transcriptOpen, setTranscriptOpen] = useState(false)
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

  // Refs let async work read what is current without stale closures.
  const port = useRef<MessagePort | null>(null)
  const snapshot = useRef({
    site,
    page,
    history,
    otherPort,
    mode,
    selection,
    annotations,
  })
  snapshot.current = {
    site,
    page,
    history,
    otherPort,
    mode,
    selection,
    annotations,
  }
  // The design's history, kept while the preview shows another port.
  const designHistory = useRef<History | null>(null)
  const mutations = useRef<Promise<unknown>>(Promise.resolve())
  const queries = useRef(new Map<string, PendingQuery>())
  const connectTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  // Loads in a row that never connected, to stop retrying at some point.
  const failedLoads = useRef(0)

  const showSite = (next: SiteDocument) => {
    snapshot.current.site = next
    setSite(next)
  }
  const fail = (error: unknown) =>
    setError(error instanceof Error ? error.message : String(error))

  const mutate = useCallback(<T,>(task: () => Promise<T>) => {
    const next = mutations.current.catch(() => {}).then(task)
    mutations.current = next
    return next
  }, [])

  const rejectQueries = useCallback((message: string) => {
    for (const query of queries.current.values()) {
      clearTimeout(query.timer)
      query.reject(new Error(message))
    }
    queries.current.clear()
  }, [])

  /** Loads a page of the site in a fresh preview frame. */
  const showPage = useCallback(
    (path: string) => {
      port.current?.close()
      port.current = null
      clearTimeout(connectTimer.current)
      rejectQueries('The preview is loading a page. Try again.')
      setFrame(({ key }) => ({ key: key + 1, path }))
    },
    [rejectQueries],
  )

  const showHistory = useCallback((next: History) => {
    snapshot.current.history = next
    setHistory(next)
  }, [])

  /** Brings the preview back from another port, to where the design was. */
  const leaveOtherPort = useCallback(() => {
    if (!snapshot.current.otherPort) return
    snapshot.current.otherPort = null
    setOtherPort(null)
    showHistory(designHistory.current ?? { paths: ['/'], index: 0 })
    designHistory.current = null
  }, [showHistory])

  /**
   * Copies the design's files to its preview, then reloads the page. Agent
   * edits call it too, so the preview goes back to the design to show them.
   */
  const updatePreview = useCallback(async () => {
    try {
      setPreview(await studioApi.showPreview({ id: snapshot.current.site!.id }))
      leaveOtherPort()
      const { paths, index } = snapshot.current.history
      showPage(paths[index])
    } catch (error) {
      setPreview({
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }, [showPage, leaveOtherPort])
  const siteId = site?.id
  useEffect(() => {
    if (siteId) void mutate(updatePreview)
  }, [siteId, mutate, updatePreview])

  const goBy = (step: number) => {
    const index = history.index + step
    if (index < 0 || index >= history.paths.length) return
    showHistory({ ...history, index })
    showPage(history.paths[index])
  }

  /** Shows another port of the sandbox, from its home page. */
  const openPort = async (next: number) => {
    if (preview && 'port' in preview && next === preview.port) {
      await mutate(updatePreview)
      return
    }
    const other = await studioApi.openPort({
      id: snapshot.current.site!.id,
      port: next,
    })
    if (!snapshot.current.otherPort)
      designHistory.current = snapshot.current.history
    snapshot.current.otherPort = other
    setOtherPort(other)
    snapshot.current.page = null
    setPage(null)
    setSelection(null)
    showHistory({ paths: ['/'], index: 0 })
    showPage('/')
  }

  const saveDrawing = useCallback(
    async (annotation: SiteAnnotation) => {
      setFailedDrawings((previous) =>
        previous.filter((id) => id !== annotation.id),
      )
      try {
        await mutate(async () => {
          const annotations = await studioApi.saveAnnotation({
            id: snapshot.current.site!.id,
            annotation,
          })
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
    [mutate],
  )

  const readSelection = useCallback(
    () =>
      new Promise<unknown>((resolve, reject) => {
        const other = snapshot.current.otherPort
        if (other) {
          reject(
            new Error(
              `The preview shows port ${other.port} instead of the design, so there is no selection to read.`,
            ),
          )
          return
        }
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

  // The voice session's authority for agent edits; see _server/grants.ts.
  const grant = useRef<string | null>(null)
  const revokeGrant = useCallback(() => {
    const current = grant.current
    grant.current = null
    if (current) void agentApi.revoke({ grant: current }).catch(() => {})
  }, [])
  const startSession = useCallback(async () => {
    revokeGrant()
    grant.current = (
      await studioApi.issueGrant({ designId: snapshot.current.site!.id })
    ).grant
  }, [revokeGrant])

  const agentEdit = useCallback(
    ({
      path,
      signal,
      send,
    }: {
      path: string
      signal: AbortSignal
      send: (
        grant: string,
      ) => Promise<{ site: SiteDocument; matches?: number[]; missed: boolean }>
    }) =>
      mutate(async () => {
        if (signal.aborted || !grant.current)
          return { error: 'The voice session has ended.' }
        setSaving(true)
        let result
        try {
          result = await send(grant.current)
          showSite(result.site)
        } finally {
          setSaving(false)
        }
        await updatePreview()
        const { site, matches, missed } = result
        return {
          ok: true,
          ...(matches && { matches }),
          ...(missed && { content: site.files[path] }),
        }
      }),
    [mutate, updatePreview],
  )

  /** Waits for edits in flight, so tools read what the agent last wrote. */
  const currentFiles = async () => {
    await mutations.current.catch(() => {})
    return snapshot.current.site?.files ?? {}
  }

  const studio = useMemo<StudioContext>(
    () => ({
      readSelection,
      listFiles: async () => ({
        files: Object.entries(await currentFiles()).map(([path, content]) => ({
          path,
          bytes: new Blob([content]).size,
        })),
        page: snapshot.current.page,
      }),
      readFile: async ({ path }) => {
        const files = await currentFiles()
        if (!Object.hasOwn(files, path)) throw new Error(`There is no ${path}.`)
        return { path, content: files[path] }
      },
      editFile: ({ input, callId, signal }) =>
        agentEdit({
          path: input.path,
          signal,
          send: (grant) => agentApi.editFile({ grant, input, callId, signal }),
        }),
      writeFile: ({ input, callId, signal }) =>
        agentEdit({
          path: input.path,
          signal,
          send: (grant) => agentApi.writeFile({ grant, input, callId, signal }),
        }),
      deleteFile: ({ input, callId, signal }) =>
        agentEdit({
          path: input.path,
          signal,
          send: (grant) =>
            agentApi.deleteFile({ grant, input, callId, signal }),
        }),
      openPage: async ({ path }) => {
        if (
          !path.endsWith('.html') ||
          !Object.hasOwn(await currentFiles(), path)
        )
          throw new Error(`There is no page ${path}.`)
        leaveOtherPort()
        showPage(pageUrl(path))
        return { ok: true, url: pageUrl(path) }
      },
    }),
    [readSelection, agentEdit, showPage, leaveOtherPort],
  )

  const voice = useVoiceAgent({
    tokenEndpoint: '/v2/api/realtime',
    configuration,
    thinking: { initial: thinking, cookie: preferenceCookie.v2.thinking },
    tools: siteTools,
    context: { studio },
    beforeConnect: startSession,
  })
  const endVoice = useCallback(() => {
    voice.end()
    revokeGrant()
  }, [voice.end, revokeGrant])
  useEffect(() => revokeGrant, [revokeGrant])

  const undoAgentEdit = () =>
    mutate(async () => {
      showSite(await studioApi.undoAgentEdit({ id: snapshot.current.site!.id }))
      await updatePreview()
    }).catch(fail)

  // A copy starts a fresh voice session, for when a conversation goes astray.
  const duplicateDesign = async ({ id }: { id: string }) => {
    try {
      const copy = await studioApi.duplicateDesign({ id })
      router.push(`/v2/${copy.id}`)
    } catch (error) {
      fail(error)
    }
  }
  // Permanent, unlike agent edits, so it asks first; see the ConfirmDialog.
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(
    null,
  )
  const deleteDesign = async ({ id }: { id: string }) => {
    const current = id === site?.id
    if (current) endVoice()
    await studioApi.deleteDesign({ id })
    setDeleting(null)
    if (current) router.push('/v2')
    else setDesigns((designs) => designs.filter((d) => d.id !== id))
  }
  const renameDesign = async ({ id, name }: { id: string; name: string }) => {
    const previous = designs
    setDesigns(designs.map((d) => (d.id === id ? { ...d, name } : d)))
    try {
      await studioApi.renameDesign({ id, name })
    } catch (error) {
      setDesigns(previous)
      fail(error)
    }
  }

  // Notes are numbered across the site; the page only shows its own.
  const sendState = useCallback(() => {
    const current = snapshot.current
    port.current?.postMessage({
      type: 'state',
      mode: current.mode,
      selectedId: current.selection?.id ?? null,
      annotations: current.annotations
        .map((note, index) => ({ ...note, number: index + 1 }))
        .filter((note) => note.page === current.page?.file),
    })
  }, [])
  useEffect(sendState, [mode, selection?.id, annotations, page, sendState])

  const connectPreview = (frame: HTMLIFrameElement) => {
    if (!preview || !('url' in preview) || snapshot.current.otherPort) return
    port.current?.close()
    rejectQueries('The preview updated. Read the selection again if needed.')
    const channel = new MessageChannel()
    port.current = channel.port1
    clearTimeout(connectTimer.current)
    connectTimer.current = setTimeout(() => {
      port.current?.close()
      port.current = null
      if (++failedLoads.current > 2) {
        setPreview({ error: 'The preview is not responding.' })
        return
      }
      setHint('The page left the website, so the preview reloaded.')
      void mutate(updatePreview)
    }, CONNECT_TIMEOUT)
    channel.port1.onmessage = ({ data }) => {
      if (data.type === 'ready') {
        clearTimeout(connectTimer.current)
        failedLoads.current = 0
        // Element IDs are only unique within a page.
        if (data.page.file !== snapshot.current.page?.file) {
          snapshot.current.selection = null
          setSelection(null)
          setNoteOpen(false)
        }
        snapshot.current.page = data.page
        setPage(data.page)
        // A page it didn't load from history, like a link's, is a new entry.
        const next = visit(snapshot.current.history, data.page.path)
        if (next.index !== snapshot.current.history.index) showHistory(next)
        sendState()
      }
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
      if (data.type === 'open-link') {
        // From the page's side of the channel, so check it's a web link.
        const url = URL.canParse(data.url) ? new URL(data.url) : null
        if (url && ['http:', 'https:', 'mailto:'].includes(url.protocol))
          window.open(url, '_blank', 'noopener,noreferrer')
      }
      if (data.type === 'context') {
        const query = queries.current.get(data.requestId)
        if (query) {
          clearTimeout(query.timer)
          queries.current.delete(data.requestId)
          const { annotations, page } = snapshot.current
          const elsewhere = annotations.filter(
            (note) => note.page !== page?.file,
          )
          query.resolve({
            page,
            selection: data.selection,
            annotations: data.annotations,
            ...(elsewhere.length && {
              otherPages: elsewhere.map((note) => ({
                id: note.id,
                page: note.page,
                comment: note.comment,
                target: { tag: note.target.tag, text: note.target.text },
              })),
            }),
            viewport: data.viewport,
          })
        }
        setSelection(data.selection)
      }
    }
    frame.contentWindow?.postMessage(
      { type: 'margin:v2:init' },
      new URL(preview.url).origin,
      [channel.port2],
    )
  }
  useEffect(
    () => () => {
      port.current?.close()
      clearTimeout(connectTimer.current)
      rejectQueries('The preview was closed.')
    },
    [rejectQueries],
  )

  const addNote = async (comment: string) => {
    if (!selection) return false
    const annotation: SiteAnnotation = {
      id: crypto.randomUUID(),
      page: page?.file ?? HOME,
      target: selection,
      comment,
    }
    setSaving(true)
    try {
      const annotations = await mutate(() =>
        studioApi.saveAnnotation({ id: site!.id, annotation }),
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
        studioApi.deleteAnnotation({
          id: snapshot.current.site!.id,
          annotationId: id,
        }),
      )
      setSite((previous) =>
        previous ? { ...previous, annotations } : previous,
      )
    } catch (error) {
      fail(error)
    }
  }

  const designName = designs.find((design) => design.id === site?.id)?.name
  const downloadSite = () => {
    if (site)
      download({
        name: `${designName ?? 'website'}.zip`,
        content: zip(site.files),
        type: 'application/zip',
      })
  }

  const notice =
    error || (voice.notice?.tone === 'error' ? voice.notice.message : null)
  const savingDrawings = draftDrawings.length > failedDrawings.length
  const lastDrawing = site?.annotations.findLast(
    (annotation) => annotation.drawing,
  )
  const overlay = 'absolute inset-0 grid place-items-center bg-background'
  const designServer = preview && 'url' in preview ? preview : null
  const designPort = designServer?.port ?? null
  // What the frame shows: the design's server, or a listening other port.
  const frameServer = otherPort
    ? otherPort.listening && otherPort
    : designServer

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
        designName={designName}
        status={
          saving || savingDrawings
            ? 'saving'
            : failedDrawings.length
              ? 'failed'
              : site
                ? 'saved'
                : null
        }
        disabled={!site}
        agentEdits={site?.agentEdits ?? 0}
        onUndoAgentEdit={() => void undoAgentEdit()}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        onViewSource={() => setSourceOpen(true)}
        onDownload={downloadSite}
      />
      {sidebarOpen && (
        <DesignList
          designs={designs}
          currentId={site?.id ?? null}
          width={sidebarWidth}
          onResize={setSidebarWidth}
          onRename={renameDesign}
          onDuplicate={duplicateDesign}
          onDelete={setDeleting}
        />
      )}
      <div className="col-start-2 row-start-2 flex min-h-0 flex-col">
        {site && (
          <PreviewToolbar
            port={otherPort?.port ?? designPort}
            designPort={designPort}
            path={history.paths[history.index]}
            canGoBack={history.index > 0}
            canGoForward={history.index < history.paths.length - 1}
            disabled={!otherPort && !designServer}
            onBack={() => goBy(-1)}
            onForward={() => goBy(1)}
            onReload={() =>
              otherPort && !otherPort.listening
                ? void openPort(otherPort.port).catch(fail)
                : showPage(history.paths[history.index])
            }
            onNavigate={showPage}
            onOpenPort={openPort}
          />
        )}
        <div className="relative isolate min-h-0 flex-1 overflow-hidden">
          {site ? (
            <>
              {frameServer && (
                <iframe
                  key={frame.key}
                  title="Website preview"
                  sandbox="allow-scripts allow-same-origin"
                  referrerPolicy="no-referrer"
                  src={new URL(frame.path, frameServer.url).href}
                  onLoad={(event) => connectPreview(event.currentTarget)}
                  className="absolute inset-0 size-full bg-white scheme-light"
                />
              )}
              {/* The page stays mounted underneath so the agent's tools work. */}
              {otherPort ? (
                !otherPort.listening && (
                  <div className={overlay}>
                    <div className="flex flex-col items-center gap-3 text-center">
                      <p className="max-w-80 text-dim">
                        Nothing is listening on port {otherPort.port} yet.
                      </p>
                      <div className="flex gap-2">
                        <Button
                          variant="accent"
                          onClick={() =>
                            void openPort(otherPort.port).catch(fail)
                          }
                        >
                          Check again
                        </Button>
                        <Button onClick={() => void mutate(updatePreview)}>
                          Back to port {designPort}
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              ) : isEmptyDesign(site.files) ? (
                <div className={overlay}>
                  <EmptyState title="Empty design">
                    Press Talk and describe a website.
                  </EmptyState>
                </div>
              ) : !preview ? (
                <div className={overlay}>
                  <p className="flex items-center gap-2 text-faint">
                    <LoaderCircle size={14} className="animate-spin" />
                    Starting the preview
                  </p>
                </div>
              ) : (
                'error' in preview && (
                  <div className={overlay}>
                    <div className="flex flex-col items-center gap-3 text-center">
                      <p role="alert" className="max-w-80 text-danger">
                        {preview.error}
                      </p>
                      <Button
                        variant="accent"
                        onClick={() => {
                          failedLoads.current = 0
                          setPreview(null)
                          void mutate(updatePreview)
                        }}
                      >
                        Try again
                      </Button>
                    </div>
                  </div>
                )
              )}
            </>
          ) : (
            <div className="absolute inset-0 grid place-items-center">
              <EmptyState title="No designs" action={<NewDesign />} />
            </div>
          )}
          {hint && !notice && (
            <Notice
              tone="done"
              className="absolute top-3 left-1/2 -translate-x-1/2"
              onDismiss={() => setHint(null)}
            >
              {hint}
            </Notice>
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
                voice.dismissNotice()
              }}
            >
              {notice}
            </Notice>
          )}
          {site && (
            <StudioDock
              voice={{ ...voice, end: endVoice }}
              transcriptOpen={transcriptOpen}
              onToggleTranscript={() => setTranscriptOpen(!transcriptOpen)}
              mode={mode}
              selection={selection}
              noteOpen={noteOpen}
              saving={saving}
              annotationCount={annotations.length}
              canUndoDrawing={!!lastDrawing && !savingDrawings}
              disabled={!site}
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
          )}
          {notesOpen && (
            <NotesPanel
              annotations={annotations}
              positions={positions}
              pendingIds={draftDrawings.map((draft) => draft.id)}
              page={page?.file ?? null}
              onDelete={(id) => void deleteNote(id)}
              onClose={() => setNotesOpen(false)}
            />
          )}
        </div>
      </div>
      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}`}
          confirmLabel="Delete"
          onConfirm={() => deleteDesign(deleting)}
          onClose={() => setDeleting(null)}
        >
          This permanently deletes the design, with its notes and edit history.
        </ConfirmDialog>
      )}
      {sourceOpen && site && (
        <SourceDialog
          files={site.files}
          initialPath={page?.file ?? HOME}
          onClose={() => setSourceOpen(false)}
          onDownload={downloadSite}
        />
      )}
    </main>
  )
}
