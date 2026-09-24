import type { TLEditorSnapshot, TLPage } from 'tldraw'

export type Boards = {
  pages: { id: string; name: string }[]
  currentId: string
}

/** A board's URL: its tldraw page ID without the `page:` prefix. */
export const boardPath = (id: string) => `/v1/${id.replace(/^page:/, '')}`

/**
 * Board names from a saved snapshot, so the server can render the sidebar.
 * The board in the URL wins over the one the snapshot last had open.
 */
export function boardsFromSnapshot({
  snapshot,
  boardId,
}: {
  snapshot: TLEditorSnapshot | null
  boardId: string | null
}): Boards {
  const pages = Object.values(snapshot?.document.store ?? {})
    .filter((record): record is TLPage => record.typeName === 'page')
    .sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0))
    .map(({ id, name }) => ({ id, name }))
  // A new visitor gets the seeded first board; see seedFirstBoard.
  if (!pages.length)
    return {
      pages: [{ id: 'page:page', name: 'First ideas' }],
      currentId: 'page:page',
    }
  const current = pages.some((page) => page.id === boardId)
    ? boardId
    : snapshot?.session?.currentPageId
  return {
    pages,
    currentId: pages.some((page) => page.id === current)
      ? current!
      : pages[0].id,
  }
}
