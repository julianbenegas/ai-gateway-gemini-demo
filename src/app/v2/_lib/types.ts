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
  target: ElementTarget
  comment: string
  drawing?: {
    points: { x: number; y: number }[]
    targets: Pick<ElementTarget, 'id' | 'tag' | 'text' | 'selector'>[]
  }
}

export type SiteDocument = {
  id: string | null
  html: string
  annotations: SiteAnnotation[]
  persisted: boolean
  /** Agent edits that can still be undone. */
  agentEdits: number
}

export type Design = { id: string; name: string; createdAt: number }

export type AnnotationPosition = {
  id: string
  x: number
  y: number
  visible: boolean
  attached: boolean
}
