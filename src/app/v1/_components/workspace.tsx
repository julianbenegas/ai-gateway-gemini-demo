'use client'

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { usePathname } from 'next/navigation'
import { Plus } from 'lucide-react'
import type { Editor, TLEditorSnapshot, TLPageId } from 'tldraw'
import { Brand } from '@/ui/brand'
import { IconButton } from '@/ui/button'
import { Notice } from '@/ui/notice'
import { SectionLabel } from '@/ui/section-label'
import { preferenceCookie } from '@/lib/preferences'
import { SidebarItem } from '@/ui/sidebar-item'
import { SidebarResizer, useSidebarWidth } from '@/ui/sidebar-resizer'
import { boardPath, boardsFromSnapshot } from '../_lib/boards'
import { CanvasVoice } from './canvas-voice'

// tldraw only runs in the browser. Everything around it renders on the server
// from the saved snapshot, so loading the canvas never shifts the layout.
const CanvasEditor = dynamic(() => import('./canvas-editor'), { ssr: false })

export function Workspace({
  snapshot,
  boardId,
  sidebarWidth: initialWidth,
  thinking,
}: {
  snapshot: TLEditorSnapshot | null
  /** The board in the URL, if any. */
  boardId: string | null
  sidebarWidth: number
  /** Whether voice starts with extended thinking. */
  thinking: boolean
}) {
  const [editor, setEditor] = useState<Editor | null>(null)
  const [boards, setBoards] = useState(() =>
    boardsFromSnapshot({ snapshot, boardId }),
  )
  const [saveError, setSaveError] = useState<string | null>(null)
  const [sidebarWidth, setSidebarWidth] = useSidebarWidth({
    cookie: preferenceCookie.v1.sidebar,
    initial: initialWidth,
  })
  const page = boards.pages.find((page) => page.id === boards.currentId)
  // The URL follows the open board. The first update only canonicalizes it;
  // later ones are board switches, so the back button returns to the last.
  const pathname = usePathname()
  const synced = useRef(false)
  useEffect(() => {
    if (!editor) return
    const path = boardPath(boards.currentId)
    if (window.location.pathname !== path)
      window.history[synced.current ? 'pushState' : 'replaceState'](
        null,
        '',
        path,
      )
    synced.current = true
  }, [editor, boards.currentId])
  useEffect(() => {
    const board = pathname.match(/^\/v1\/([^/]+)$/)?.[1]
    const id = board && (`page:${board}` as TLPageId)
    if (editor && id && editor.getPage(id) && id !== editor.getCurrentPageId())
      editor.setCurrentPage(id)
  }, [editor, pathname])

  const newBoard = () => {
    if (!editor) return
    editor.markHistoryStoppingPoint('new board')
    editor.createPage({ name: `Untitled board ${boards.pages.length + 1}` })
    editor.setCurrentPage(editor.getPages().at(-1)!.id)
  }
  return (
    <main
      style={{ '--sidebar': `${sidebarWidth}px` } as React.CSSProperties}
      className="grid h-dvh grid-cols-[var(--sidebar)_1fr] grid-rows-[40px_1fr] max-sm:grid-cols-1 max-sm:grid-rows-[40px_40px_1fr]"
    >
      <div
        data-canvas
        className="relative isolate col-start-2 row-start-2 max-sm:col-start-1 max-sm:row-start-3"
      >
        <CanvasEditor
          snapshot={snapshot}
          initialBoardId={boards.currentId}
          onReady={setEditor}
          onBoards={setBoards}
          onSaveError={setSaveError}
        />
      </div>
      <aside className="relative z-10 col-start-1 row-span-2 row-start-1 flex min-h-0 flex-col px-4 pb-3 max-sm:row-span-1 max-sm:row-start-2 max-sm:flex-row max-sm:items-center max-sm:pb-0">
        <div className="flex h-10 shrink-0 items-center max-sm:hidden">
          <Brand href="/v1" suffix="v1" />
        </div>
        <SectionLabel
          action={
            <IconButton label="New board" size="icon-sm" onClick={newBoard}>
              <Plus size={14} />
            </IconButton>
          }
        >
          <span className="max-sm:sr-only">Boards</span>
        </SectionLabel>
        <nav
          aria-label="Boards"
          className="mt-1 flex min-h-0 flex-col overflow-auto max-sm:order-first max-sm:mt-0 max-sm:flex-row"
        >
          {boards.pages.map((board) => (
            <SidebarItem
              key={board.id}
              name={board.name}
              current={board.id === boards.currentId}
              onOpen={() => editor?.setCurrentPage(board.id as TLPageId)}
              onRename={(name) =>
                editor?.updatePage({ id: board.id as TLPageId, name })
              }
              actions={[
                {
                  label: 'Duplicate',
                  onSelect: () => {
                    editor?.markHistoryStoppingPoint('duplicate board')
                    editor?.duplicatePage(board.id as TLPageId)
                  },
                },
              ]}
            />
          ))}
        </nav>
        <SidebarResizer width={sidebarWidth} onResize={setSidebarWidth} />
      </aside>
      <header className="relative col-start-2 row-start-1 flex items-center justify-between gap-3 px-2 max-sm:col-start-1">
        <input
          key={`${page?.id}:${page?.name}`}
          aria-label="Board name"
          defaultValue={page?.name}
          readOnly={!editor}
          onBlur={(event) => {
            const name = event.target.value.trim()
            if (editor && page && name && name !== page.name)
              editor.updatePage({ id: page.id as TLPageId, name })
            else event.target.value = page?.name ?? ''
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
          className="h-7 w-56 min-w-0 cursor-default truncate bg-transparent px-2 font-semibold text-dim -outline-offset-1 outline-accent hover:bg-shade focus:cursor-text focus:bg-accent/5 focus:text-accent focus:outline-2 focus:outline-dashed"
        />
        <CanvasVoice editor={editor} thinking={thinking} />
        {saveError && (
          <Notice
            tone="error"
            onDismiss={() => setSaveError(null)}
            className="absolute top-11 left-2"
          >
            {saveError}
          </Notice>
        )}
      </header>
    </main>
  )
}
