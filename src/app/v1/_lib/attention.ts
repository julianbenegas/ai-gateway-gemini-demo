// Type-only tldraw imports, like operations.ts.
import type { Editor } from 'tldraw'

/**
 * Where the user has been pointing, so the agent can resolve "this" and
 * "here". Gemini through Gateway doesn't say when the user started or stopped
 * speaking, so this keeps a short history instead: places the pointer rested,
 * selection changes, and the agent's own changes, each with how long ago.
 */
export type Attention = ReturnType<typeof trackAttention>

type Point = { x: number; y: number }
type Rest = { shapeId: string | null; pointer: Point; from: number; to: number }
type Timed<T> = T & { at: number }

const SAMPLE_MS = 100
// A pause this long counts as pointing at something.
const REST_MS = 350
// Over empty canvas, moving less than this is still the same spot.
const REST_PX = 16
const WINDOW_MS = 30_000

export function trackAttention({ editor }: { editor: Editor }) {
  let rests: Rest[] = []
  let current: Rest | null = null
  let selections: Timed<{ selectedIds: string[] }>[] = []
  let changes: Timed<{
    kind: 'created' | 'updated' | 'deleted'
    ids: string[]
  }>[] = []
  let lastSelection = JSON.stringify(editor.getSelectedShapeIds())

  const sample = () => {
    const now = Date.now()
    const { x, y } = editor.inputs.getCurrentPagePoint()
    const pointer = { x: Math.round(x), y: Math.round(y) }
    const shapeId = editor.getHoveredShapeId() ?? null
    // Moving within one shape is still pointing at it.
    const same =
      current &&
      current.shapeId === shapeId &&
      (shapeId ||
        Math.hypot(
          pointer.x - current.pointer.x,
          pointer.y - current.pointer.y,
        ) < REST_PX)
    if (current && same) {
      current.to = now
      current.pointer = pointer
    } else {
      if (current && current.to - current.from >= REST_MS) rests.push(current)
      current = { shapeId, pointer, from: now, to: now }
    }
    const selection = JSON.stringify(editor.getSelectedShapeIds())
    if (selection !== lastSelection) {
      lastSelection = selection
      selections.push({ selectedIds: JSON.parse(selection), at: now })
    }
    const since = now - WINDOW_MS
    rests = rests.filter((rest) => rest.to > since)
    selections = selections.filter((entry) => entry.at > since)
    changes = changes.filter((entry) => entry.at > since)
  }
  const timer = setInterval(sample, SAMPLE_MS)

  return {
    /** Recent attention for read_board, newest first. */
    snapshot() {
      const now = Date.now()
      const ago = (at: number) => Math.round((now - at) / 100) / 10
      const all = [
        ...rests,
        ...(current && current.to - current.from >= REST_MS ? [current] : []),
      ]
      return {
        pointerRests: all
          .toReversed()
          .slice(0, 8)
          .map((rest) => ({
            secondsAgo: ago(rest.to),
            forSeconds: Math.round((rest.to - rest.from) / 100) / 10,
            shapeId: rest.shapeId,
            pointer: rest.pointer,
          })),
        selectionChanges: selections
          .toReversed()
          .map(({ at, ...entry }) => ({ secondsAgo: ago(at), ...entry })),
        yourChanges: changes
          .toReversed()
          .map(({ at, ...entry }) => ({ secondsAgo: ago(at), ...entry })),
      }
    },
    /** Records what the agent just changed, so it isn't mistaken for "this". */
    noteChanges({
      createdIds = [],
      updatedIds = [],
      deletedIds = [],
    }: {
      createdIds?: string[]
      updatedIds?: string[]
      deletedIds?: string[]
    }) {
      const at = Date.now()
      for (const [kind, ids] of [
        ['created', createdIds],
        ['updated', updatedIds],
        ['deleted', deletedIds],
      ] as const)
        if (ids.length) changes.push({ kind, ids, at })
    },
    stop: () => clearInterval(timer),
  }
}
