import type { Design, SiteAnnotation, SiteDocument } from './types'

export const designPath = (path: string, id: string | null) =>
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

export const api = {
  designs: () => request<Design[]>('/api/v2/designs'),
  site: (id: string | null) =>
    request<SiteDocument>(designPath('/api/v2/site', id)),
  createDesign: () => request<SiteDocument>('/api/v2/site', { method: 'POST' }),
  editSite: (id: string | null, edit: unknown, signal?: AbortSignal) =>
    request<{ site: SiteDocument; matches?: number[]; missed: boolean }>(
      designPath('/api/v2/site', id),
      { method: 'PATCH', body: JSON.stringify(edit), signal },
    ),
  saveAnnotation: (id: string | null, annotation: SiteAnnotation) =>
    request<SiteAnnotation[]>(designPath('/api/v2/annotations', id), {
      method: 'POST',
      body: JSON.stringify(annotation),
    }),
  deleteAnnotation: (id: string | null, annotationId: string) =>
    request<SiteAnnotation[]>(designPath('/api/v2/annotations', id), {
      method: 'DELETE',
      body: JSON.stringify({ id: annotationId }),
    }),
}
