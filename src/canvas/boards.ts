import type { TLEditorSnapshot, TLPage } from 'tldraw'

export type Boards = {
  pages: { id: string; name: string }[]
  currentId: string
}

/** Board names from a saved snapshot, so the server can render the sidebar. */
export function boardsFromSnapshot(snapshot: TLEditorSnapshot | null): Boards {
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
  const current = snapshot?.session?.currentPageId
  return {
    pages,
    currentId: pages.some((page) => page.id === current)
      ? current!
      : pages[0].id,
  }
}
