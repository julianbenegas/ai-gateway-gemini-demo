'use client'

import 'tldraw/tldraw.css'
import { useCallback, useEffect } from 'react'
import { getAssetUrls } from '@tldraw/assets/selfHosted'
import {
  Box,
  createShapeId,
  DEFAULT_THEME,
  DefaultStylePanel,
  type Editor,
  getSnapshot,
  type TLComponents,
  type TLEditorSnapshot,
  Tldraw,
  toRichText,
  useEditor,
  useValue,
} from 'tldraw'
import { unwrap } from '@/lib/rpc'
import { STARTER_HTML } from '@/lib/starter-site'
import { focusCanvas } from '../_lib/agent'
import type { Boards } from '../_lib/boards'
import { api } from '../_lib/rpc'
import { CanvasContextMenu } from './canvas-menus'
import { WebsiteShapeUtil } from './website-shape'

const shapeUtils = [WebsiteShapeUtil]
const components: TLComponents = {
  PageMenu: null,
  SharePanel: null,
  ContextMenu: CanvasContextMenu,
  MenuPanel: null,
  NavigationPanel: null,
  // Rendered in the bottom-right corner instead; see <Tldraw> children.
  StylePanel: null,
}
const assetUrls = getAssetUrls({ baseUrl: '/tldraw' })
// Canvas overlays read colors from the JS theme, not CSS; mirror globals.css.
const selection = {
  selectionStroke: '#ff6c02',
  selectionFill: 'rgb(255 108 2 / 0.16)',
  selectedContrast: '#fafafa',
}
const themes = {
  default: {
    ...DEFAULT_THEME,
    colors: {
      light: {
        ...DEFAULT_THEME.colors.light,
        background: '#fafafa',
        negativeSpace: '#fafafa',
        ...selection,
      },
      dark: {
        ...DEFAULT_THEME.colors.dark,
        background: '#040404',
        negativeSpace: '#040404',
        ...selection,
      },
    },
  },
}

/** tldraw itself; client-only because it cannot render on the server. */
export default function CanvasEditor({
  snapshot,
  onReady,
  onBoards,
  onSaveError,
}: {
  snapshot: TLEditorSnapshot | null
  onReady: (editor: Editor) => void
  onBoards: (boards: Boards) => void
  onSaveError: (error: string | null) => void
}) {
  const mount = useCallback(
    (editor: Editor) => {
      editor.user.updateUserPreferences({ colorScheme: 'system' })
      if (!snapshot) seedFirstBoard(editor)
      onReady(editor)
    },
    [snapshot, onReady],
  )
  return (
    <Tldraw
      snapshot={snapshot ?? undefined}
      shapeUtils={shapeUtils}
      assetUrls={assetUrls}
      components={components}
      themes={themes}
      onMount={mount}
    >
      <BoardSync onBoards={onBoards} />
      <Autosave initial={!snapshot} onError={onSaveError} />
      <div className="pointer-events-auto absolute right-2 bottom-14 z-(--tl-layer-panels) max-sm:hidden">
        <DefaultStylePanel />
      </div>
    </Tldraw>
  )
}

function BoardSync({ onBoards }: { onBoards: (boards: Boards) => void }) {
  const editor = useEditor()
  const boards = useValue(
    'boards',
    () => ({
      pages: editor.getPages().map(({ id, name }) => ({ id, name })),
      currentId: editor.getCurrentPageId(),
    }),
    [editor],
  )
  useEffect(() => onBoards(boards), [boards, onBoards])
  return null
}

/** Saves the whole board to Redis shortly after each change. */
function Autosave({
  initial,
  onError,
}: {
  initial: boolean
  onError: (error: string | null) => void
}) {
  const editor = useEditor()
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let queue = Promise.resolve()
    const save = (keepalive = false) => {
      clearTimeout(timer)
      timer = undefined
      const snapshot = getSnapshot(editor.store)
      // Browsers cap keepalive bodies at 64 KB.
      keepalive &&= JSON.stringify(snapshot).length < 60_000
      queue = queue.then(async () => {
        try {
          await unwrap(api.board.put(snapshot, { fetch: { keepalive } }))
          onError(null)
        } catch (error) {
          onError(
            error instanceof Error && error.message
              ? error.message
              : 'The board could not be saved.',
          )
        }
      })
    }
    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(save, 400)
    }
    const flush = () => {
      if (timer) save(true)
    }
    if (initial) save()
    const stop = editor.store.listen(schedule, { scope: 'document' })
    // Page switches are session state; save them so reloads reopen the board.
    let page = editor.getCurrentPageId()
    const stopSession = editor.store.listen(
      () => {
        if (page === editor.getCurrentPageId()) return
        page = editor.getCurrentPageId()
        schedule()
      },
      { scope: 'session' },
    )
    window.addEventListener('pagehide', flush)
    return () => {
      stop()
      stopSession()
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [editor, initial, onError])
  return null
}

function seedFirstBoard(editor: Editor) {
  // Strict Mode mounts twice against the same store; seed only once.
  if (editor.getCurrentPageShapes().length) return
  editor.updatePage({ id: editor.getCurrentPageId(), name: 'First ideas' })
  const id = createShapeId('forma')
  editor.createShapes([
    {
      id,
      type: 'website',
      x: 0,
      y: 0,
      props: {
        w: 720,
        h: 760,
        title: 'Forma · Starting point',
        html: STARTER_HTML,
      },
    },
    {
      type: 'note',
      x: 810,
      y: 95,
      rotation: 0.05,
      props: {
        color: 'yellow',
        size: 'm',
        richText: toRichText('What if this felt a little more playful?'),
      },
    },
  ])
  editor.select(id)
  focusCanvas(
    editor,
    Box.Common(
      editor
        .getCurrentPageShapes()
        .map((shape) => editor.getShapePageBounds(shape)!),
    ),
  )
  editor.clearHistory()
}
