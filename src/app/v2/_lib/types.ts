import type { SiteFiles } from './files'

export type ElementTarget = {
  id: string
  tag: string
  text: string
  html: string
  selector: string
  rect: { x: number; y: number; width: number; height: number }
}

export type SiteAnnotation = {
  id: string
  /** The page it was made on, like index.html. */
  page: string
  target: ElementTarget
  comment: string
  drawing?: {
    points: { x: number; y: number }[]
    targets: Pick<ElementTarget, 'id' | 'tag' | 'text' | 'selector'>[]
  }
}

export type SiteDocument = {
  id: string
  files: SiteFiles
  annotations: SiteAnnotation[]
  /** Agent edits that can still be undone. */
  agentEdits: number
}

export type Design = { id: string; name: string; createdAt: number }

/** What the preview shows: the page's file, or null where there is none. */
export type PreviewPage = { file: string | null; path: string }

export type AnnotationPosition = {
  id: string
  x: number
  y: number
  visible: boolean
  attached: boolean
}
